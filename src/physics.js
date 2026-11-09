import * as THREE from 'three';

const EPSILON = 0.035;

/**
 * Builds a lightweight static collision world from the actual scene meshes.
 * Walkable surfaces are raycast for ground height; solid meshes use transformed
 * bounding boxes, including one box per InstancedMesh instance.
 */
export function createPhysicsWorld(scene) {
  scene.updateMatrixWorld(true);

  const floors = [];
  const colliders = [];
  const raycaster = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const localBox = new THREE.Box3();
  const instanceMatrix = new THREE.Matrix4();
  const worldMatrix = new THREE.Matrix4();

  scene.traverse((object) => {
    if (!object.isMesh || object.userData.noCollider || !object.visible) return;

    if (object.userData.walkable) floors.push(object);

    const solid = object.userData.solid || object.castShadow;
    if (!solid) return;

    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (materials.length && materials.every((material) =>
      !material || (material.transparent && material.opacity < 0.8)
    )) return;

    if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
    if (!object.geometry.boundingBox || object.geometry.boundingBox.isEmpty()) return;

    if (object.isInstancedMesh) {
      for (let i = 0; i < object.count; i++) {
        object.getMatrixAt(i, instanceMatrix);
        worldMatrix.multiplyMatrices(object.matrixWorld, instanceMatrix);
        const box = object.geometry.boundingBox.clone().applyMatrix4(worldMatrix);
        if (box.max.y - box.min.y < 0.06) continue;
        colliders.push(box);
      }
      return;
    }

    localBox.copy(object.geometry.boundingBox).applyMatrix4(object.matrixWorld);
    if (localBox.max.y - localBox.min.y >= 0.06) colliders.push(localBox.clone());
  });

  /**
   * Finds the highest real walkable surface in a small vertical window.
   * This replaces the old coordinate-based terrain/bridge height table.
   */
  function groundAt(x, z, feetY, maxStepUp = 0.46, maxDrop = 0.8) {
    if (!floors.length) return null;

    raycaster.set(
      new THREE.Vector3(x, feetY + maxStepUp + 0.08, z),
      down
    );
    raycaster.near = 0;
    raycaster.far = maxStepUp + maxDrop + 0.16;

    const hits = raycaster.intersectObjects(floors, false);
    let best = null;
    for (const hit of hits) {
      const y = hit.point.y;
      if (y > feetY + maxStepUp || y < feetY - maxDrop) continue;
      if (best === null || y > best) best = y;
    }
    return best;
  }

  /**
   * Capsule approximation: a vertical player body with a circular footprint.
   * The boxes are only broad-phase collision shapes; their source is the
   * actual mesh geometry, not hand-written world coordinates.
   */
  function isBlocked(x, feetY, z, radius, height) {
    const headY = feetY + height;

    for (const box of colliders) {
      if (headY <= box.min.y + EPSILON || feetY >= box.max.y - EPSILON) continue;
      if (x + radius <= box.min.x || x - radius >= box.max.x) continue;
      if (z + radius <= box.min.z || z - radius >= box.max.z) continue;

      const closestX = THREE.MathUtils.clamp(x, box.min.x, box.max.x);
      const closestZ = THREE.MathUtils.clamp(z, box.min.z, box.max.z);
      const dx = x - closestX;
      const dz = z - closestZ;
      if (dx * dx + dz * dz < radius * radius) return true;
    }
    return false;
  }

  return {
    groundAt,
    isBlocked,
    stats: { floorMeshes: floors.length, colliderShapes: colliders.length },
  };
}
