import * as THREE from 'three';

const EPSILON = 0.035;
const ROUND_GEOMETRIES = new Set([
  'CylinderGeometry',
  'ConeGeometry',
  'SphereGeometry',
  'IcosahedronGeometry',
  'LatheGeometry',
]);

/**
 * Scene-wide static collision map.
 * Every Mesh is solid by default. Only meshes explicitly tagged noCollider
 * (water surfaces, water jets, sky dome and visual-only effects) are ignored.
 * Meshes tagged collisionMode="ring" represent hollow circular walls.
 */
export function createPhysicsWorld(scene) {
  scene.updateMatrixWorld(true);

  const floors = [];
  const colliders = [];
  const raycaster = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const instanceMatrix = new THREE.Matrix4();
  const worldMatrix = new THREE.Matrix4();
  const center = new THREE.Vector3();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();

  scene.traverse((object) => {
    if (!object.isMesh || object.userData.noCollider || !object.visible) return;

    if (object.userData.walkable) floors.push(object);

    const geometry = object.geometry;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    if (!geometry.boundingBox || geometry.boundingBox.isEmpty()) return;

    const addShape = (matrix) => {
      const box = geometry.boundingBox.clone().applyMatrix4(matrix);
      if (box.max.y - box.min.y < 0.06) return;

      if (object.userData.collisionMode === 'ring') {
        geometry.boundingBox.getCenter(center);
        center.applyMatrix4(matrix);
        matrix.decompose(position, rotation, scale);
        colliders.push({
          kind: 'ring',
          x: center.x,
          z: center.z,
          radius: (object.userData.collisionRadius ??
            Math.max(geometry.boundingBox.max.x, geometry.boundingBox.max.z)) *
            Math.max(Math.abs(scale.x), Math.abs(scale.z)),
          thickness: (object.userData.collisionThickness ?? 0.8) *
            Math.max(Math.abs(scale.x), Math.abs(scale.z)),
          gapStart: object.userData.collisionGapStart ?? null,
          gapEnd: object.userData.collisionGapEnd ?? null,
          minY: box.min.y,
          maxY: box.max.y,
        });
        return;
      }

      if (ROUND_GEOMETRIES.has(geometry.type)) {
        geometry.boundingBox.getCenter(center);
        center.applyMatrix4(matrix);
        matrix.decompose(position, rotation, scale);
        colliders.push({
          kind: 'round',
          x: center.x,
          z: center.z,
          radius: Math.max(
            (geometry.boundingBox.max.x - geometry.boundingBox.min.x) * 0.5 * Math.abs(scale.x),
            (geometry.boundingBox.max.z - geometry.boundingBox.min.z) * 0.5 * Math.abs(scale.z)
          ),
          minY: box.min.y,
          maxY: box.max.y,
        });
      } else {
        colliders.push({ kind: 'box', box });
      }
    };

    if (object.isInstancedMesh) {
      for (let i = 0; i < object.count; i++) {
        object.getMatrixAt(i, instanceMatrix);
        worldMatrix.multiplyMatrices(object.matrixWorld, instanceMatrix);
        addShape(worldMatrix);
      }
    } else {
      addShape(object.matrixWorld);
    }
  });

  function groundAt(x, z, feetY, maxStepUp = 0.46, maxDrop = 0.8) {
    if (!floors.length) return null;

    raycaster.set(new THREE.Vector3(x, feetY + maxStepUp + 0.08, z), down);
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

  function isHeadBlocked(x, headY, z, radius) {
    for (const shape of colliders) {
      if (headY <= shape.minY + EPSILON || headY >= shape.maxY - EPSILON) continue;

      const dx = x - shape.x;
      const dz = z - shape.z;
      const distance = Math.hypot(dx, dz);

      if (shape.kind === 'ring') {
        if (shape.gapStart !== null && shape.gapEnd !== null) {
          let angle = Math.atan2(dz, dx);
          if (angle < 0) angle += Math.PI * 2;
          if (angle >= shape.gapStart && angle <= shape.gapEnd) continue;
        }
        if (Math.abs(distance - shape.radius) < radius + shape.thickness * 0.5) return true;
        continue;
      }

      if (shape.kind === 'round') {
        if (distance < radius + shape.radius) return true;
        continue;
      }

      const box = shape.box;
      if (x + radius <= box.min.x || x - radius >= box.max.x) continue;
      if (z + radius <= box.min.z || z - radius >= box.max.z) continue;
      const closestX = THREE.MathUtils.clamp(x, box.min.x, box.max.x);
      const closestZ = THREE.MathUtils.clamp(z, box.min.z, box.max.z);
      const nearestX = x - closestX;
      const nearestZ = z - closestZ;
      if (nearestX * nearestX + nearestZ * nearestZ < radius * radius) return true;
    }
    return false;
  }

  function isBlocked(x, feetY, z, radius, height) {
    const headY = feetY + height;

    for (const shape of colliders) {
      if (headY <= shape.minY + EPSILON || feetY >= shape.maxY - EPSILON) continue;

      const dx = x - shape.x;
      const dz = z - shape.z;
      const distance = Math.hypot(dx, dz);

      if (shape.kind === 'ring') {
        if (shape.gapStart !== null && shape.gapEnd !== null) {
          let angle = Math.atan2(dz, dx);
          if (angle < 0) angle += Math.PI * 2;
          if (angle >= shape.gapStart && angle <= shape.gapEnd) continue;
        }
        const halfWall = shape.thickness * 0.5;
        if (Math.abs(distance - shape.radius) < radius + halfWall) return true;
        continue;
      }

      if (shape.kind === 'round') {
        if (distance < radius + shape.radius) return true;
        continue;
      }

      const box = shape.box;
      if (x + radius <= box.min.x || x - radius >= box.max.x) continue;
      if (z + radius <= box.min.z || z - radius >= box.max.z) continue;

      const closestX = THREE.MathUtils.clamp(x, box.min.x, box.max.x);
      const closestZ = THREE.MathUtils.clamp(z, box.min.z, box.max.z);
      const nearestX = x - closestX;
      const nearestZ = z - closestZ;
      if (nearestX * nearestX + nearestZ * nearestZ < radius * radius) return true;
    }
    return false;
  }

  return {
    groundAt,
    isBlocked,
    isHeadBlocked,
    stats: { floorMeshes: floors.length, colliderShapes: colliders.length },
  };
}
