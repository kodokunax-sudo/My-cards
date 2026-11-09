import * as THREE from 'three';

const EPSILON = 0.035;
const CELL_SIZE = 32;
const ROUND_GEOMETRIES = new Set([
  'CylinderGeometry',
  'ConeGeometry',
  'SphereGeometry',
  'IcosahedronGeometry',
  'DodecahedronGeometry',
  'LatheGeometry',
]);

function cellKey(x, z) {
  return `${x},${z}`;
}

function angleInGap(angle, start, end) {
  if (angle < 0) angle += Math.PI * 2;
  return start <= end
    ? angle >= start && angle <= end
    : angle >= start || angle <= end;
}

/**
 * Static collision world with a spatial grid.
 * Only explicitly walkable meshes are floor candidates. Decorative foliage,
 * water surfaces and the terrain render mesh do not become accidental floors.
 */
export function createPhysicsWorld(scene, worldInfo = null) {
  scene.updateMatrixWorld(true);

  const floors = [];
  const colliders = [];
  const grid = new Map();
  const raycaster = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const instanceMatrix = new THREE.Matrix4();
  const worldMatrix = new THREE.Matrix4();
  const inverseMatrix = new THREE.Matrix4();
  const center = new THREE.Vector3();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();

  function insertCollider(shape) {
    colliders.push(shape);
    const minCellX = Math.floor(shape.minX / CELL_SIZE);
    const maxCellX = Math.floor(shape.maxX / CELL_SIZE);
    const minCellZ = Math.floor(shape.minZ / CELL_SIZE);
    const maxCellZ = Math.floor(shape.maxZ / CELL_SIZE);

    for (let cx = minCellX; cx <= maxCellX; cx++) {
      for (let cz = minCellZ; cz <= maxCellZ; cz++) {
        const key = cellKey(cx, cz);
        let bucket = grid.get(key);
        if (!bucket) {
          bucket = [];
          grid.set(key, bucket);
        }
        bucket.push(shape);
      }
    }
  }

  function addShape(object, matrix) {
    const geometry = object.geometry;
    const localBounds = geometry.boundingBox;
    const bounds = localBounds.clone().applyMatrix4(matrix);
    if (bounds.max.y - bounds.min.y < 0.06) return;

    if (object.userData.collisionMode === 'ring') {
      localBounds.getCenter(center);
      center.applyMatrix4(matrix);
      matrix.decompose(position, rotation, scale);
      const radius = (object.userData.collisionRadius ??
        Math.max(localBounds.max.x, localBounds.max.z)) *
        Math.max(Math.abs(scale.x), Math.abs(scale.z));
      const thickness = (object.userData.collisionThickness ?? 0.8) *
        Math.max(Math.abs(scale.x), Math.abs(scale.z));
      insertCollider({
        kind: 'ring',
        x: center.x,
        z: center.z,
        radius,
        thickness,
        gapStart: object.userData.collisionGapStart ?? null,
        gapEnd: object.userData.collisionGapEnd ?? null,
        minY: bounds.min.y,
        maxY: bounds.max.y,
        minX: center.x - radius - thickness,
        maxX: center.x + radius + thickness,
        minZ: center.z - radius - thickness,
        maxZ: center.z + radius + thickness,
      });
      return;
    }

    if (ROUND_GEOMETRIES.has(geometry.type)) {
      bounds.getCenter(center);
      const radius = Math.max(
        (bounds.max.x - bounds.min.x) * 0.5,
        (bounds.max.z - bounds.min.z) * 0.5
      );
      insertCollider({
        kind: 'round',
        x: center.x,
        z: center.z,
        radius,
        minY: bounds.min.y,
        maxY: bounds.max.y,
        minX: center.x - radius,
        maxX: center.x + radius,
        minZ: center.z - radius,
        maxZ: center.z + radius,
      });
      return;
    }

    // Use the mesh-local bounds and inverse transform for every remaining
    // model. A rotated prop can no longer create a huge world-axis-aligned wall.
    const inverse = inverseMatrix.copy(matrix).invert().clone();
    matrix.decompose(position, rotation, scale);
    const minScale = Math.max(0.001, Math.min(
      Math.abs(scale.x), Math.abs(scale.z)
    ));
    insertCollider({
      kind: 'obb',
      inverse,
      bounds: localBounds.clone(),
      localRadiusScale: minScale,
      minY: bounds.min.y,
      maxY: bounds.max.y,
      minX: bounds.min.x,
      maxX: bounds.max.x,
      minZ: bounds.min.z,
      maxZ: bounds.max.z,
    });
  }

  scene.traverse((object) => {
    if (!object.isMesh || object.userData.noCollider || !object.visible) return;

    if (object.userData.walkable) floors.push(object);

    const geometry = object.geometry;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    if (!geometry.boundingBox || geometry.boundingBox.isEmpty()) return;

    if (object.isInstancedMesh) {
      for (let i = 0; i < object.count; i++) {
        object.getMatrixAt(i, instanceMatrix);
        worldMatrix.multiplyMatrices(object.matrixWorld, instanceMatrix);
        addShape(object, worldMatrix);
      }
    } else {
      addShape(object, object.matrixWorld);
    }
  });

  function nearbyShapes(x, z, radius = 0.5) {
    const minX = Math.floor((x - radius) / CELL_SIZE);
    const maxX = Math.floor((x + radius) / CELL_SIZE);
    const minZ = Math.floor((z - radius) / CELL_SIZE);
    const maxZ = Math.floor((z + radius) / CELL_SIZE);
    const found = new Set();

    for (let cx = minX; cx <= maxX; cx++) {
      for (let cz = minZ; cz <= maxZ; cz++) {
        const bucket = grid.get(cellKey(cx, cz));
        if (!bucket) continue;
        for (const shape of bucket) found.add(shape);
      }
    }
    return found;
  }

  function groundAt(x, z, feetY, maxStepUp = 0.9, maxDrop = 1.35) {
    const low = feetY - maxDrop;
    const high = feetY + maxStepUp;
    let best = null;

    // The analytic height sampler is the real terrain collision surface.
    const terrainY = worldInfo?.heightAt?.(x, z);
    if (Number.isFinite(terrainY) && terrainY >= low && terrainY <= high) {
      best = terrainY;
    }

    if (floors.length) {
      raycaster.set(new THREE.Vector3(x, high + 0.08, z), down);
      raycaster.near = 0;
      raycaster.far = maxStepUp + maxDrop + 0.16;
      const hits = raycaster.intersectObjects(floors, false);
      for (const hit of hits) {
        const y = hit.point.y;
        if (y < low || y > high) continue;
        if (best === null || y > best) best = y;
      }
    }

    return best;
  }

  function shapeBlocks(shape, x, feetY, z, radius, height) {
    const headY = feetY + height;
    if (headY <= shape.minY + EPSILON || feetY >= shape.maxY - EPSILON) return false;

    if (shape.kind === 'ring') {
      const dx = x - shape.x;
      const dz = z - shape.z;
      const distance = Math.hypot(dx, dz);
      if (shape.gapStart !== null && shape.gapEnd !== null &&
        angleInGap(Math.atan2(dz, dx), shape.gapStart, shape.gapEnd)) return false;
      return Math.abs(distance - shape.radius) < radius + shape.thickness * 0.5;
    }

    if (shape.kind === 'round') {
      return Math.hypot(x - shape.x, z - shape.z) < radius + shape.radius;
    }

    if (shape.kind === 'obb') {
      const local = new THREE.Vector3(x, feetY + height * 0.5, z).applyMatrix4(shape.inverse);
      const localRadius = radius / shape.localRadiusScale;
      const closestX = THREE.MathUtils.clamp(local.x, shape.bounds.min.x, shape.bounds.max.x);
      const closestZ = THREE.MathUtils.clamp(local.z, shape.bounds.min.z, shape.bounds.max.z);
      const dx = local.x - closestX;
      const dz = local.z - closestZ;
      return dx * dx + dz * dz < localRadius * localRadius;
    }

    const box = shape.box;
    if (x + radius <= box.min.x || x - radius >= box.max.x) return false;
    if (z + radius <= box.min.z || z - radius >= box.max.z) return false;
    const closestX = THREE.MathUtils.clamp(x, box.min.x, box.max.x);
    const closestZ = THREE.MathUtils.clamp(z, box.min.z, box.max.z);
    const dx = x - closestX;
    const dz = z - closestZ;
    return dx * dx + dz * dz < radius * radius;
  }

  function isHeadBlocked(x, headY, z, radius) {
    const minY = headY - 0.55;
    for (const shape of nearbyShapes(x, z, radius + 1)) {
      if (headY <= shape.minY + EPSILON || minY >= shape.maxY - EPSILON) continue;
      if (shapeBlocks(shape, x, headY - 0.55, z, radius, 0.55)) return true;
    }
    return false;
  }

  function isBlocked(x, feetY, z, radius, height) {
    for (const shape of nearbyShapes(x, z, radius + 1)) {
      if (shapeBlocks(shape, x, feetY, z, radius, height)) return true;
    }
    return false;
  }

  function resolvePosition(x, z, feetY, radius, height) {
    let px = x, pz = z;
    let changed = false;

    // Recover gently if a spawn, a slope correction or a previous collision
    // ever leaves the player slightly inside a solid object.
    for (let iteration = 0; iteration < 5; iteration++) {
      let pushed = false;
      for (const shape of nearbyShapes(px, pz, radius + 8)) {
        const headY = feetY + height;
        if (headY <= shape.minY + EPSILON || feetY >= shape.maxY - EPSILON) continue;

        if (shape.kind === 'round' || shape.kind === 'ring') {
          let dx = px - shape.x;
          let dz = pz - shape.z;
          let distance = Math.hypot(dx, dz);
          if (distance < 0.0001) {
            dx = 1;
            dz = 0;
            distance = 1;
          }
          if (shape.kind === 'ring') {
            if (shape.gapStart !== null && shape.gapEnd !== null &&
              angleInGap(Math.atan2(dz, dx), shape.gapStart, shape.gapEnd)) continue;
            const penetration = radius + shape.thickness * 0.5 - Math.abs(distance - shape.radius);
            if (penetration > 0) {
              const direction = distance >= shape.radius ? 1 : -1;
              px += (dx / distance) * penetration * direction;
              pz += (dz / distance) * penetration * direction;
              pushed = changed = true;
            }
          } else {
            const penetration = radius + shape.radius - distance;
            if (penetration > 0) {
              px += (dx / distance) * penetration;
              pz += (dz / distance) * penetration;
              pushed = changed = true;
            }
          }
          continue;
        }

        if (shape.kind === 'obb') {
          const local = new THREE.Vector3(px, feetY + height * 0.5, pz).applyMatrix4(shape.inverse);
          const r = radius / shape.localRadiusScale;
          const minX = shape.bounds.min.x - r, maxX = shape.bounds.max.x + r;
          const minZ = shape.bounds.min.z - r, maxZ = shape.bounds.max.z + r;
          if (local.x > minX && local.x < maxX && local.z > minZ && local.z < maxZ) {
            const options = [
              { d: local.x - minX, x: minX - 0.02, z: local.z },
              { d: maxX - local.x, x: maxX + 0.02, z: local.z },
              { d: local.z - minZ, x: local.x, z: minZ - 0.02 },
              { d: maxZ - local.z, x: local.x, z: maxZ + 0.02 },
            ].sort((a, b) => a.d - b.d);
            const candidate = new THREE.Vector3(options[0].x, local.y, options[0].z).applyMatrix4(
              new THREE.Matrix4().copy(shape.inverse).invert()
            );
            px = candidate.x;
            pz = candidate.z;
            pushed = changed = true;
          }
          continue;
        }

        const box = shape.box;
        const closestX = THREE.MathUtils.clamp(px, box.min.x, box.max.x);
        const closestZ = THREE.MathUtils.clamp(pz, box.min.z, box.max.z);
        let dx = px - closestX;
        let dz = pz - closestZ;
        let distance = Math.hypot(dx, dz);
        if (distance < radius) {
          if (distance < 0.0001) {
            const sides = [
              { d: px - box.min.x, x: box.min.x - radius - 0.02, z: pz },
              { d: box.max.x - px, x: box.max.x + radius + 0.02, z: pz },
              { d: pz - box.min.z, x: px, z: box.min.z - radius - 0.02 },
              { d: box.max.z - pz, x: px, z: box.max.z + radius + 0.02 },
            ].sort((a, b) => a.d - b.d);
            px = sides[0].x;
            pz = sides[0].z;
          } else {
            const penetration = radius - distance;
            px += (dx / distance) * penetration;
            pz += (dz / distance) * penetration;
          }
          pushed = changed = true;
        }
      }
      if (!pushed) break;
    }

    return { x: px, z: pz, changed };
  }

  return {
    groundAt,
    isBlocked,
    isHeadBlocked,
    resolvePosition,
    stats: { floorMeshes: floors.length, colliderShapes: colliders.length, gridCells: grid.size },
  };
}
