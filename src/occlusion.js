import * as THREE from 'three';

const DEPTH_HEIGHT = 180;
const MIN_REFRESH_MS = 120;
const MIN_PROJECTED_RADIUS = 2.5;
const PROXY_PADDING = 1.12;

function isOpaqueOccluder(object) {
  if (!object.isMesh || object.userData?.noOcclusionOccluder) return false;
  if (object.isPoints || object.isLine || object.isLineSegments || object.isSprite) return false;

  const materials = Array.isArray(object.material) ? object.material : [object.material];
  if (!materials.length || materials.some((material) => !material ||
    !material.visible || material.transparent || material.depthWrite === false ||
    material.opacity < 0.98)) return false;

  return true;
}

function getQualitySettings(quality) {
  if (quality === 'low') return { depthHeight: 112, queryBudget: 4 };
  if (quality === 'high') return { depthHeight: 224, queryBudget: 16 };
  return { depthHeight: 160, queryBudget: 8 };
}

/**
 * GPU occlusion culling for large, static world chunks.
 *
 * A low-resolution depth pass records opaque scene geometry. WebGL2
 * ANY_SAMPLES_PASSED queries then test conservative bounding spheres around
 * forest, rock, and skyline chunks. Query results are consumed asynchronously,
 * so the culler never stalls the CPU waiting for the GPU.
 */
export function createOcclusionCuller(renderer, scene, camera) {
  const gl = renderer.getContext();
  const supported = Boolean(renderer.capabilities?.isWebGL2 &&
    gl && typeof gl.createQuery === 'function' &&
    typeof gl.getQueryParameter === 'function');

  const candidates = [];
  scene.traverse((object) => {
    if (!object.isMesh || !object.userData?.occlusionCandidate ||
      !object.geometry || object.frustumCulled === false) return;

    if (object.isInstancedMesh) object.computeBoundingSphere();
    else if (!object.geometry.boundingSphere) object.geometry.computeBoundingSphere();

    const bounds = object.boundingSphere || object.geometry.boundingSphere;
    if (!bounds) return;

    candidates.push({
      mesh: object,
      baseVisible: object.visible,
      sphere: new THREE.Sphere(),
      cameraSpaceCenter: new THREE.Vector3(),
      occluded: false,
      pending: false,
      query: null,
      queryGeneration: -1,
      lastIssuedGeneration: -1,
      lastResultAt: 0,
      resultPosition: new THREE.Vector3(),
      resultQuaternion: new THREE.Quaternion(),
    });
  });

  const depthMaterial = new THREE.MeshDepthMaterial({
    depthPacking: THREE.BasicDepthPacking,
    side: THREE.FrontSide,
  });
  const proxyMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    colorWrite: false,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const proxy = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), proxyMaterial);
  proxy.frustumCulled = false;
  const queryScene = new THREE.Scene();
  queryScene.add(proxy);

  let depthTarget = null;
  let depthValid = false;
  let depthDirty = true;
  let generation = 0;
  let queryCursor = 0;
  let activeCandidates = [];
  let lastDepthAt = -Infinity;
  let lastCameraPosition = new THREE.Vector3();
  let lastCameraQuaternion = new THREE.Quaternion();
  let lastCameraFar = camera.far;
  let lastCameraAspect = camera.aspect;
  let lastCameraFov = camera.fov;
  let hasCameraSnapshot = false;
  let disposed = false;
  let enabled = supported && candidates.length > 0;

  const projectionMatrix = new THREE.Matrix4();
  const frustum = new THREE.Frustum();
  const viewMatrix = new THREE.Matrix4();
  const previousColor = new THREE.Color();
  const worldScale = new THREE.Vector3();

  function restoreVisibility() {
    for (const candidate of candidates) {
      candidate.mesh.visible = candidate.baseVisible;
    }
  }

  function applyVisibility() {
    for (const candidate of candidates) {
      candidate.mesh.visible = candidate.baseVisible && !candidate.occluded;
    }
  }

  function clearOcclusionState() {
    for (const candidate of candidates) {
      candidate.occluded = false;
    }
  }

  function ensureDepthTarget(height) {
    const width = Math.max(96, Math.round(height * camera.aspect));
    if (!depthTarget) {
      depthTarget = new THREE.WebGLRenderTarget(width, height, {
        depthBuffer: true,
        stencilBuffer: false,
        samples: 0,
      });
      depthTarget.texture.colorSpace = THREE.NoColorSpace;
      depthTarget.texture.minFilter = THREE.NearestFilter;
      depthTarget.texture.magFilter = THREE.NearestFilter;
      return;
    }

    if (depthTarget.width !== width || depthTarget.height !== height) {
      depthTarget.setSize(width, height);
      depthValid = false;
    }
  }

  function buildActiveCandidates(height) {
    camera.updateMatrixWorld(true);
    viewMatrix.copy(camera.matrixWorld).invert();
    projectionMatrix.multiplyMatrices(camera.projectionMatrix, viewMatrix);
    frustum.setFromProjectionMatrix(projectionMatrix);

    const focalPixels = height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)));
    const next = [];

    for (const candidate of candidates) {
      const mesh = candidate.mesh;
      if (!candidate.baseVisible) {
        candidate.occluded = false;
        continue;
      }

      mesh.updateWorldMatrix(true, false);
      const localBounds = mesh.boundingSphere || mesh.geometry.boundingSphere;
      if (!localBounds) {
        candidate.occluded = false;
        continue;
      }

      candidate.sphere.copy(localBounds).applyMatrix4(mesh.matrixWorld);
      if (!frustum.intersectsSphere(candidate.sphere)) {
        // Never keep a stale occlusion result when a chunk leaves the view.
        candidate.occluded = false;
        continue;
      }

      candidate.cameraSpaceCenter.copy(candidate.sphere.center).applyMatrix4(viewMatrix);
      const depth = -candidate.cameraSpaceCenter.z;
      const radius = candidate.sphere.radius;
      if (depth <= radius + 12) {
        candidate.occluded = false;
        continue;
      }

      const projectedRadius = radius * focalPixels / depth;
      if (projectedRadius < MIN_PROJECTED_RADIUS) {
        candidate.occluded = false;
        continue;
      }

      next.push({
        candidate,
        distance: candidate.sphere.center.distanceToSquared(camera.position),
      });
    }

    // Distant chunks are the most likely to be hidden by terrain or nearer
    // vegetation, so they receive query slots first.
    next.sort((a, b) => b.distance - a.distance);
    activeCandidates = next.map((entry) => entry.candidate);
    queryCursor = 0;
  }

  function renderDepthPass(now, depthHeight) {
    restoreVisibility();
    ensureDepthTarget(depthHeight);

    const hidden = [];
    scene.traverse((object) => {
      if (!object.visible) return;
      if (object.isPoints || object.isLine || object.isLineSegments || object.isSprite ||
        (object.isMesh && !isOpaqueOccluder(object))) {
        hidden.push(object);
        object.visible = false;
      }
    });

    const previousTarget = renderer.getRenderTarget();
    const previousAutoClear = renderer.autoClear;
    const previousClearColorValue = renderer.getClearColor(previousColor).clone();
    const previousClearAlpha = renderer.getClearAlpha();
    const previousOverrideMaterial = scene.overrideMaterial;

    try {
      renderer.setRenderTarget(depthTarget);
      renderer.setClearColor(0xffffff, 1);
      renderer.autoClear = false;
      scene.overrideMaterial = depthMaterial;
      renderer.clear(true, true, true);
      renderer.render(scene, camera);
    } finally {
      scene.overrideMaterial = previousOverrideMaterial;
      for (const object of hidden) object.visible = true;
      renderer.setClearColor(previousClearColorValue, previousClearAlpha);
      renderer.autoClear = previousAutoClear;
      renderer.setRenderTarget(previousTarget);
    }

    generation++;
    lastDepthAt = now;
    lastCameraPosition.copy(camera.position);
    lastCameraQuaternion.copy(camera.quaternion);
    lastCameraFar = camera.far;
    lastCameraAspect = camera.aspect;
    lastCameraFov = camera.fov;
    hasCameraSnapshot = true;
    depthValid = true;

    for (const candidate of candidates) {
      candidate.lastIssuedGeneration = -1;
    }

    buildActiveCandidates(depthHeight);
  }

  function pollQueries(now) {
    for (const candidate of candidates) {
      if (!candidate.pending || !candidate.query) continue;

      let available = false;
      try {
        available = gl.getQueryParameter(candidate.query, gl.QUERY_RESULT_AVAILABLE);
      } catch (error) {
        enabled = false;
        return;
      }
      if (!available) continue;

      let samplesPassed = true;
      try {
        samplesPassed = gl.getQueryParameter(candidate.query, gl.QUERY_RESULT);
      } catch (error) {
        samplesPassed = true;
      }

      if (candidate.queryGeneration === generation && !depthDirty) {
        candidate.occluded = !samplesPassed;
        candidate.lastResultAt = now;
        candidate.resultPosition.copy(camera.position);
        candidate.resultQuaternion.copy(camera.quaternion);
      }

      gl.deleteQuery(candidate.query);
      candidate.query = null;
      candidate.pending = false;
      candidate.queryGeneration = -1;
    }
  }

  function issueQueries(queryBudget) {
    if (!depthValid || !activeCandidates.length) return;

    const queryType = gl.ANY_SAMPLES_PASSED_CONSERVATIVE ?? gl.ANY_SAMPLES_PASSED;
    if (queryType === undefined) {
      enabled = false;
      return;
    }

    const previousTarget = renderer.getRenderTarget();
    const previousAutoClear = renderer.autoClear;
    renderer.setRenderTarget(depthTarget);
    renderer.autoClear = false;

    let issued = 0;
    let visited = 0;
    try {
      while (issued < queryBudget && visited < activeCandidates.length) {
        if (queryCursor >= activeCandidates.length) queryCursor = 0;
        const candidate = activeCandidates[queryCursor++];
        visited++;

        if (candidate.pending || candidate.lastIssuedGeneration === generation) continue;

        const query = gl.createQuery();
        if (!query) continue;

        const sphere = candidate.sphere;
        proxy.position.copy(sphere.center);
        proxy.scale.setScalar(sphere.radius * PROXY_PADDING);
        proxy.updateMatrix();
        proxy.matrixWorldNeedsUpdate = true;

        try {
          gl.beginQuery(queryType, query);
          renderer.render(queryScene, camera);
          gl.endQuery(queryType);
        } catch (error) {
          try { gl.endQuery(queryType); } catch (endError) { /* query was not active */ }
          gl.deleteQuery(query);
          enabled = false;
          break;
        }

        candidate.query = query;
        candidate.pending = true;
        candidate.queryGeneration = generation;
        candidate.lastIssuedGeneration = generation;
        issued++;
      }
    } finally {
      renderer.autoClear = previousAutoClear;
      renderer.setRenderTarget(previousTarget);
    }
  }

  function update(quality = 'medium') {
    if (disposed || !enabled) return;

    restoreVisibility();
    const now = performance.now();
    const settings = getQualitySettings(quality);
    const cameraMove = hasCameraSnapshot
      ? camera.position.distanceTo(lastCameraPosition)
      : Infinity;
    const cameraTurn = hasCameraSnapshot
      ? camera.quaternion.angleTo(lastCameraQuaternion)
      : Infinity;
    const projectionChanged = !hasCameraSnapshot ||
      camera.far !== lastCameraFar ||
      camera.aspect !== lastCameraAspect ||
      camera.fov !== lastCameraFov;
    const teleported = hasCameraSnapshot &&
      (cameraMove > 90 || cameraTurn > 0.95);

    if (teleported) clearOcclusionState();

    const cameraChanged = !hasCameraSnapshot || projectionChanged ||
      cameraMove > 1.8 || cameraTurn > 0.035;
    if (cameraChanged) depthDirty = true;

    if (depthDirty && now - lastDepthAt >= MIN_REFRESH_MS) {
      renderDepthPass(now, settings.depthHeight);
      depthDirty = false;
    }

    pollQueries(now);
    if (!enabled || (renderer.shadowMap?.enabled && renderer.shadowMap.needsUpdate)) {
      restoreVisibility();
      return;
    }

    if (depthValid && !depthDirty) {
      issueQueries(settings.queryBudget);
      for (const candidate of candidates) {
        if (candidate.occluded &&
          (camera.position.distanceTo(candidate.resultPosition) > 18 ||
           camera.quaternion.angleTo(candidate.resultQuaternion) > 0.18)) {
          candidate.occluded = false;
        }
      }
      if (!enabled) {
        restoreVisibility();
        return;
      }
      applyVisibility();
    } else {
      // The cached depth image belongs to an older camera pose. Show all
      // chunks until a fresh depth pass is ready rather than risk hiding
      // something that has just entered the view.
      restoreVisibility();
    }
  }

  function restore() {
    restoreVisibility();
  }

  function dispose() {
    if (disposed) return;
    restoreVisibility();
    for (const candidate of candidates) {
      if (candidate.query) gl.deleteQuery(candidate.query);
      candidate.query = null;
      candidate.pending = false;
    }
    depthTarget?.dispose();
    proxy.geometry.dispose();
    proxyMaterial.dispose();
    depthMaterial.dispose();
    disposed = true;
    enabled = false;
  }

  return {
    supported,
    get enabled() { return enabled; },
    get candidateCount() { return candidates.length; },
    get occludedCount() {
      return candidates.reduce((count, candidate) => count + (candidate.occluded ? 1 : 0), 0);
    },
    update,
    restore,
    dispose,
  };
}
