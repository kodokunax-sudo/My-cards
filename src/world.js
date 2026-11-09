import * as THREE from 'three';
import {
  POOL_RADIUS, POOL_BOTTOM_Y, WATER_Y, GRASS_RADIUS,
} from './config.js';

const TAU = Math.PI * 2;
const HILLS = [
  [-3050, -1950, 760, 78], [2380, -2380, 820, 108],
  [2820, 2180, 880, 94], [-3280, 2900, 730, 86],
  [300, -4050, 690, 92], [-4250, -750, 640, 76],
  [4420, 850, 580, 72], [900, 3970, 620, 84],
  [-1150, -3250, 540, 58], [1650, 950, 520, 48],
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

function createHeightFunction(routePoints) {
  return (x, z) => {
    if (Math.hypot(x, z) > GRASS_RADIUS + 30) return null;

    const broad = (valueNoise(x / 1550, z / 1550, 11) - 0.5) * 86;
    const rolling = (valueNoise(x / 560, z / 560, 17) - 0.5) * 32;
    const detail = (valueNoise(x / 205, z / 205, 23) - 0.5) * 8;
    const ridgeNoise = 1 - Math.abs(valueNoise(x / 880, z / 880, 31) * 2 - 1);
    let height = broad + rolling + detail + (ridgeNoise - 0.48) * 15;

    for (const [hx, hz, radius, peak] of HILLS) {
      const dx = x - hx, dz = z - hz;
      height += peak * Math.exp(-(dx * dx + dz * dz) / (2 * radius * radius));
    }

    // A low natural valley, plus flatter ground around the fountain, house and trail.
    const parkBlend = 1 - smoothstep(210, 390, Math.hypot(x, z));
    const houseBlend = 1 - smoothstep(78, 175, Math.hypot(x + 1600, z - 900));
    const trailBlend = 1 - smoothstep(18, 100, distanceToPolyline(x, z, routePoints));
    const riverBlend = 1 - smoothstep(42, 112, Math.abs(x - mainRiverX(z)));
    const tributaryBlend = 1 - smoothstep(34, 92, Math.abs(z - tributaryZ(x)));
    const flatten = Math.max(parkBlend, houseBlend, trailBlend, riverBlend, tributaryBlend);
    height *= 1 - flatten;

    // A few shallow gullies keep the valleys from reading as smooth bumps.
    const gully = Math.pow(Math.max(0, 1 - Math.abs(valueNoise(x / 720, z / 720, 49) * 2 - 1)), 5);
    height -= gully * 5.5 * (1 - parkBlend);
    return THREE.MathUtils.clamp(height, -18, 148);
  };
}

function createTerrain(scene, heightAt) {
  const segments = 420;
  const size = GRASS_RADIUS * 2;
  const step = size / segments;
  const positions = new Float32Array((segments + 1) * (segments + 1) * 3);
  const colors = new Float32Array((segments + 1) * (segments + 1) * 3);
  const indices = [];

  const low = new THREE.Color(0x3c5a32);
  const grass = new THREE.Color(0x557542);
  const high = new THREE.Color(0x64704b);
  const rock = new THREE.Color(0x777461);
  const color = new THREE.Color();

  for (let iz = 0; iz <= segments; iz++) {
    const z = -GRASS_RADIUS + iz * step;
    for (let ix = 0; ix <= segments; ix++) {
      const x = -GRASS_RADIUS + ix * step;
      const index = (iz * (segments + 1) + ix) * 3;
      const h = heightAt(x, z) ?? 0;
      positions[index] = x;
      positions[index + 1] = h;
      positions[index + 2] = z;

      const variation = valueNoise(x / 115, z / 115, 61);
      color.copy(grass).lerp(low, (1 - variation) * 0.32);
      color.lerp(high, smoothstep(35, 90, h) * 0.62);
      color.lerp(rock, smoothstep(0.12, 0.42, Math.abs(h) / 148) * smoothstep(65, 120, h) * 0.46);
      const tint = 0.92 + variation * 0.16;
      colors[index] = color.r * tint;
      colors[index + 1] = color.g * tint;
      colors[index + 2] = color.b * tint;
    }
  }

  for (let iz = 0; iz < segments; iz++) {
    const z = -GRASS_RADIUS + (iz + 0.5) * step;
    for (let ix = 0; ix < segments; ix++) {
      const x = -GRASS_RADIUS + (ix + 0.5) * step;
      const radius = Math.hypot(x, z);
      if (radius < 176 || radius > GRASS_RADIUS - 1) continue;
      const a = iz * (segments + 1) + ix;
      const b = a + 1;
      const c = a + segments + 1;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const terrain = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 1, metalness: 0,
  }));
  terrain.receiveShadow = true;
  terrain.userData.noCollider = true;
  terrain.frustumCulled = true;
  terrain.name = 'procedural-hilly-terrain';
  scene.add(terrain);
  return terrain;
}

function makeRibbon(points, halfWidth, y, heightAt = null) {
  const positions = [];
  const indices = [];
  for (let i = 0; i < points.length; i++) {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
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
  if (Math.hypot(x + 1600, z - 900) < 175) return true;
  if (distanceToPolyline(x, z, routePoints) < 22) return true;
  if (Math.abs(x - mainRiverX(z)) < 70) return true;
  if (Math.abs(z - tributaryZ(x)) < 52) return true;
  return false;
}

function createForests(scene, heightAt, routePoints, rnd) {
  const trees = [];
  const cell = 25;
  const half = GRASS_RADIUS - 80;
  for (let x0 = -half; x0 <= half && trees.length < 42000; x0 += cell) {
    for (let z0 = -half; z0 <= half && trees.length < 42000; z0 += cell) {
      const x = x0 + (rnd() - 0.5) * cell * 0.82;
      const z = z0 + (rnd() - 0.5) * cell * 0.82;
      if (Math.hypot(x, z) > half || pointInReservedArea(x, z, routePoints)) continue;

      const forestMask =
        valueNoise(x / 1250, z / 1250, 71) * 0.62 +
        valueNoise(x / 2650, z / 2650, 73) * 0.38;
      if (forestMask < 0.35 || rnd() > 0.74) continue;

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

  const trunks = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.25, 0.48, 8, 7),
    new THREE.MeshStandardMaterial({ color: 0x59432f, roughness: 1 }),
    trees.length
  );
  const roundCrowns = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(5.3, 0),
    new THREE.MeshStandardMaterial({ color: 0x315b35, roughness: 0.98, flatShading: true }),
    trees.filter((tree) => !tree.pine).length
  );
  const pineCrowns = new THREE.InstancedMesh(
    new THREE.ConeGeometry(4.9, 10.8, 7, 1),
    new THREE.MeshStandardMaterial({ color: 0x294b32, roughness: 0.98, flatShading: true }),
    trees.filter((tree) => tree.pine).length
  );

  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  let roundIndex = 0, pineIndex = 0;

  for (let i = 0; i < trees.length; i++) {
    const tree = trees[i];
    quaternion.setFromAxisAngle(up, tree.rotation);
    position.set(tree.x, tree.y + 4 * tree.scale, tree.z);
    scale.set(tree.scale, tree.scale, tree.scale);
    matrix.compose(position, quaternion, scale);
    trunks.setMatrixAt(i, matrix);

    if (tree.pine) {
      position.set(tree.x, tree.y + 9.6 * tree.scale, tree.z);
      scale.set(tree.scale * 1.18, tree.scale * 1.12, tree.scale * 1.18);
      matrix.compose(position, quaternion, scale);
      pineCrowns.setMatrixAt(pineIndex, matrix);
      pineCrowns.setColorAt(pineIndex, new THREE.Color().setHSL(
        0.31 + tree.hue * 0.035, 0.34 + tree.hue * 0.18, 0.14 + tree.hue * 0.11
      ));
      pineIndex++;
    } else {
      position.set(tree.x, tree.y + 8.2 * tree.scale, tree.z);
      scale.set(tree.scale * 1.25, tree.scale * 1.25, tree.scale * 1.25);
      matrix.compose(position, quaternion, scale);
      roundCrowns.setMatrixAt(roundIndex, matrix);
      roundCrowns.setColorAt(roundIndex, new THREE.Color().setHSL(
        0.28 + tree.hue * 0.05, 0.34 + tree.hue * 0.17, 0.16 + tree.hue * 0.13
      ));
      roundIndex++;
    }
  }

  trunks.instanceMatrix.needsUpdate = true;
  roundCrowns.instanceMatrix.needsUpdate = true;
  pineCrowns.instanceMatrix.needsUpdate = true;
  if (roundCrowns.instanceColor) roundCrowns.instanceColor.needsUpdate = true;
  if (pineCrowns.instanceColor) pineCrowns.instanceColor.needsUpdate = true;

  // Only the trunks collide. The canopy is visual foliage and can never trap the player.
  roundCrowns.userData.noCollider = true;
  pineCrowns.userData.noCollider = true;
  trunks.castShadow = true;
  roundCrowns.castShadow = true;
  pineCrowns.castShadow = true;
  roundCrowns.receiveShadow = true;
  scene.add(trunks, roundCrowns, pineCrowns);

  return { count: trees.length, trunks, roundCrowns, pineCrowns };
}

function createRocks(scene, heightAt, routePoints, rnd) {
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

  const rockGeometry = new THREE.IcosahedronGeometry(1, 0);
  const largeRocks = new THREE.InstancedMesh(
    rockGeometry,
    new THREE.MeshStandardMaterial({ color: 0x777568, roughness: 1, flatShading: true }),
    boulderData.length
  );
  const smallRocks = new THREE.InstancedMesh(
    rockGeometry,
    new THREE.MeshStandardMaterial({ color: 0x827d6b, roughness: 1, flatShading: true }),
    smallData.length
  );

  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  for (let i = 0; i < boulderData.length; i++) {
    const rock = boulderData[i];
    quaternion.setFromAxisAngle(up, rock.angle);
    position.set(rock.x, rock.y + rock.sy * 0.48, rock.z);
    scale.set(rock.sx, rock.sy, rock.sz);
    matrix.compose(position, quaternion, scale);
    largeRocks.setMatrixAt(i, matrix);
  }
  for (let i = 0; i < smallData.length; i++) {
    const rock = smallData[i];
    quaternion.setFromAxisAngle(up, rock.angle);
    position.set(rock.x, rock.y + rock.sy * 0.38, rock.z);
    scale.set(rock.sx, rock.sy, rock.sz);
    matrix.compose(position, quaternion, scale);
    smallRocks.setMatrixAt(i, matrix);
  }

  largeRocks.instanceMatrix.needsUpdate = true;
  smallRocks.instanceMatrix.needsUpdate = true;
  smallRocks.userData.noCollider = true;
  largeRocks.castShadow = true;
  smallRocks.castShadow = true;
  largeRocks.receiveShadow = true;
  scene.add(largeRocks, smallRocks);
  return { boulders: largeRocks, stones: smallRocks, count: boulderData.length + smallData.length };
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

function createRiver(scene, rnd) {
  const centerX = mainRiverX;
  const points = [];
  for (let i = 0; i <= 150; i++) {
    const z = -4500 + (9000 * i) / 150;
    points.push({ x: centerX(z), z });
  }

  const water = new THREE.Mesh(
    makeRibbon(points, 30, 0.035),
    new THREE.MeshStandardMaterial({
      color: 0x347f8b, roughness: 0.22, metalness: 0.18,
      transparent: true, opacity: 0.88, side: THREE.DoubleSide,
    })
  );
  water.userData.noCollider = true;
  water.renderOrder = 2;
  scene.add(water);

  const bed = new THREE.Mesh(
    makeRibbon(points, 29, -2.65),
    new THREE.MeshStandardMaterial({ color: 0x394d46, roughness: 1 })
  );
  bed.receiveShadow = true;
  bed.userData.walkable = true;
  scene.add(bed);

  const pebbleGeo = new THREE.IcosahedronGeometry(2.2, 0);
  const pebbleMat = new THREE.MeshStandardMaterial({ color: 0x756c56, roughness: 1 });
  const pebbles = new THREE.InstancedMesh(pebbleGeo, pebbleMat, 340);
  pebbles.userData.noCollider = true;
  pebbles.castShadow = true;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  for (let i = 0; i < 340; i++) {
    const z = -4400 + rnd() * 8800;
    const side = rnd() < 0.5 ? -1 : 1;
    const x = centerX(z) + side * (32 + rnd() * 7);
    p.set(x, 0.3 + rnd() * 0.6, z);
    s.set(0.55 + rnd() * 0.85, 0.35 + rnd() * 0.55, 0.55 + rnd() * 0.85);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * TAU);
    m.compose(p, q, s);
    pebbles.setMatrixAt(i, m);
  }
  pebbles.instanceMatrix.needsUpdate = true;
  scene.add(pebbles);

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

  const water = new THREE.Mesh(
    makeRibbon(points, 22, 0.035),
    new THREE.MeshStandardMaterial({
      color: 0x3c8992, roughness: 0.24, metalness: 0.14,
      transparent: true, opacity: 0.88, side: THREE.DoubleSide,
    })
  );
  water.userData.noCollider = true;
  water.renderOrder = 2;
  scene.add(water);

  const bed = new THREE.Mesh(
    makeRibbon(points, 21, -2.1),
    new THREE.MeshStandardMaterial({ color: 0x45564c, roughness: 1 })
  );
  bed.userData.walkable = true;
  bed.receiveShadow = true;
  scene.add(bed);

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
  createTerrain(scene, heightAt);

  const routeCurve = new THREE.CatmullRomCurve3(
    routePoints.map((point) => new THREE.Vector3(point.x, heightAt(point.x, point.z) ?? 0, point.z)),
    false, 'centripetal'
  );
  const roadPoints = routeCurve.getPoints(180).map((point) => ({ x: point.x, z: point.z }));
  const road = new THREE.Mesh(
    makeRibbon(roadPoints, 3.3, 0.065, heightAt),
    new THREE.MeshStandardMaterial({ color: 0x85775e, roughness: 1 })
  );
  road.receiveShadow = true;
  road.userData.walkable = true;
  scene.add(road);

  const bridge = new THREE.Group();
  bridge.position.set(-692, 0, 300);
  const bridgeDeck = new THREE.Mesh(new THREE.BoxGeometry(118, 0.25, 10), new THREE.MeshStandardMaterial({
    color: 0x715239, roughness: 0.9,
  }));
  bridgeDeck.position.y = 0.325;
  bridgeDeck.castShadow = true;
  bridgeDeck.receiveShadow = true;
  bridgeDeck.userData.walkable = true;
  bridge.add(bridgeDeck);

  const railMaterial = new THREE.MeshStandardMaterial({ color: 0x503a2b, roughness: 0.95 });
  for (const z of [-4.8, 4.8]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(118, 0.8, 0.28), railMaterial);
    rail.position.set(0, 0.72, z);
    rail.castShadow = true;
    bridge.add(rail);
  }
  for (let x = -55; x <= 55; x += 10) {
    for (const z of [-4.6, 4.6]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.32, 1.2, 0.32), railMaterial);
      post.position.set(x, 1.1, z);
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
  const forests = createForests(scene, heightAt, routePoints, rnd);
  const rocks = createRocks(scene, heightAt, routePoints, rnd);

  return {
    house: house.house,
    spawn: house.spawn,
    river,
    tributary,
    forests,
    rocks,
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
