import * as THREE from 'three';
import {
  POOL_RADIUS, POOL_BOTTOM_Y, WATER_Y, GRASS_RADIUS, PLAZA_RADIUS,
} from './config.js';

const TAU = Math.PI * 2;
const HILLS = [
  [-3050, -1950, 760, 78], [2380, -2380, 820, 108],
  [2820, 2180, 880, 94], [-3280, 2900, 730, 86],
  [300, -4050, 690, 92], [-4250, -750, 640, 76],
  [4420, 850, 580, 72], [900, 3970, 620, 84],
  [-1150, -3250, 540, 58], [1650, 950, 520, 48],
  [-650, -920, 520, 116], [720, 680, 540, 138],
  [-1850, 2350, 590, 132], [1220, -1580, 660, 142],
  [2450, 820, 700, 158], [-2850, 1850, 640, 146],
];

const RIDGES = [
  [-5100, -4200, -3150, -2500, 230, 132],
  [250, -5250, 1850, -3650, 270, 158],
  [1780, -1050, 3850, 1650, 250, 150],
  [-4550, 1050, -2920, 3700, 245, 128],
  [-1650, 3900, 250, 5050, 210, 105],
  [2650, 3150, 4450, 4300, 180, 96],
  [-3500, -500, -2550, 1250, 165, 88],
];

function seededRandom(seed = 914207) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function smoothstep(a, b, x) {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

function hash2(x, z, seed) {
  const value = Math.sin(x * 127.1 + z * 311.7 + seed * 74.7) * 43758.5453123;
  return value - Math.floor(value);
}

function valueNoise(x, z, seed = 1) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx0 = x - ix, fz0 = z - iz;
  const fx = fx0 * fx0 * fx0 * (fx0 * (fx0 * 6 - 15) + 10);
  const fz = fz0 * fz0 * fz0 * (fz0 * (fz0 * 6 - 15) + 10);
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(a, b, fx),
    THREE.MathUtils.lerp(c, d, fx),
    fz
  );
}

function mainRiverX(z) {
  return -900 + 840 * Math.sin(z / 1200);
}

function tributaryZ(x) {
  return 4200 + 180 * Math.sin(x / 650);
}

function distanceToSegment2D(px, pz, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const len2 = dx * dx + dz * dz || 1;
  const t = THREE.MathUtils.clamp(((px - a.x) * dx + (pz - a.z) * dz) / len2, 0, 1);
  return Math.hypot(px - (a.x + dx * t), pz - (a.z + dz * t));
}

function distanceToPolyline(x, z, points) {
  let best = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    best = Math.min(best, distanceToSegment2D(x, z, points[i], points[i + 1]));
  }
  return best;
}

function registerChunkMesh(mesh, renderables, maxDistance) {
  mesh.frustumCulled = true;
  if (mesh.isInstancedMesh) mesh.computeBoundingSphere();
  else mesh.geometry.computeBoundingSphere();

  // Kept for diagnostics and optional distance-based LOD later. Actual
  // visibility is decided by Three.js per camera, including reflection cameras.
  mesh.userData.maxDrawDistance = maxDistance;
  renderables.push(mesh);
}

function createHeightFunction(routePoints) {
  return (x, z) => {
    if (Math.hypot(x, z) > GRASS_RADIUS + 30) return null;

    const broad = (valueNoise(x / 1750, z / 1750, 11) - 0.5) * 104;
    const rolling = (valueNoise(x / 520, z / 520, 17) - 0.5) * 42;
    const detail = (valueNoise(x / 175, z / 175, 23) - 0.5) * 13;
    const ridgeNoise = 1 - Math.abs(valueNoise(x / 760, z / 760, 31) * 2 - 1);
    let height = broad + rolling + detail + (ridgeNoise - 0.44) * 20;

    for (const [hx, hz, radius, peak] of HILLS) {
      const dx = x - hx, dz = z - hz;
      height += peak * Math.exp(-(dx * dx + dz * dz) / (2 * radius * radius));
    }

    // Long ridge chains create actual mountain silhouettes instead of isolated bumps.
    for (const [ax, az, bx, bz, width, peak] of RIDGES) {
      const dx = bx - ax, dz = bz - az;
      const lengthSq = dx * dx + dz * dz;
      const t = THREE.MathUtils.clamp(((x - ax) * dx + (z - az) * dz) / lengthSq, 0, 1);
      const nearestX = ax + dx * t, nearestZ = az + dz * t;
      const distance = Math.hypot(x - nearestX, z - nearestZ);
      const endFade = Math.min(1, 0.28 + Math.min(t, 1 - t) * 4.2);
      height += peak * Math.exp(-(distance * distance) / (2 * width * width)) * endFade;
    }

    // Preserve a flat central park and a compact clearing around the house.
    const parkBlend = 1 - smoothstep(210, 390, Math.hypot(x, z));
    const houseBlend = 1 - smoothstep(38, 82, Math.hypot(x + 1600, z - 900));
    const trailBlend = 1 - smoothstep(12, 34, distanceToPolyline(x, z, routePoints));
    const riverBlend = 1 - smoothstep(38, 68, Math.abs(x - mainRiverX(z)));
    const tributaryBlend = 1 - smoothstep(30, 58, Math.abs(z - tributaryZ(x)));
    const flatten = Math.max(parkBlend, houseBlend, trailBlend, riverBlend, tributaryBlend);
    height *= 1 - flatten;

    // Carve deep, narrow river channels and a level approach at the bridge.
    const mainCut = 1 - smoothstep(20, 32, Math.abs(x - mainRiverX(z)));
    const tributaryCut = 1 - smoothstep(14, 24, Math.abs(z - tributaryZ(x)));
    height -= mainCut * 2.82 + tributaryCut * 2.22;
    const bridgeBlend = 1 - smoothstep(7, 24, Math.hypot(x + 692, z - 300));
    height *= 1 - bridgeBlend;

    const protectedFlat = Math.max(parkBlend, houseBlend, trailBlend);
    const gully = Math.pow(Math.max(0, 1 - Math.abs(valueNoise(x / 610, z / 610, 49) * 2 - 1)), 5);
    height -= gully * 8.5 * (1 - protectedFlat);
    return THREE.MathUtils.clamp(height, -22, 225);
  };
}

function createTerrain(scene, heightAt, renderables) {
  const chunksPerAxis = 14;
  // 64 cells in each 800m chunk => 12.5m spacing (was 26.7m).
  const cellsPerChunk = 64;
  const chunkSize = (GRASS_RADIUS * 2) / chunksPerAxis;
  const step = chunkSize / cellsPerChunk;

  const low = new THREE.Color(0x3c5a32);
  const grass = new THREE.Color(0x557542);
  const high = new THREE.Color(0x64704b);
  const rock = new THREE.Color(0x777461);
  const color = new THREE.Color();
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 1, metalness: 0,
  });
  const chunks = [];

  for (let cz = 0; cz < chunksPerAxis; cz++) {
    for (let cx = 0; cx < chunksPerAxis; cx++) {
      const originX = -GRASS_RADIUS + cx * chunkSize;
      const originZ = -GRASS_RADIUS + cz * chunkSize;
      // One-cell halo around every chunk. It participates in normal
      // calculation but its triangles are not rendered, so adjacent chunks
      // share the same smooth edge normals and do not form visible seams.
      const side = cellsPerChunk + 3;
      const positions = new Float32Array(side * side * 3);
      const colors = new Float32Array(side * side * 3);
      const normalIndices = [];
      const indices = [];

      for (let iz = 0; iz < side; iz++) {
        const z = originZ + (iz - 1) * step;
        for (let ix = 0; ix < side; ix++) {
          const x = originX + (ix - 1) * step;
          const index = (iz * side + ix) * 3;
          const radius = Math.hypot(x, z);
          const h = heightAt(x, z) ?? 0;

          // Terrain continues underneath the plaza rim. The plaza tile sits
          // above it, eliminating the exposed triangular gap at its perimeter.
          const underPlaza = 1 - smoothstep(PLAZA_RADIUS - 8, PLAZA_RADIUS + 26, radius);
          positions[index] = x;
          positions[index + 1] = h - 0.62 * underPlaza;
          positions[index + 2] = z;

          const variation = valueNoise(x / 115, z / 115, 61);
          color.copy(grass).lerp(low, (1 - variation) * 0.32);
          color.lerp(high, smoothstep(35, 90, h) * 0.62);
          color.lerp(rock, smoothstep(0.12, 0.42, Math.abs(h) / 225) * smoothstep(75, 145, h) * 0.58);
          const tint = 0.92 + variation * 0.16;
          colors[index] = color.r * tint;
          colors[index + 1] = color.g * tint;
          colors[index + 2] = color.b * tint;
        }
      }

      for (let iz = 0; iz < cellsPerChunk + 2; iz++) {
        const z = originZ + (iz - 0.5) * step;
        const nearestZ = THREE.MathUtils.clamp(0, z - step * 0.5, z + step * 0.5);
        for (let ix = 0; ix < cellsPerChunk + 2; ix++) {
          const x = originX + (ix - 0.5) * step;
          const nearestX = THREE.MathUtils.clamp(0, x - step * 0.5, x + step * 0.5);
          const nearestRadius = Math.hypot(nearestX, nearestZ);
          if (nearestRadius < POOL_RADIUS + 0.8 || nearestRadius > GRASS_RADIUS) continue;

          const a = iz * side + ix;
          const b = a + 1;
          const c = a + side;
          const d = c + 1;
          normalIndices.push(a, c, b, b, c, d);
          if (ix >= 1 && ix <= cellsPerChunk && iz >= 1 && iz <= cellsPerChunk) {
            indices.push(a, c, b, b, c, d);
          }
        }
      }

      if (!indices.length) continue;

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geometry.setIndex(normalIndices);
      geometry.computeVertexNormals();
      // Keep halo triangles out of the draw call while retaining their normals.
      geometry.setIndex(indices);

      const terrain = new THREE.Mesh(geometry, material);
      terrain.receiveShadow = true;
      terrain.castShadow = false;
      terrain.userData.noCollider = true;
      terrain.name = `terrain-chunk-${cx}-${cz}`;
      registerChunkMesh(terrain, renderables, 6200);
      scene.add(terrain);
      chunks.push(terrain);
    }
  }
  return chunks;
}

function makeRibbon(points, halfWidth, y, heightAt = null, tangentPoints = points, indexOffset = 0) {
  const positions = [];
  const indices = [];
  for (let i = 0; i < points.length; i++) {
    const globalIndex = i + indexOffset;
    const prev = tangentPoints[Math.max(0, globalIndex - 1)];
    const next = tangentPoints[Math.min(tangentPoints.length - 1, globalIndex + 1)];
    const dx = next.x - prev.x;
    const dz = next.z - prev.z;
    const length = Math.hypot(dx, dz) || 1;
    const nx = -dz / length;
    const nz = dx / length;
    const p = points[i];
    const leftX = p.x + nx * halfWidth, leftZ = p.z + nz * halfWidth;
    const rightX = p.x - nx * halfWidth, rightZ = p.z - nz * halfWidth;
    positions.push(
      leftX, heightAt ? (heightAt(leftX, leftZ) ?? y) : y, leftZ,
      rightX, heightAt ? (heightAt(rightX, rightZ) ?? y) : y, rightZ
    );
    if (i < points.length - 1) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function pointInReservedArea(x, z, routePoints) {
  if (Math.hypot(x, z) < 245) return true;
  if (Math.hypot(x + 1600, z - 900) < 62) return true;
  if (distanceToPolyline(x, z, routePoints) < 22) return true;
  if (Math.abs(x - mainRiverX(z)) < 70) return true;
  if (Math.abs(z - tributaryZ(x)) < 52) return true;
  return false;
}

function createForests(scene, heightAt, routePoints, rnd, renderables) {
  const trees = [];
  const cell = 16;
  const half = GRASS_RADIUS - 80;
  for (let x0 = -half; x0 <= half; x0 += cell) {
    for (let z0 = -half; z0 <= half; z0 += cell) {
      const x = x0 + (rnd() - 0.5) * cell * 0.82;
      const z = z0 + (rnd() - 0.5) * cell * 0.82;
      if (Math.hypot(x, z) > half || pointInReservedArea(x, z, routePoints)) continue;

      const forestMask =
        valueNoise(x / 1250, z / 1250, 71) * 0.62 +
        valueNoise(x / 2650, z / 2650, 73) * 0.38;
      if (forestMask < 0.30 || rnd() > 0.44) continue;

      const groundY = heightAt(x, z) ?? 0;
      trees.push({
        x, z, y: groundY,
        scale: 0.82 + rnd() * 0.78,
        rotation: rnd() * TAU,
        hue: rnd(),
        pine: rnd() < 0.34,
      });
    }
  }

  const chunkSize = 640;
  const buckets = new Map();
  for (const tree of trees) {
    const cx = Math.floor(tree.x / chunkSize);
    const cz = Math.floor(tree.z / chunkSize);
    const key = `${cx},${cz}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { deciduous: [], pine: [] };
      buckets.set(key, bucket);
    }
    bucket[tree.pine ? 'pine' : 'deciduous'].push(tree);
  }

  const trunkGeometry = new THREE.CylinderGeometry(0.25, 0.48, 8, 7);
  const deciduousGeometry = new THREE.IcosahedronGeometry(5.3, 0);
  const pineGeometry = new THREE.ConeGeometry(4.9, 10.8, 7, 1);
  const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x59432f, roughness: 1 });
  const deciduousMaterial = new THREE.MeshStandardMaterial({
    color: 0x315b35, roughness: 0.98, flatShading: true,
  });
  const pineMaterial = new THREE.MeshStandardMaterial({
    color: 0x294b32, roughness: 0.98, flatShading: true,
  });

  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const meshes = [];

  for (const [key, bucket] of buckets) {
    const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, bucket.deciduous.length + bucket.pine.length);
    const roundCrowns = bucket.deciduous.length
      ? new THREE.InstancedMesh(deciduousGeometry, deciduousMaterial, bucket.deciduous.length)
      : null;
    const pineCrowns = bucket.pine.length
      ? new THREE.InstancedMesh(pineGeometry, pineMaterial, bucket.pine.length)
      : null;

    let trunkIndex = 0, roundIndex = 0, pineIndex = 0;
    for (const tree of bucket.deciduous.concat(bucket.pine)) {
      quaternion.setFromAxisAngle(up, tree.rotation);
      position.set(tree.x, tree.y + 4 * tree.scale, tree.z);
      scale.set(tree.scale, tree.scale, tree.scale);
      matrix.compose(position, quaternion, scale);
      trunks.setMatrixAt(trunkIndex++, matrix);
    }

    for (const tree of bucket.deciduous) {
      quaternion.setFromAxisAngle(up, tree.rotation);
      position.set(tree.x, tree.y + 8.2 * tree.scale, tree.z);
      scale.set(tree.scale * 1.25, tree.scale * 1.25, tree.scale * 1.25);
      matrix.compose(position, quaternion, scale);
      roundCrowns.setMatrixAt(roundIndex, matrix);
      roundCrowns.setColorAt(roundIndex, new THREE.Color().setHSL(
        0.28 + tree.hue * 0.05, 0.34 + tree.hue * 0.17, 0.16 + tree.hue * 0.13
      ));
      roundIndex++;
    }

    for (const tree of bucket.pine) {
      quaternion.setFromAxisAngle(up, tree.rotation);
      position.set(tree.x, tree.y + 9.6 * tree.scale, tree.z);
      scale.set(tree.scale * 1.18, tree.scale * 1.12, tree.scale * 1.18);
      matrix.compose(position, quaternion, scale);
      pineCrowns.setMatrixAt(pineIndex, matrix);
      pineCrowns.setColorAt(pineIndex, new THREE.Color().setHSL(
        0.31 + tree.hue * 0.035, 0.34 + tree.hue * 0.18, 0.14 + tree.hue * 0.11
      ));
      pineIndex++;
    }

    trunks.instanceMatrix.needsUpdate = true;
    trunks.castShadow = false;
    trunks.receiveShadow = false;
    trunks.name = `forest-trunks-${key}`;
    registerChunkMesh(trunks, renderables, 2800);
    scene.add(trunks);
    meshes.push(trunks);

    if (roundCrowns) {
      roundCrowns.instanceMatrix.needsUpdate = true;
      if (roundCrowns.instanceColor) roundCrowns.instanceColor.needsUpdate = true;
      roundCrowns.userData.noCollider = true;
      roundCrowns.castShadow = false;
      roundCrowns.receiveShadow = false;
      roundCrowns.name = `forest-crowns-${key}`;
      registerChunkMesh(roundCrowns, renderables, 2800);
      scene.add(roundCrowns);
      meshes.push(roundCrowns);
    }

    if (pineCrowns) {
      pineCrowns.instanceMatrix.needsUpdate = true;
      if (pineCrowns.instanceColor) pineCrowns.instanceColor.needsUpdate = true;
      pineCrowns.userData.noCollider = true;
      pineCrowns.castShadow = false;
      pineCrowns.receiveShadow = false;
      pineCrowns.name = `forest-pines-${key}`;
      registerChunkMesh(pineCrowns, renderables, 2800);
      scene.add(pineCrowns);
      meshes.push(pineCrowns);
    }
  }

  // Keep trunks solid without registering ~140k individual Three.js
  // collider objects. A compact spatial grid answers only nearby tree queries.
  const collisionCellSize = 16;
  const collisionGrid = new Map();
  for (const tree of trees) {
    const cx = Math.floor(tree.x / collisionCellSize);
    const cz = Math.floor(tree.z / collisionCellSize);
    const key = `${cx},${cz}`;
    let bucket = collisionGrid.get(key);
    if (!bucket) {
      bucket = [];
      collisionGrid.set(key, bucket);
    }
    bucket.push({
      x: tree.x,
      z: tree.z,
      radius: 0.48 * tree.scale,
      minY: tree.y,
      maxY: tree.y + 8 * tree.scale,
      seed: tree.rotation,
    });
  }

  function forestCollision(x, z, feetY, height, radius, resolve = false) {
    let px = x, pz = z, changed = false;
    const iterations = resolve ? 4 : 1;
    for (let iteration = 0; iteration < iterations; iteration++) {
      let pushed = false;
      const minCellX = Math.floor((px - radius - 1) / collisionCellSize);
      const maxCellX = Math.floor((px + radius + 1) / collisionCellSize);
      const minCellZ = Math.floor((pz - radius - 1) / collisionCellSize);
      const maxCellZ = Math.floor((pz + radius + 1) / collisionCellSize);
      for (let cx = minCellX; cx <= maxCellX; cx++) {
        for (let cz = minCellZ; cz <= maxCellZ; cz++) {
          const bucket = collisionGrid.get(`${cx},${cz}`);
          if (!bucket) continue;
          for (const tree of bucket) {
            if (feetY + height <= tree.minY + 0.035 || feetY >= tree.maxY) continue;
            let dx = px - tree.x;
            let dz = pz - tree.z;
            let distance = Math.hypot(dx, dz);
            const combinedRadius = radius + tree.radius;
            if (distance >= combinedRadius) continue;
            if (distance < 0.0001) {
              dx = Math.cos(tree.seed);
              dz = Math.sin(tree.seed);
              distance = 1;
            }
            if (!resolve) return { blocked: true, x: px, z: pz, changed };
            const penetration = combinedRadius - distance + 0.015;
            px += (dx / distance) * penetration;
            pz += (dz / distance) * penetration;
            pushed = changed = true;
          }
        }
      }
      if (!pushed) break;
    }
    return { blocked: changed, x: px, z: pz, changed };
  }

  trunks.userData.noCollider = true;
  return {
    count: trees.length,
    chunks: buckets.size,
    meshes,
    isBlocked(x, feetY, z, radius, height) {
      return forestCollision(x, z, feetY, height, radius, false).blocked;
    },
    resolve(x, z, feetY, radius, height) {
      return forestCollision(x, z, feetY, height, radius, true);
    },
  };
}

function createRocks(scene, heightAt, routePoints, rnd, renderables) {
  const boulderData = [];
  const smallData = [];
  let attempts = 0;

  while (boulderData.length < 760 && attempts < 12000) {
    attempts++;
    const angle = rnd() * TAU;
    const radius = 270 + rnd() * (GRASS_RADIUS - 470);
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    if (pointInReservedArea(x, z, routePoints) || rnd() < 0.28) continue;
    const sy = 1.15 + rnd() * 3.4;
    const sx = 1.8 + rnd() * 4.4;
    const sz = 1.8 + rnd() * 4.4;
    boulderData.push({ x, z, y: heightAt(x, z) ?? 0, sx, sy, sz, angle: rnd() * TAU });
  }

  attempts = 0;
  while (smallData.length < 3200 && attempts < 30000) {
    attempts++;
    const angle = rnd() * TAU;
    const radius = 255 + rnd() * (GRASS_RADIUS - 330);
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    if (pointInReservedArea(x, z, routePoints)) continue;
    smallData.push({
      x, z, y: heightAt(x, z) ?? 0,
      sx: 0.6 + rnd() * 1.4, sy: 0.35 + rnd() * 0.85, sz: 0.6 + rnd() * 1.4,
      angle: rnd() * TAU,
    });
  }

  const chunkSize = 640;
  const buckets = new Map();
  const addToBucket = (rock, type) => {
    const cx = Math.floor(rock.x / chunkSize);
    const cz = Math.floor(rock.z / chunkSize);
    const key = `${cx},${cz}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { large: [], small: [] };
      buckets.set(key, bucket);
    }
    bucket[type].push(rock);
  };
  for (const rock of boulderData) addToBucket(rock, 'large');
  for (const rock of smallData) addToBucket(rock, 'small');

  const rockGeometry = new THREE.IcosahedronGeometry(1, 0);
  const largeMaterial = new THREE.MeshStandardMaterial({
    color: 0x777568, roughness: 1, flatShading: true,
  });
  const smallMaterial = new THREE.MeshStandardMaterial({
    color: 0x827d6b, roughness: 1, flatShading: true,
  });
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const meshes = [];

  for (const [key, bucket] of buckets) {
    if (bucket.large.length) {
      const largeRocks = new THREE.InstancedMesh(rockGeometry, largeMaterial, bucket.large.length);
      for (let i = 0; i < bucket.large.length; i++) {
        const rock = bucket.large[i];
        quaternion.setFromAxisAngle(up, rock.angle);
        position.set(rock.x, rock.y + rock.sy * 0.48, rock.z);
        scale.set(rock.sx, rock.sy, rock.sz);
        matrix.compose(position, quaternion, scale);
        largeRocks.setMatrixAt(i, matrix);
      }
      largeRocks.instanceMatrix.needsUpdate = true;
      largeRocks.castShadow = true;
      largeRocks.receiveShadow = true;
      largeRocks.name = `boulders-${key}`;
      registerChunkMesh(largeRocks, renderables, 2500);
      scene.add(largeRocks);
      meshes.push(largeRocks);
    }

    if (bucket.small.length) {
      const smallRocks = new THREE.InstancedMesh(rockGeometry, smallMaterial, bucket.small.length);
      for (let i = 0; i < bucket.small.length; i++) {
        const rock = bucket.small[i];
        quaternion.setFromAxisAngle(up, rock.angle);
        position.set(rock.x, rock.y + rock.sy * 0.38, rock.z);
        scale.set(rock.sx, rock.sy, rock.sz);
        matrix.compose(position, quaternion, scale);
        smallRocks.setMatrixAt(i, matrix);
      }
      smallRocks.instanceMatrix.needsUpdate = true;
      smallRocks.userData.noCollider = true;
      smallRocks.castShadow = false;
      smallRocks.receiveShadow = false;
      smallRocks.name = `stones-${key}`;
      registerChunkMesh(smallRocks, renderables, 1500);
      scene.add(smallRocks);
      meshes.push(smallRocks);
    }
  }

  return {
    boulders: boulderData.length,
    stones: smallData.length,
    chunks: buckets.size,
    meshes,
  };
}

function createHouse(scene, materials, baseY = 0) {
  const house = new THREE.Group();
  house.position.set(-1600, baseY, 900);
  scene.add(house);

  const wall = materials.wall;
  const trim = materials.trim;
  const wood = materials.wood;
  const glass = materials.glass;

  const floor = new THREE.Mesh(new THREE.BoxGeometry(17, 0.35, 13), materials.floor);
  floor.position.set(0, 0.1, 0);
  floor.receiveShadow = true;
  floor.userData.walkable = true;
  house.add(floor);

  const wallHeight = 4.25;
  const wallY = 0.35 + wallHeight * 0.5;
  const sideWall = (x, z, sx, sz) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, wallHeight, sz), wall);
    mesh.position.set(x, wallY, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    house.add(mesh);
  };

  sideWall(0, -6.25, 17, 0.5);
  sideWall(-8.25, 0, 0.5, 13);
  sideWall(8.25, -4.45, 0.5, 4.4);
  sideWall(8.25, 4.45, 0.5, 4.4);

  const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.55, 3.9), trim);
  lintel.position.set(8.25, 4.0, 0);
  lintel.castShadow = true;
  house.add(lintel);

  for (const z of [-1.75, 1.75]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.72, 4.1, 0.42), trim);
    post.position.set(8.27, 2.35, z);
    post.castShadow = true;
    house.add(post);
  }

  const roofShape = new THREE.Shape();
  roofShape.moveTo(-9.1, 4.45);
  roofShape.lineTo(0, 7.25);
  roofShape.lineTo(9.1, 4.45);
  roofShape.closePath();
  const roofGeo = new THREE.ExtrudeGeometry(roofShape, {
    depth: 13.8, bevelEnabled: false, steps: 1,
  });
  roofGeo.translate(0, 0, -6.9);
  const roof = new THREE.Mesh(roofGeo, materials.roof);
  roof.castShadow = true;
  roof.receiveShadow = true;
  house.add(roof);

  for (const z of [-3.8, 3.8]) {
    const pane = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.5, 1.9), glass);
    pane.position.set(8.27, 2.65, z);
    house.add(pane);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.8, 2.2), trim);
    frame.position.set(8.2, 2.65, z);
    frame.castShadow = true;
    house.add(frame);
  }

  const bed = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.55, 2.6), wood);
  bed.position.set(-4.1, 0.55, -3.0);
  bed.castShadow = true;
  house.add(bed);

  const tableTop = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.18, 1.5), wood);
  tableTop.position.set(-2.7, 1.15, 2.8);
  tableTop.castShadow = true;
  house.add(tableTop);
  for (const x of [-3.55, -1.85]) {
    for (const z of [2.25, 3.35]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.1, 0.15), wood);
      leg.position.set(x, 0.62, z);
      house.add(leg);
    }
  }

  const chimney = new THREE.Mesh(new THREE.BoxGeometry(1.2, 3.0, 1.2), trim);
  chimney.position.set(-5.3, 5.1, -2.8);
  chimney.castShadow = true;
  house.add(chimney);

  const lamp = new THREE.PointLight(0xffc77e, 3.5, 22, 2);
  lamp.position.set(0, 3.45, 0);
  house.add(lamp);

  const porch = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.25, 7.2), materials.path);
  porch.position.set(10.7, 0.12, 0);
  porch.receiveShadow = true;
  porch.userData.walkable = true;
  house.add(porch);

  return {
    house,
    spawn: {
      x: -1600,
      y: baseY + 0.30,
      z: 903.8,
      lookAt: { x: 0, y: 24, z: 0 },
    },
  };
}

function addRibbonChunks(scene, points, halfWidth, y, material, name, options = {}) {
  const meshes = [];
  const pointsPerChunk = 12;
  for (let start = 0, part = 0; start < points.length - 1; start += pointsPerChunk, part++) {
    const end = Math.min(points.length - 1, start + pointsPerChunk);
    const mesh = new THREE.Mesh(
      makeRibbon(points.slice(start, end + 1), halfWidth, y, options.heightAt ?? null, points, start), material
    );
    mesh.name = `${name}-${part}`;
    mesh.frustumCulled = true;
    mesh.geometry.computeBoundingSphere();
    if (options.noCollider) mesh.userData.noCollider = true;
    if (options.walkable) mesh.userData.walkable = true;
    if (options.receiveShadow) mesh.receiveShadow = true;
    if (options.renderOrder !== undefined) mesh.renderOrder = options.renderOrder;
    scene.add(mesh);
    meshes.push(mesh);
  }
  return meshes;
}

function createRiver(scene, rnd) {
  const centerX = mainRiverX;
  const points = [];
  for (let i = 0; i <= 150; i++) {
    const z = -4500 + (9000 * i) / 150;
    points.push({ x: centerX(z), z });
  }

  const waterMaterial = new THREE.MeshStandardMaterial({
    color: 0x347f8b, roughness: 0.22, metalness: 0.18,
    transparent: true, opacity: 0.88, side: THREE.DoubleSide,
  });
  const water = addRibbonChunks(scene, points, 30, 0.035, waterMaterial,
    'main-river-water', { noCollider: true, renderOrder: 2 });

  const bedMaterial = new THREE.MeshStandardMaterial({ color: 0x394d46, roughness: 1 });
  const bed = addRibbonChunks(scene, points, 29, -2.65, bedMaterial,
    'main-river-bed', { walkable: true, receiveShadow: true });

  const pebbleGeo = new THREE.IcosahedronGeometry(2.2, 0);
  const pebbleMat = new THREE.MeshStandardMaterial({ color: 0x756c56, roughness: 1 });
  const pebbleBuckets = new Map();
  for (let i = 0; i < 340; i++) {
    const z = -4400 + rnd() * 8800;
    const side = rnd() < 0.5 ? -1 : 1;
    const x = centerX(z) + side * (32 + rnd() * 7);
    const key = `${Math.floor(x / 640)},${Math.floor(z / 640)}`;
    let bucket = pebbleBuckets.get(key);
    if (!bucket) { bucket = []; pebbleBuckets.set(key, bucket); }
    bucket.push({ x, z, y: 0.3 + rnd() * 0.6, scale: 0.55 + rnd() * 0.85, angle: rnd() * TAU });
  }

  const pebbleMeshes = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const scale = new THREE.Vector3();
  for (const [key, data] of pebbleBuckets) {
    const pebbles = new THREE.InstancedMesh(pebbleGeo, pebbleMat, data.length);
    pebbles.userData.noCollider = true;
    pebbles.name = `river-pebbles-${key}`;
    pebbles.castShadow = false;
    for (let i = 0; i < data.length; i++) {
      const pebble = data[i];
      p.set(pebble.x, pebble.y, pebble.z);
      scale.set(pebble.scale, 0.35 + pebble.scale * 0.5, pebble.scale);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), pebble.angle);
      m.compose(p, q, scale);
      pebbles.setMatrixAt(i, m);
    }
    pebbles.instanceMatrix.needsUpdate = true;
    pebbles.computeBoundingSphere();
    pebbles.frustumCulled = true;
    scene.add(pebbles);
    pebbleMeshes.push(pebbles);
  }

  return {
    water, bed, centerX, halfWidth: 30,
    region: {
      id: 'river',
      surfaceY: 0.035,
      bottomY: -2.65,
      exitFeetY: 0.55,
      exitHeight: 0.55,
      contains: (x, z) => Math.abs(x - centerX(z)) <= 28,
    },
  };
}

function createTributary(scene) {
  const centerZ = tributaryZ;
  const points = [];
  for (let i = 0; i <= 100; i++) {
    const x = -2800 + (5600 * i) / 100;
    points.push({ x, z: centerZ(x) });
  }

  const waterMaterial = new THREE.MeshStandardMaterial({
    color: 0x3c8992, roughness: 0.24, metalness: 0.14,
    transparent: true, opacity: 0.88, side: THREE.DoubleSide,
  });
  const water = addRibbonChunks(scene, points, 22, 0.035, waterMaterial,
    'tributary-water', { noCollider: true, renderOrder: 2 });

  const bedMaterial = new THREE.MeshStandardMaterial({ color: 0x45564c, roughness: 1 });
  const bed = addRibbonChunks(scene, points, 21, -2.1, bedMaterial,
    'tributary-bed', { walkable: true, receiveShadow: true });

  return {
    water, bed,
    region: {
      id: 'south-river',
      surfaceY: 0.035,
      bottomY: -2.1,
      exitFeetY: 0.85,
      exitHeight: 0.85,
      contains: (x, z) => Math.abs(z - centerZ(x)) <= 20,
    },
  };
}

export function createWorld(scene) {
  const rnd = seededRandom();
  const routePoints = [
    { x: -1588, z: 900 },
    { x: -1320, z: 760 },
    { x: -1050, z: 545 },
    { x: -785, z: 300 },
    { x: -750, z: 300 },
    { x: -630, z: 300 },
    { x: -600, z: 300 },
    { x: -360, z: 205 },
    { x: 0, z: 190 },
  ];

  const heightAt = createHeightFunction(routePoints);
  const renderables = [];
  const terrain = createTerrain(scene, heightAt, renderables);

  // Road is sampled slightly above the exact terrain function to prevent
  // z-fighting and disappearing strips between the 12.5m terrain triangles.
  // Across the river it becomes a real approach ramp that meets the bridge deck.
  const roadSurfaceY = (x, z) => {
    const groundY = (heightAt(x, z) ?? 0) + 0.42;
    const distanceAlongBridge = Math.abs(x + 692);
    const bridgeTop = 1.08 * (1 - smoothstep(45, 94, distanceAlongBridge));
    const bridgeCorridor = 1 - smoothstep(7, 14, Math.abs(z - 300));
    return THREE.MathUtils.lerp(
      groundY,
      Math.max(groundY, bridgeTop + 0.04),
      bridgeCorridor
    );
  };

  const routeCurve = new THREE.CatmullRomCurve3(
    routePoints.map((point) => new THREE.Vector3(
      point.x, roadSurfaceY(point.x, point.z), point.z
    )),
    false, 'centripetal'
  );
  const roadPoints = routeCurve.getPoints(240).map((point) => ({ x: point.x, z: point.z }));
  const road = addRibbonChunks(
    scene, roadPoints, 3.8, 0.065,
    new THREE.MeshStandardMaterial({ color: 0x85775e, roughness: 1 }),
    'house-to-fountain-road',
    { walkable: true, receiveShadow: true, heightAt: roadSurfaceY }
  );

  const bridge = new THREE.Group();
  bridge.position.set(-692, 0, 300);
  const bridgeDeck = new THREE.Mesh(new THREE.BoxGeometry(90, 0.30, 10), new THREE.MeshStandardMaterial({
    color: 0x715239, roughness: 0.9,
  }));
  // Top surface = 1.08m, safely above the water-entry threshold (0.335m).
  bridgeDeck.position.y = 0.93;
  bridgeDeck.castShadow = true;
  bridgeDeck.receiveShadow = true;
  bridgeDeck.userData.walkable = true;
  bridge.add(bridgeDeck);

  const railMaterial = new THREE.MeshStandardMaterial({ color: 0x503a2b, roughness: 0.95 });
  for (const z of [-4.8, 4.8]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(90, 0.8, 0.28), railMaterial);
    rail.position.set(0, 1.28, z);
    rail.castShadow = true;
    bridge.add(rail);
  }
  for (let x = -42; x <= 42; x += 10) {
    for (const z of [-4.6, 4.6]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.32, 1.2, 0.32), railMaterial);
      post.position.set(x, 1.55, z);
      post.castShadow = true;
      bridge.add(post);
    }
  }
  scene.add(bridge);

  const houseBase = heightAt(-1600, 900) ?? 0;
  const house = createHouse(scene, {
    wall: new THREE.MeshStandardMaterial({ color: 0xb9a17e, roughness: 0.92 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x634a34, roughness: 0.9 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x805b3e, roughness: 0.9 }),
    floor: new THREE.MeshStandardMaterial({ color: 0x8a7359, roughness: 0.96 }),
    roof: new THREE.MeshStandardMaterial({ color: 0x56433a, roughness: 0.92 }),
    path: new THREE.MeshStandardMaterial({ color: 0x8a7659, roughness: 0.95 }),
    glass: new THREE.MeshStandardMaterial({
      color: 0x87bfd0, emissive: 0x172d38, transparent: true, opacity: 0.42,
    }),
  }, houseBase);

  const river = createRiver(scene, rnd);
  const tributary = createTributary(scene);
  const forests = createForests(scene, heightAt, routePoints, rnd, renderables);
  const rocks = createRocks(scene, heightAt, routePoints, rnd, renderables);

  return {
    house: house.house,
    spawn: house.spawn,
    river,
    tributary,
    forests,
    isForestBlocked: forests.isBlocked,
    resolveForestPosition: forests.resolve,
    rocks,
    terrain,
    renderables,
    route: road,
    bridge,
    heightAt,
    getWaterRegionAt(x, z) {
      return this.waterRegions.find((region) => region.contains(x, z)) || null;
    },
    waterRegions: [
      {
        id: 'fountain',
        surfaceY: WATER_Y,
        bottomY: POOL_BOTTOM_Y,
        exitFeetY: WATER_Y + 1.9,
        exitHeight: 1.9,
        contains: (x, z) => Math.hypot(x, z) < POOL_RADIUS - 2.0,
      },
      river.region,
      tributary.region,
    ],
  };
}
