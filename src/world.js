import * as THREE from 'three';
import {
  EYE_HEIGHT, PLAYER_HEIGHT, POOL_RADIUS, POOL_DEPTH, POOL_BOTTOM_Y,
  WATER_Y, PLAZA_RADIUS, GRASS_RADIUS,
} from './config.js';

function seededRandom(seed = 914207) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function makeRibbon(points, halfWidth, y) {
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
    positions.push(
      p.x + nx * halfWidth, y, p.z + nz * halfWidth,
      p.x - nx * halfWidth, y, p.z - nz * halfWidth
    );
    if (i < points.length - 1) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      // Counter-clockwise winding keeps the road and bank normals facing up.
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function distanceToSegment2D(px, pz, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const len2 = dx * dx + dz * dz || 1;
  const t = THREE.MathUtils.clamp(((px - a.x) * dx + (pz - a.z) * dz) / len2, 0, 1);
  const x = a.x + dx * t, z = a.z + dz * t;
  return Math.hypot(px - x, pz - z);
}

function createHouse(scene, materials) {
  const house = new THREE.Group();
  house.position.set(-1600, 0, 900);
  scene.add(house);

  const wall = materials.wall;
  const trim = materials.trim;
  const wood = materials.wood;
  const glass = materials.glass;

  // A compact one-storey house with a real open doorway facing the fountain.
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

  // Rear/front trim and doorway lintel.
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

  // Windows are transparent glass, so they do not become collision obstacles.
  for (const z of [-3.8, 3.8]) {
    const pane = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.5, 1.9), glass);
    pane.position.set(8.27, 2.65, z);
    pane.userData.noCollider = true;
    house.add(pane);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.8, 2.2), trim);
    frame.position.set(8.2, 2.65, z);
    frame.castShadow = true;
    house.add(frame);
  }

  // Interior furniture: a bed, a table and a small lamp.
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
      y: 0.30,
      z: 900,
      lookAt: { x: 0, y: 24, z: 0 },
    },
  };
}

function createForests(scene, routePoints, rnd) {
  const zones = [
    { x0: -4300, x1: -700, z0: -4100, z1: -1750, count: 165 },
    { x0: 950, x1: 3900, z0: -3800, z1: -900, count: 165 },
    { x0: 1050, x1: 3900, z0: 950, z1: 3650, count: 175 },
    { x0: -4200, x1: -2200, z0: 1050, z1: 3900, count: 145 },
  ];

  const treePositions = [];
  for (const zone of zones) {
    let attempts = 0;
    while (treePositions.length < zones.slice(0, zones.indexOf(zone)).reduce((sum, item) => sum + item.count, 0) + zone.count && attempts < zone.count * 12) {
      attempts++;
      const x = zone.x0 + rnd() * (zone.x1 - zone.x0);
      const z = zone.z0 + rnd() * (zone.z1 - zone.z0);
      if (Math.hypot(x, z) < 460) continue;
      if (Math.hypot(x + 1600, z - 900) < 145) continue;
      if (routePoints.some((point, i) => i < routePoints.length - 1 &&
        distanceToSegment2D(x, z, point, routePoints[i + 1]) < 48)) continue;
      treePositions.push({
        x, z, scale: 0.72 + rnd() * 0.9, rotation: rnd() * Math.PI * 2,
        hue: rnd(),
      });
    }
  }

  const trunkGeo = new THREE.CylinderGeometry(0.38, 0.68, 8, 7);
  const crownGeo = new THREE.IcosahedronGeometry(5.2, 1);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({
    color: 0x59432f, roughness: 1,
  }), treePositions.length);
  const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({
    color: 0x315b35, roughness: 0.98, flatShading: true,
  }), treePositions.length);
  trunks.castShadow = true;
  trunks.receiveShadow = true;
  crowns.castShadow = true;
  crowns.receiveShadow = true;

  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < treePositions.length; i++) {
    const tree = treePositions[i];
    quaternion.setFromAxisAngle(up, tree.rotation);
    position.set(tree.x, 4 * tree.scale, tree.z);
    scale.set(tree.scale, tree.scale, tree.scale);
    matrix.compose(position, quaternion, scale);
    trunks.setMatrixAt(i, matrix);

    position.set(tree.x, 8.4 * tree.scale, tree.z);
    scale.set(tree.scale * 1.25, tree.scale * 1.35, tree.scale * 1.25);
    matrix.compose(position, quaternion, scale);
    crowns.setMatrixAt(i, matrix);
    crowns.setColorAt(i, new THREE.Color().setHSL(
      0.28 + tree.hue * 0.045, 0.32 + tree.hue * 0.18, 0.17 + tree.hue * 0.12
    ));
  }
  trunks.instanceMatrix.needsUpdate = true;
  crowns.instanceMatrix.needsUpdate = true;
  if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
  scene.add(trunks, crowns);

  return { count: treePositions.length, trunks, crowns };
}

function createRiver(scene, rnd) {
  const centerX = (z) => -900 + 840 * Math.sin(z / 1200);
  const points = [];
  const count = 150;
  for (let i = 0; i <= count; i++) {
    const z = -4500 + (9000 * i) / count;
    points.push({ x: centerX(z), z });
  }

  const waterGeometry = makeRibbon(points, 30, 0.035);
  const water = new THREE.Mesh(waterGeometry, new THREE.MeshStandardMaterial({
    color: 0x347f8b, roughness: 0.22, metalness: 0.18,
    transparent: true, opacity: 0.88, side: THREE.DoubleSide,
  }));
  water.userData.noCollider = true;
  water.renderOrder = 2;
  scene.add(water);

  const bedGeometry = makeRibbon(points, 29, -2.65);
  const bed = new THREE.Mesh(bedGeometry, new THREE.MeshStandardMaterial({
    color: 0x394d46, roughness: 1,
  }));
  bed.receiveShadow = true;
  bed.userData.walkable = true;
  scene.add(bed);

  // Low pebble banks define the river edge without making a continuous wall.
  const pebbleGeo = new THREE.IcosahedronGeometry(2.2, 0);
  const pebbleMat = new THREE.MeshStandardMaterial({ color: 0x756c56, roughness: 1 });
  const pebbles = new THREE.InstancedMesh(pebbleGeo, pebbleMat, 340);
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
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6.28);
    m.compose(p, q, s);
    pebbles.setMatrixAt(i, m);
  }
  pebbles.instanceMatrix.needsUpdate = true;
  scene.add(pebbles);

  return {
    water,
    bed,
    centerX,
    halfWidth: 30,
    region: {
      id: 'river',
      surfaceY: 0.035,
      bottomY: -2.65,
      contains: (x, z) => Math.abs(x - centerX(z)) <= 28,
    },
  };
}

function createPlains(scene) {
  const patches = [
    { x: -3000, z: -400, r: 900, color: 0x62774a },
    { x: 2700, z: 250, r: 1050, color: 0x74814b },
    { x: -500, z: 3200, r: 720, color: 0x65764b },
    { x: 900, z: -3300, r: 760, color: 0x6c7e4e },
  ];
  const group = new THREE.Group();
  for (const patch of patches) {
    const mesh = new THREE.Mesh(
      new THREE.CircleGeometry(patch.r, 72),
      new THREE.MeshStandardMaterial({ color: patch.color, roughness: 1 })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(patch.x, -0.045, patch.z);
    mesh.userData.noCollider = true;
    group.add(mesh);
  }
  scene.add(group);
  return group;
}

export function createWorld(scene) {
  const rnd = seededRandom();
  const routePoints = [
    { x: -1588, z: 900 },
    { x: -1320, z: 760 },
    { x: -1050, z: 545 },
    { x: -780, z: 300 },
    { x: -600, z: 300 },
    { x: -360, z: 205 },
    { x: 0, z: 190 },
  ];

  // An 8-metre-wide country lane guides the player from the house to the park.
  const routeCurve = new THREE.CatmullRomCurve3(
    routePoints.map((point) => new THREE.Vector3(point.x, 0, point.z)),
    false, 'centripetal'
  );
  const roadPoints = routeCurve.getPoints(150).map((point) => ({ x: point.x, z: point.z }));
  const road = new THREE.Mesh(makeRibbon(roadPoints, 5.2, 0.065), new THREE.MeshStandardMaterial({
    color: 0x85775e, roughness: 1,
  }));
  road.receiveShadow = true;
  road.userData.walkable = true;
  scene.add(road);

  // A timber footbridge crosses the river where the path meets it.
  const bridge = new THREE.Group();
  bridge.position.set(-692, 0, 300);
  const bridgeDeck = new THREE.Mesh(new THREE.BoxGeometry(118, 0.25, 10), new THREE.MeshStandardMaterial({
    color: 0x715239, roughness: 0.9,
  }));
  bridgeDeck.position.y = 0.05;
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
  });

  const river = createRiver(scene, rnd);
  createForests(scene, routePoints, rnd);
  const plains = createPlains(scene);

  return {
    house: house.house,
    spawn: house.spawn,
    river,
    plains,
    route: road,
    bridge,
    waterRegions: [
      {
        id: 'fountain',
        surfaceY: WATER_Y,
        bottomY: POOL_BOTTOM_Y,
        contains: (x, z) => Math.hypot(x, z) < POOL_RADIUS - 2.0,
      },
      river.region,
    ],
    getWaterRegionAt(x, z) {
      return this.waterRegions.find((region) => region.contains(x, z)) || null;
    },
  };
}
