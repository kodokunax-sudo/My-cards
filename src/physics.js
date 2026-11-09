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
 * Builds a lightweight static collision world from the actual scene meshes.
 * Walkable surfaces are raycast for ground height; solid meshes use transformed
 * boxes or round horizontal bounds, including one shape per InstancedMesh item.
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

    const solid = object.userData.solid || object.castShadow;
    if (!solid) return;

    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (materials.length && materials.every((material) =>
      !material || (material.transparent && material.opacity < 0.8)
    )) return;

    const geometry = object.geometry;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    if (!geometry.boundingBox || geometry.boundingBox.isEmpty()) return;

    const round = ROUND_GEOMETRIES.has(geometry.type);
    const halfX = (geometry.boundingBox.max.x - geometry.boundingBox.min.x) * 0.5;
    const halfZ = (geometry.boundingBox.max.z - geometry.boundingBox.min.z) * 0.5;

    const addShape = (matrix) => {
      const box = geometry.boundingBox.clone().applyMatrix4(matrix);
      if (box.max.y - box.min.y < 0.06) return;

      if (round) {
        geometry.boundingBox.getCenter(center);
        center.applyMatrix4(matrix);
        matrix.decompose(position, rotation, scale);
        colliders.push({
          round: true,
          x: center.x,
          z: center.z,
          radius: Math.max(halfX * Math.abs(scale.x), halfZ * Math.abs(scale.z)),
          minY: box.min.y,
          maxY: box.max.y,
        });
      } else {
        colliders.push(box);
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

  function isBlocked(x, feetY, z, radius, height) {
    const headY = feetY + height;

    for (const shape of colliders) {
      const minY = shape.round ? shape.minY : shape.min.y;
      const maxY = shape.round ? shape.maxY : shape.max.y;
      if (headY <= minY + EPSILON || feetY >= maxY - EPSILON) continue;

      if (shape.round) {
        const combinedRadius = radius + shape.radius;
        const dx = x - shape.x;
        const dz = z - shape.z;
        if (dx * dx + dz * dz < combinedRadius * combinedRadius) return true;
        continue;
      }

      const box = shape;
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
