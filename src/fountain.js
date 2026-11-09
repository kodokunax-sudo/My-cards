import * as THREE from 'three';
import {
  FOUNTAIN_HEIGHT, POOL_RADIUS, POOL_DEPTH, POOL_BOTTOM_Y, WATER_Y,
  ISLAND_RADIUS, ISLAND_TOP, BOWLS, PALETTE, jetTrajectory,
} from './config.js';

/** Радиальная фрезеровка (каннелюры) на токарном профиле. */
function flute(geo, count, amp) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const r = Math.hypot(x, z);
    if (r < 1e-4) continue;
    const phi = Math.atan2(x, z);
    const k = 1 + amp * Math.cos(count * phi);
    pos.setX(i, x * k);
    pos.setZ(i, z * k);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

function lathe(points, segments = 96, fluteCount = 0, fluteAmp = 0) {
  const geo = new THREE.LatheGeometry(points, segments);
  if (fluteCount) flute(geo, fluteCount, fluteAmp);
  return geo;
}

/** Текстура-табличка с текстом. */
function signTexture() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#2a2318';
  g.fillRect(0, 0, 1024, 512);
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, 'rgba(255,235,190,0.16)');
  grad.addColorStop(1, 'rgba(0,0,0,0.35)');
  g.fillStyle = grad; g.fillRect(0, 0, 1024, 512);
  g.strokeStyle = '#d9b45e'; g.lineWidth = 8;
  g.strokeRect(22, 22, 980, 468);
  g.strokeStyle = 'rgba(217,180,94,0.5)'; g.lineWidth = 3;
  g.strokeRect(44, 44, 936, 424);

  g.textAlign = 'center';
  g.fillStyle = '#f3e3bd';
  g.font = 'bold 96px Georgia, serif';
  g.fillText('ФОНТАН «ТИТАН»', 512, 160);
  g.font = 'bold 132px Georgia, serif';
  g.fillStyle = '#ffd98a';
  g.fillText('56,1 м', 512, 300);
  g.font = '46px Georgia, serif';
  g.fillStyle = '#e9dcc0';
  g.fillText('= 33 человеческих роста по 1,7 м', 512, 372);
  g.font = '34px Georgia, serif';
  g.fillStyle = 'rgba(233,220,192,0.75)';
  g.fillText('основной парк · золотой час', 512, 436);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Силуэт человека 1,7 м — наглядный масштаб. */
function figureTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 724;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 256, 724);
  g.fillStyle = '#151109';
  // голова
  g.beginPath(); g.arc(128, 78, 42, 0, Math.PI * 2); g.fill();
  // торс
  g.beginPath();
  g.moveTo(96, 132); g.lineTo(160, 132); g.lineTo(176, 300); g.lineTo(150, 330);
  g.lineTo(106, 330); g.lineTo(80, 300); g.closePath(); g.fill();
  // руки
  g.lineWidth = 26; g.strokeStyle = '#151109'; g.lineCap = 'round';
  g.beginPath(); g.moveTo(92, 150); g.lineTo(58, 330); g.stroke();
  g.beginPath(); g.moveTo(164, 150); g.lineTo(198, 330); g.stroke();
  // ноги
  g.beginPath(); g.moveTo(110, 320); g.lineTo(96, 690); g.stroke();
  g.beginPath(); g.moveTo(146, 320); g.lineTo(160, 690); g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createFountain(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const stone = new THREE.MeshStandardMaterial({ color: PALETTE.stone, roughness: 0.78, metalness: 0.02 });
  const marble = new THREE.MeshStandardMaterial({ color: PALETTE.marble, roughness: 0.6, metalness: 0.03 });
  const basinMat = new THREE.MeshStandardMaterial({ color: PALETTE.basin, roughness: 0.85, side: THREE.DoubleSide });
  const gold = new THREE.MeshStandardMaterial({
    color: PALETTE.gold, roughness: 0.22, metalness: 0.95, emissive: 0x40260a, emissiveIntensity: 0.6,
  });

  // ---------------- внешний бассейн ----------------
  const basinProfile = [
    new THREE.Vector2(POOL_RADIUS - 1.2, 0.0),
    new THREE.Vector2(POOL_RADIUS - 1.2, 1.32),
    new THREE.Vector2(POOL_RADIUS - 0.95, 1.62),
    new THREE.Vector2(POOL_RADIUS + 0.3, 1.70),
    new THREE.Vector2(POOL_RADIUS + 0.85, 1.40),
    new THREE.Vector2(POOL_RADIUS + 1.0, 0.85),
    new THREE.Vector2(POOL_RADIUS + 1.0, 0.0),
    new THREE.Vector2(POOL_RADIUS - 1.2, 0.0),
  ];
  const basin = new THREE.Mesh(lathe(basinProfile, 160), basinMat);
  basin.castShadow = true; basin.receiveShadow = true;
  // The outer lip is an annular wall, not a solid cylinder.
  basin.userData.collisionMode = 'ring';
  basin.userData.collisionRadius = POOL_RADIUS - 0.1;
  basin.userData.collisionThickness = 2.2;
  group.add(basin);

  // тёмное дно бассейна с кольцевой плиткой
  const floorMat = new THREE.MeshStandardMaterial({ color: PALETTE.poolFloor, roughness: 0.5, metalness: 0.05 });
  floorMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vP = (modelMatrix * vec4(transformed,1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vP;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        float r = length(vP.xz);
        float t = abs(fract(r / 3.0) - 0.5);
        float ring = (1.0 - smoothstep(0.42, 0.5, t));
        float a = abs(fract(atan(vP.z, vP.x) * 40.0) - 0.5);
        float rad = (1.0 - smoothstep(0.44, 0.5, a));
        diffuseColor.rgb *= mix(0.55, 1.05, min(ring, rad));
      `);
  };
  // A 28-metre-deep basin replaces the old ankle-deep floor.
  const poolWallRadius = POOL_RADIUS - 1.25;
  const poolWall = new THREE.Mesh(
    new THREE.CylinderGeometry(poolWallRadius, poolWallRadius, POOL_DEPTH + WATER_Y, 160, 1, true),
    new THREE.MeshStandardMaterial({
      color: 0x102d38, roughness: 0.94, metalness: 0.04, side: THREE.DoubleSide,
    })
  );
  poolWall.position.y = (POOL_BOTTOM_Y + WATER_Y) * 0.5;
  poolWall.userData.collisionMode = 'ring';
  poolWall.userData.collisionRadius = poolWallRadius;
  poolWall.userData.collisionThickness = 0.65;
  poolWall.receiveShadow = true;
  group.add(poolWall);

  const poolFloor = new THREE.Mesh(new THREE.CircleGeometry(poolWallRadius, 160), floorMat);
  poolFloor.rotation.x = -Math.PI / 2;
  poolFloor.position.y = POOL_BOTTOM_Y;
  poolFloor.receiveShadow = true;
  poolFloor.userData.walkable = true;
  group.add(poolFloor);

  // ---------------- островок ----------------
  const tiers = [
    { r0: 16.6, r1: 16.2, h: 2.4, y: 1.2 },
    { r0: 15.4, r1: 14.8, h: 1.0, y: 2.9 },
    { r0: 14.2, r1: 13.6, h: 0.8, y: 3.8 },
  ];
  tiers.forEach((t) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(t.r1, t.r0, t.h, 72), stone);
    m.position.y = t.y;
    m.castShadow = true; m.receiveShadow = true;
    m.userData.walkable = true;
    group.add(m);
  });
  // карнизы по краям ярусов
  [[16.5, 2.45, 0.34], [15.0, 3.42, 0.26]].forEach(([r, y, t]) => {
    const torus = new THREE.Mesh(new THREE.TorusGeometry(r, t, 8, 96), marble);
    torus.rotation.x = Math.PI / 2; torus.position.y = y;
    torus.castShadow = true;
    torus.userData.collisionMode = 'ring';
    torus.userData.collisionRadius = r;
    torus.userData.collisionThickness = t * 2;
    group.add(torus);
  });

  // balustrade на площадке островка (с разрывом напротив моста)
  const postGeo = new THREE.CylinderGeometry(0.22, 0.26, 1.05, 8);
  const balPosts = new THREE.InstancedMesh(postGeo, marble, 40);
  const rail = new THREE.Mesh(new THREE.TorusGeometry(13.9, 0.17, 8, 120, Math.PI * 2 - 0.46), marble);
  rail.rotation.x = Math.PI / 2; rail.position.y = ISLAND_TOP + 1.0;
  rail.castShadow = true;
  rail.userData.collisionMode = 'ring';
  rail.userData.collisionRadius = 13.9;
  rail.userData.collisionThickness = 0.34;
  // Leave the bridge-facing opening clear, including the player's body width.
  rail.userData.collisionGapStart = rail.geometry.parameters.arc;
  rail.userData.collisionGapEnd = 0.24;
  const mat4 = new THREE.Matrix4();
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const gap = Math.min(Math.abs(a), Math.PI * 2 - Math.abs(a)) < 0.24;
    mat4.makeTranslation(Math.cos(a) * 13.9, ISLAND_TOP + (gap ? -0.4 : 0.52), Math.sin(a) * 13.9);
    balPosts.setMatrixAt(i, mat4);
  }
  balPosts.castShadow = true;
  group.add(balPosts, rail);

  // ---------------- колонна ----------------
  const colPts = [];
  const COL_TOP = 46.0;
  for (let i = 0; i <= 44; i++) {
    const t = i / 44;
    const y = ISLAND_TOP + t * (COL_TOP - ISLAND_TOP);
    let r = 3.5 - 1.75 * Math.pow(t, 0.82);
    for (const b of BOWLS) {
      const d = y - b.y;
      if (d > -1.9 && d < 0.6) r += 1.5 * Math.exp(-(d * d) / 1.1);
    }
    colPts.push(new THREE.Vector2(r, y));
  }
  const column = new THREE.Mesh(lathe(colPts, 96, 22, 0.045), stone);
  column.castShadow = true; column.receiveShadow = true;
  group.add(column);

  // декоративные кольца на колонне
  for (let i = 0; i < 9; i++) {
    const y = 6.5 + i * 4.2;
    if (BOWLS.some((b) => Math.abs(b.y - y) < 3)) continue;
    const t = (y - ISLAND_TOP) / (COL_TOP - ISLAND_TOP);
    const r = 3.5 - 1.75 * Math.pow(t, 0.82);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r + 0.12, 0.22, 8, 64), marble);
    ring.rotation.x = Math.PI / 2; ring.position.y = y;
    ring.castShadow = true;
    ring.userData.collisionMode = 'ring';
    ring.userData.collisionRadius = r + 0.12;
    ring.userData.collisionThickness = 0.44;
    group.add(ring);
  }

  // ---------------- чаши ----------------
  const bowlMeshes = [];
  BOWLS.forEach((b) => {
    const R = b.r;
    const y = b.y;
    const p = [
      new THREE.Vector2(0.0, y - 1.9),
      new THREE.Vector2(R * 0.22, y - 1.55),
      new THREE.Vector2(R * 0.55, y - 0.95),
      new THREE.Vector2(R * 0.82, y - 0.42),
      new THREE.Vector2(R * 0.96, y - 0.10),
      new THREE.Vector2(R * 1.00, y + 0.10),
      new THREE.Vector2(R * 1.02, y + 0.34),
      new THREE.Vector2(R * 0.985, y + 0.42),
      new THREE.Vector2(R * 0.90, y - 0.02),
      new THREE.Vector2(R * 0.72, y - 0.58),
      new THREE.Vector2(R * 0.40, y - 1.25),
      new THREE.Vector2(R * 0.15, y - 1.75),
      new THREE.Vector2(0.0, y - 2.1),
    ];
    const bowl = new THREE.Mesh(lathe(p, 112, 26, 0.035), marble);
    bowl.castShadow = true; bowl.receiveShadow = true;
    group.add(bowl);
    bowlMeshes.push(bowl);

    const rim = new THREE.Mesh(new THREE.TorusGeometry(R * 1.01, 0.18, 8, 120), gold);
    rim.rotation.x = Math.PI / 2; rim.position.y = y + 0.22;
    rim.castShadow = true;
    rim.userData.collisionMode = 'ring';
    rim.userData.collisionRadius = R * 1.01;
    rim.userData.collisionThickness = 0.36;
    group.add(rim);

    // золотая бахрома под чашей — видно, когда смотришь снизу вверх
    const dropCount = Math.round(R * 2.6);
    const dropGeo = new THREE.SphereGeometry(0.2, 8, 6);
    dropGeo.scale(1, 1.7, 1);
    const drops = new THREE.InstancedMesh(dropGeo, gold, dropCount);
    drops.userData.noCollider = true; // tiny decorative beads must not act as player obstacles
    drops.castShadow = false;
    const dm = new THREE.Matrix4();
    const dq = new THREE.Quaternion();
    const dp = new THREE.Vector3();
    const ds = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < dropCount; i++) {
      const a = (i / dropCount) * Math.PI * 2;
      dp.set(Math.cos(a) * R * 0.87, y - 0.85, Math.sin(a) * R * 0.87);
      dm.compose(dp, dq, ds);
      drops.setMatrixAt(i, dm);
    }
    group.add(drops);

    // кольцо-карниз под чашей
    const underRing = new THREE.Mesh(new THREE.TorusGeometry(R * 0.55, 0.14, 8, 72), marble);
    underRing.rotation.x = Math.PI / 2;
    underRing.position.y = y - 1.55;
    underRing.castShadow = true;
    underRing.userData.collisionMode = 'ring';
    underRing.userData.collisionRadius = R * 0.55;
    underRing.userData.collisionThickness = 0.28;
    group.add(underRing);
  });

  // ---------------- шпиль и сфера ----------------
  const spirePts = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const y = COL_TOP + t * (FOUNTAIN_HEIGHT - 2.2 - COL_TOP);
    let r = 1.95 * Math.pow(1 - t, 0.75) + 0.22;
    if (Math.abs(t - 0.45) < 0.04) r += 0.28;
    spirePts.push(new THREE.Vector2(r, y));
  }
  const spire = new THREE.Mesh(lathe(spirePts, 64, 12, 0.05), gold);
  spire.castShadow = true;
  group.add(spire);

  const orbR = 2.2;
  const orbY = FOUNTAIN_HEIGHT - orbR;
  const orbMat = new THREE.MeshStandardMaterial({
    color: 0xfff0cf, roughness: 0.12, metalness: 0.35,
    emissive: 0xffcf82, emissiveIntensity: 1.9,
  });
  const orb = new THREE.Mesh(new THREE.SphereGeometry(orbR, 40, 28), orbMat);
  orb.position.y = orbY;
  group.add(orb);

  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(orbR * 1.55, 28, 20),
    new THREE.MeshBasicMaterial({
      color: 0xffd79a, transparent: true, opacity: 0.16,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide,
    })
  );
  halo.position.y = orbY;
  group.add(halo);

  const orbLight = new THREE.PointLight(0xffc987, 260, 160, 2);
  orbLight.position.y = orbY;
  group.add(orbLight);

  // ---------------- амфоры на бортике бассейна ----------------
  const urnProfile = [
    new THREE.Vector2(0.0, 0.0), new THREE.Vector2(0.42, 0.0), new THREE.Vector2(0.46, 0.25),
    new THREE.Vector2(0.36, 0.45), new THREE.Vector2(0.62, 0.85), new THREE.Vector2(0.78, 1.35),
    new THREE.Vector2(0.66, 1.85), new THREE.Vector2(0.42, 2.1), new THREE.Vector2(0.56, 2.35),
    new THREE.Vector2(0.5, 2.5), new THREE.Vector2(0.0, 2.52),
  ];
  const urnGeo = lathe(urnProfile, 40);
  const urns = new THREE.InstancedMesh(urnGeo, marble, 8);
  urns.castShadow = true; urns.receiveShadow = true;
  const m4 = new THREE.Matrix4();
  const qq = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const r = POOL_RADIUS + 0.2;
    m4.compose(new THREE.Vector3(Math.cos(a) * r, 1.7, Math.sin(a) * r), qq, one);
    urns.setMatrixAt(i, m4);
  }
  group.add(urns);

  // ---------------- мост-подход через бассейн ----------------
  // Настил идёт на уровне верха нижнего яруса островка (2,4 м) и пересекает бассейн мостом.
  const deckMat = new THREE.MeshStandardMaterial({ color: PALETTE.stoneWarm, roughness: 0.85 });
  const DECK_X0 = 16.6, DECK_X1 = 53.2, DECK_TOP = 2.4;
  const deckLen = DECK_X1 - DECK_X0;
  const deck = new THREE.Mesh(new THREE.BoxGeometry(deckLen, 0.6, 6.4), deckMat);
  deck.position.set(DECK_X0 + deckLen / 2, DECK_TOP - 0.3, 0);
  deck.castShadow = true; deck.receiveShadow = true;
  deck.userData.walkable = true;
  group.add(deck);

  [-3.1, 3.1].forEach((z) => {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(deckLen, 0.95, 0.45), marble);
    wall.position.set(DECK_X0 + deckLen / 2, DECK_TOP + 0.45, z);
    wall.castShadow = true; wall.receiveShadow = true;
    group.add(wall);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(deckLen, 0.16, 0.7), marble);
    cap.position.set(DECK_X0 + deckLen / 2, DECK_TOP + 0.98, z);
    cap.castShadow = true;
    group.add(cap);
  });

  // спуск на площадь — 6 ступеней
  for (let i = 0; i < 6; i++) {
    const h = DECK_TOP * (1 - i / 6);
    const step = new THREE.Mesh(new THREE.BoxGeometry(0.4, h, 6.4), deckMat);
    step.position.set(DECK_X1 + 0.2 + i * 0.4, h / 2, 0);
    step.castShadow = true; step.receiveShadow = true;
    step.userData.walkable = true;
    group.add(step);
  }

  // ---------------- табличка и фигура масштаба ----------------
  const signMat = new THREE.MeshStandardMaterial({ map: signTexture(), roughness: 0.75, metalness: 0.1 });
  const sign = new THREE.Mesh(new THREE.BoxGeometry(7.6, 3.8, 0.25), signMat);
  sign.position.set(59.5, 3.4, 8.0);
  sign.rotation.y = -Math.PI / 2 + 0.5;
  sign.castShadow = true;
  group.add(sign);
  const signPost = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 3.4, 10), deckMat);
  signPost.position.set(59.5, 0.7, 8.0);
  signPost.castShadow = true;
  group.add(signPost);

  const figMat = new THREE.MeshBasicMaterial({
    map: figureTexture(), transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, color: 0x1b1710,
  });
  const figure = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 1.7), figMat);
  figure.position.set(58.2, 0.87, 5.4);
  figure.rotation.y = -Math.PI / 2 + 0.35;
  group.add(figure);
  const figBase = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, 0.12, 20), deckMat);
  figBase.position.set(58.2, 0.06, 5.4);
  figBase.receiveShadow = true;
  group.add(figBase);

  // ---------------- метаданные для воды ----------------
  const jets = [];
  const rippleRings = [];
  BOWLS.forEach((b) => {
    const startRadius = b.r * 0.93;
    const startY = b.y + 0.18;
    const traj = jetTrajectory(startRadius, startY, b.angle, b.reach, WATER_Y);
    for (let i = 0; i < b.jets; i++) {
      const a = (i / b.jets) * Math.PI * 2 + b.y * 0.13;
      jets.push({
        a, startRadius, startY, bowlY: b.y, bowlR: b.r,
        speed: traj.speed, tLand: traj.tLand, angle: traj.angle,
      });
    }
    rippleRings.push({ x: 0, z: 0, r: startRadius + b.reach, strength: 1.0 - BOWLS.indexOf(b) * 0.12 });
  });

  return {
    group,
    jets,
    rippleRings,
    orbY,
    orbR,
    height: FOUNTAIN_HEIGHT,
    material: { stone, marble, gold },
  };
}
