import * as THREE from 'three';

const TAU = Math.PI * 2;
const MAX_HEALTH = 5;

const SPECIES = {
  hare: { name: 'Заяц', radius: 0.34, height: 1.25, walk: 1.15, run: 5.8, flee: 8.5 },
  deer: { name: 'Олень', radius: 0.52, height: 2.05, walk: 0.9, run: 4.6, flee: 8.0 },
  boar: { name: 'Кабан', radius: 0.58, height: 1.2, walk: 0.75, run: 3.2, flee: 5.0 },
  bird: { name: 'Лесная птица', radius: 0.27, height: 0.85, walk: 1.25, run: 4.8, flee: 7.5 },
  wolf: { name: 'Волк', radius: 0.48, height: 1.65, walk: 1.0, run: 6.1, flee: 0 },
};

export function createWildlife(scene, world, camera, player, hud, options = {}) {
  const mobile = options.mobile === true;
  const population = mobile
    ? { hare: 3, deer: 2, boar: 1, bird: 3, wolf: 1 }
    : { hare: 5, deer: 3, boar: 2, bird: 5, wolf: 2 };

  const sphereGeometry = new THREE.SphereGeometry(1, mobile ? 8 : 10, mobile ? 6 : 8);
  const coneGeometry = new THREE.ConeGeometry(1, 1, 7);
  const cylinderGeometry = new THREE.CylinderGeometry(0.018, 0.026, 1, 5);
  const materials = {
    brown: new THREE.MeshStandardMaterial({ color: 0x98704c, roughness: 0.96 }),
    deer: new THREE.MeshStandardMaterial({ color: 0x98603a, roughness: 0.95 }),
    deerLight: new THREE.MeshStandardMaterial({ color: 0xd6bb91, roughness: 1 }),
    hare: new THREE.MeshStandardMaterial({ color: 0x9a8c78, roughness: 1 }),
    hareLight: new THREE.MeshStandardMaterial({ color: 0xd8c8ae, roughness: 1 }),
    pink: new THREE.MeshStandardMaterial({ color: 0xb97572, roughness: 0.92 }),
    boar: new THREE.MeshStandardMaterial({ color: 0x55463b, roughness: 1 }),
    boarLight: new THREE.MeshStandardMaterial({ color: 0x8a7562, roughness: 1 }),
    bird: new THREE.MeshStandardMaterial({ color: 0x8c5838, roughness: 0.94 }),
    birdWing: new THREE.MeshStandardMaterial({ color: 0x4e604b, roughness: 0.98 }),
    blue: new THREE.MeshStandardMaterial({ color: 0x4d7180, roughness: 0.96 }),
    wolf: new THREE.MeshStandardMaterial({ color: 0x777b79, roughness: 0.98 }),
    wolfDark: new THREE.MeshStandardMaterial({ color: 0x414747, roughness: 0.98 }),
    wolfLight: new THREE.MeshStandardMaterial({ color: 0xc5c0ad, roughness: 1 }),
    muzzle: new THREE.MeshStandardMaterial({ color: 0x332b27, roughness: 0.9 }),
    hoof: new THREE.MeshStandardMaterial({ color: 0x292521, roughness: 1 }),
    antler: new THREE.MeshStandardMaterial({ color: 0xd7c5a0, roughness: 0.9 }),
    eye: new THREE.MeshStandardMaterial({ color: 0x171512, roughness: 0.36 }),
    eyeGlint: new THREE.MeshBasicMaterial({ color: 0xf2e4c9 }),
    beak: new THREE.MeshStandardMaterial({ color: 0xd3a34e, roughness: 0.88 }),
    tusk: new THREE.MeshStandardMaterial({ color: 0xe6ddc7, roughness: 0.72 }),
  };

  const animals = [];
  let nextId = 1;
  let populationTimer = 0;
  let health = MAX_HEALTH;
  let biteCooldown = 0;
  let invulnerable = 0;

  function part(parent, material, position, scale, geometry = sphereGeometry) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(position[0], position[1], position[2]);
    mesh.scale.set(scale[0], scale[1], scale[2]);
    mesh.castShadow = !mobile;
    mesh.receiveShadow = false;
    mesh.userData.noCollider = true;
    parent.add(mesh);
    return mesh;
  }

  function addEye(head, side, y, z, size = 0.035) {
    part(head, materials.eye, [side * 0.145, y, z], [size, size * 1.12, size * 0.72]);
    part(head, materials.eyeGlint, [side * 0.153, y + size * 0.34, z + size * 0.55],
      [size * 0.26, size * 0.26, size * 0.18]);
  }

  function addLeg(root, material, x, y, z, length, width, hoof = false) {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    root.add(pivot);
    part(pivot, material, [0, -length * 0.47, 0], [width, length * 0.58, width * 0.92]);
    if (hoof) {
      part(pivot, materials.hoof, [0, -length * 0.91, 0.035],
        [width * 1.15, length * 0.12, width * 1.35]);
    }
    return pivot;
  }

  function addBone(parent, start, end, radius = 1) {
    const a = new THREE.Vector3(...start);
    const b = new THREE.Vector3(...end);
    const delta = b.clone().sub(a);
    const mesh = new THREE.Mesh(cylinderGeometry, materials.antler);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.clone().normalize());
    mesh.scale.set(radius, delta.length(), radius);
    mesh.castShadow = !mobile;
    mesh.userData.noCollider = true;
    parent.add(mesh);
    return mesh;
  }

  function buildModel(kind) {
    const root = new THREE.Group();
    root.name = 'wildlife-' + kind;
    root.userData.noCollider = true;
    const legs = [];
    const wings = [];
    let body = null;

    if (kind === 'hare') {
      body = part(root, materials.hare, [0, 0.43, -0.02], [0.25, 0.24, 0.39]);
      part(root, materials.hareLight, [0, 0.34, 0.18], [0.19, 0.16, 0.2]);
      const head = new THREE.Group();
      head.position.set(0, 0.62, 0.31);
      root.add(head);
      part(head, materials.hare, [0, 0.02, 0.02], [0.18, 0.17, 0.19]);
      part(head, materials.hareLight, [0, -0.045, 0.16], [0.105, 0.085, 0.10]);
      part(head, materials.muzzle, [0, -0.035, 0.245], [0.035, 0.03, 0.025]);
      addEye(head, -1, 0.055, 0.105, 0.025);
      addEye(head, 1, 0.055, 0.105, 0.025);
      for (const side of [-1, 1]) {
        part(head, materials.hare, [side * 0.075, 0.27, -0.015], [0.064, 0.28, 0.052]).rotation.z = side * -0.12;
        part(head, materials.pink, [side * 0.075, 0.275, 0.031], [0.027, 0.22, 0.013]).rotation.z = side * -0.12;
      }
      part(root, materials.hareLight, [0, 0.43, -0.40], [0.105, 0.105, 0.10]);
      for (const side of [-1, 1]) {
        legs.push(addLeg(root, materials.hare, side * 0.16, 0.32, 0.23, 0.34, 0.085));
        legs.push(addLeg(root, materials.hare, side * 0.17, 0.31, -0.27, 0.33, 0.095));
      }
    } else if (kind === 'deer') {
      body = part(root, materials.deer, [0, 0.91, -0.02], [0.39, 0.42, 0.72]);
      part(root, materials.deerLight, [0, 0.68, 0.18], [0.29, 0.25, 0.44]);
      const neck = part(root, materials.deer, [0, 1.22, 0.47], [0.22, 0.48, 0.25]);
      neck.rotation.x = -0.28;
      const head = new THREE.Group();
      head.position.set(0, 1.52, 0.64);
      root.add(head);
      part(head, materials.deer, [0, 0.04, 0.02], [0.18, 0.21, 0.24]);
      part(head, materials.deerLight, [0, -0.08, 0.20], [0.13, 0.12, 0.20]);
      part(head, materials.muzzle, [0, -0.08, 0.34], [0.052, 0.045, 0.05]);
      addEye(head, -1, 0.09, 0.14, 0.026);
      addEye(head, 1, 0.09, 0.14, 0.026);
      for (const side of [-1, 1]) {
        part(head, materials.deer, [side * 0.19, 0.12, -0.02], [0.16, 0.055, 0.09]).rotation.y = side * 0.20;
        addBone(head, [side * 0.08, 0.19, -0.015], [side * 0.13, 0.42, -0.025], 0.8);
        addBone(head, [side * 0.13, 0.35, -0.025], [side * 0.25, 0.44, 0.015], 0.75);
        addBone(head, [side * 0.13, 0.35, -0.025], [side * 0.12, 0.52, -0.11], 0.72);
        addBone(head, [side * 0.25, 0.44, 0.015], [side * 0.30, 0.56, 0.07], 0.65);
      }
      for (const side of [-1, 1]) {
        legs.push(addLeg(root, materials.deer, side * 0.23, 0.67, 0.45, 0.62, 0.064, true));
        legs.push(addLeg(root, materials.deer, side * 0.23, 0.67, -0.48, 0.62, 0.064, true));
      }
      part(root, materials.deerLight, [0, 0.95, -0.72], [0.10, 0.12, 0.18]);
    } else if (kind === 'boar') {
      body = part(root, materials.boar, [0, 0.62, -0.02], [0.48, 0.47, 0.78]);
      part(root, materials.boarLight, [0, 0.52, 0.29], [0.38, 0.32, 0.44]);
      const head = new THREE.Group();
      head.position.set(0, 0.75, 0.53);
      root.add(head);
      part(head, materials.boar, [0, 0.02, 0.05], [0.34, 0.31, 0.37]);
      part(head, materials.boarLight, [0, -0.11, 0.31], [0.25, 0.17, 0.24]);
      part(head, materials.muzzle, [0, -0.08, 0.49], [0.13, 0.09, 0.08]);
      for (const side of [-1, 1]) {
        part(head, materials.boar, [side * 0.27, 0.20, 0.07], [0.12, 0.21, 0.075]).rotation.z = side * -0.55;
        part(head, materials.tusk, [side * 0.20, -0.16, 0.30], [0.045, 0.11, 0.045], coneGeometry).rotation.x = -0.28;
        addEye(head, side, 0.09, 0.22, 0.025);
      }
      for (const side of [-1, 1]) {
        legs.push(addLeg(root, materials.boar, side * 0.29, 0.40, 0.43, 0.38, 0.10, true));
        legs.push(addLeg(root, materials.boar, side * 0.29, 0.40, -0.45, 0.38, 0.10, true));
      }
      part(root, materials.boar, [0, 0.70, -0.77], [0.07, 0.07, 0.20]);
    } else if (kind === 'bird') {
      body = part(root, materials.bird, [0, 0.38, -0.02], [0.25, 0.25, 0.36]);
      part(root, materials.blue, [0, 0.39, 0.17], [0.19, 0.19, 0.22]);
      const head = new THREE.Group();
      head.position.set(0, 0.57, 0.25);
      root.add(head);
      part(head, materials.bird, [0, 0.03, 0.03], [0.15, 0.15, 0.16]);
      part(head, materials.beak, [0, 0.00, 0.19], [0.065, 0.075, 0.14], coneGeometry).rotation.x = Math.PI * 0.5;
      addEye(head, -1, 0.075, 0.105, 0.022);
      addEye(head, 1, 0.075, 0.105, 0.022);
      for (const side of [-1, 1]) {
        const wing = new THREE.Group();
        wing.position.set(side * 0.16, 0.47, 0.0);
        root.add(wing);
        part(wing, materials.birdWing, [side * 0.12, 0, -0.01], [0.22, 0.075, 0.28]).rotation.z = side * 0.12;
        wings.push({ pivot: wing, side });
        legs.push(addLeg(root, materials.hoof, side * 0.10, 0.22, -0.02, 0.19, 0.035));
      }
      for (let i = -1; i <= 1; i++) {
        part(root, materials.birdWing, [i * 0.075, 0.43, -0.34], [0.065, 0.07, 0.20]).rotation.x = -0.35;
      }
    } else if (kind === 'wolf') {
      body = part(root, materials.wolf, [0, 0.78, -0.02], [0.40, 0.39, 0.72]);
      part(root, materials.wolfLight, [0, 0.62, 0.31], [0.30, 0.25, 0.40]);
      const neck = part(root, materials.wolf, [0, 1.03, 0.40], [0.25, 0.34, 0.30]);
      neck.rotation.x = -0.22;
      const head = new THREE.Group();
      head.position.set(0, 1.16, 0.62);
      root.add(head);
      part(head, materials.wolf, [0, 0.02, 0.05], [0.23, 0.23, 0.26]);
      part(head, materials.wolfLight, [0, -0.10, 0.25], [0.15, 0.13, 0.25]);
      part(head, materials.muzzle, [0, -0.06, 0.43], [0.085, 0.07, 0.08]);
      for (const side of [-1, 1]) {
        part(head, materials.wolfDark, [side * 0.14, 0.23, -0.005], [0.10, 0.20, 0.075], coneGeometry).rotation.z = side * 0.18;
        addEye(head, side, 0.08, 0.16, 0.029);
      }
      for (const side of [-1, 1]) {
        legs.push(addLeg(root, materials.wolf, side * 0.25, 0.51, 0.42, 0.49, 0.085));
        legs.push(addLeg(root, materials.wolf, side * 0.25, 0.51, -0.44, 0.49, 0.085));
      }
      const tail = part(root, materials.wolfDark, [0, 0.90, -0.70], [0.13, 0.14, 0.34]);
      tail.rotation.x = -0.48;
    }

    return { root, body, legs, wings, phase: Math.random() * TAU };
  }

  function isValidGround(x, z, referenceY = null) {
    if (Math.hypot(x, z) < 220) return false;
    const y = world.heightAt(x, z);
    if (!Number.isFinite(y)) return false;
    if (world.getWaterRegionAt?.(x, z)) return false;
    if (referenceY !== null && Math.abs(y - referenceY) > 2.2) return false;
    const blocked = world.isForestBlocked?.(x, z, y, 1.5, 0.35);
    if (blocked?.blocked) return false;
    return true;
  }

  function findSpawnPosition() {
    const origin = camera.position;
    for (let attempt = 0; attempt < 48; attempt++) {
      const angle = Math.random() * TAU;
      const distance = 32 + Math.random() * 118;
      const x = origin.x + Math.cos(angle) * distance;
      const z = origin.z + Math.sin(angle) * distance;
      if (!isValidGround(x, z)) continue;
      let crowded = false;
      for (const animal of animals) {
        if (!animal.dead && Math.hypot(animal.x - x, animal.z - z) < 5.5) {
          crowded = true;
          break;
        }
      }
      if (crowded) continue;
      return { x, y: world.heightAt(x, z), z };
    }
    return null;
  }

  function spawnAnimal(kind) {
    const position = findSpawnPosition();
    if (!position) return false;
    const model = buildModel(kind);
    model.root.position.set(position.x, position.y, position.z);
    scene.add(model.root);
    animals.push({
      id: nextId++,
      kind,
      name: SPECIES[kind].name,
      root: model.root,
      legs: model.legs,
      wings: model.wings,
      body: model.body,
      phase: model.phase,
      x: position.x,
      y: position.y,
      z: position.z,
      heading: Math.random() * TAU,
      state: 'idle',
      targetX: position.x,
      targetZ: position.z,
      wanderTimer: 1 + Math.random() * 4,
      fleeTimer: 0,
      eatTimer: 0,
      energy: kind === 'wolf' ? 42 + Math.random() * 20 : 100,
      vitality: 100,
      dead: false,
      attackTimer: 0,
    });
    return true;
  }

  function countSpecies(kind) {
    let count = 0;
    for (const animal of animals) if (!animal.dead && animal.kind === kind) count++;
    return count;
  }

  for (const kind of Object.keys(population)) {
    for (let i = 0; i < population[kind]; i++) spawnAnimal(kind);
  }

  function removeAnimal(animal) {
    if (!animal || animal.dead) return;
    animal.dead = true;
    scene.remove(animal.root);
    const index = animals.indexOf(animal);
    if (index >= 0) animals.splice(index, 1);
  }

  function moveToward(animal, targetX, targetZ, speed, dt) {
    const dx = targetX - animal.x;
    const dz = targetZ - animal.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.55) return true;
    const step = Math.min(distance, speed * dt);
    const nx = animal.x + (dx / distance) * step;
    const nz = animal.z + (dz / distance) * step;
    const nextY = world.heightAt(nx, nz);
    if (!Number.isFinite(nextY) || world.getWaterRegionAt?.(nx, nz) ||
      Math.abs(nextY - animal.y) > 1.7) return false;
    const blocked = world.isForestBlocked?.(
      nx, nz, nextY, SPECIES[animal.kind].height, SPECIES[animal.kind].radius * 0.65
    );
    if (blocked?.blocked) return false;

    animal.x = nx;
    animal.y = nextY;
    animal.z = nz;
    animal.root.position.set(nx, nextY, nz);
    const desired = Math.atan2(dx, dz);
    let angleDelta = Math.atan2(
      Math.sin(desired - animal.heading),
      Math.cos(desired - animal.heading)
    );
    animal.heading += angleDelta * Math.min(1, dt * 7.5);
    animal.root.rotation.y = animal.heading;
    return distance <= step + 0.55;
  }

  function closestPrey(wolf, maxDistance = 260) {
    let best = null;
    let bestDistance = maxDistance;
    for (const animal of animals) {
      if (animal.dead || (animal.kind !== 'hare' && animal.kind !== 'bird')) continue;
      const distance = Math.hypot(animal.x - wolf.x, animal.z - wolf.z);
      if (distance < bestDistance) {
        best = animal;
        bestDistance = distance;
      }
    }
    return best;
  }

  function animateModel(animal, dt, moving, speed) {
    animal.phase += dt * (moving ? 5.5 + speed * 0.9 : 1.1);
    const stride = moving ? Math.min(0.72, speed * 0.12) : 0.035;
    for (let i = 0; i < animal.legs.length; i++) {
      animal.legs[i].rotation.x = Math.sin(animal.phase + (i % 2) * Math.PI) * stride;
    }
    for (const wing of animal.wings) {
      const flap = animal.state === 'flee' ? Math.sin(animal.phase * 2.3) * 0.8 : Math.sin(animal.phase) * 0.08;
      wing.pivot.rotation.z = wing.side * (0.08 + flap);
    }
    if (animal.body) {
      animal.body.position.y += ((animal.kind === 'bird' ? 0.38 : animal.kind === 'hare' ? 0.43 : animal.kind === 'deer' ? 0.91 : animal.kind === 'boar' ? 0.62 : 0.78)
        + (moving ? Math.abs(Math.sin(animal.phase * 2)) * 0.025 : Math.sin(animal.phase) * 0.008)
        - animal.body.position.y) * Math.min(1, dt * 9);
    }
  }

  function updatePrey(animal, dt, playerX, playerZ) {
    const info = SPECIES[animal.kind];
    let threat = null;
    let threatDistance = Infinity;
    for (const candidate of animals) {
      if (candidate.dead || candidate.kind !== 'wolf') continue;
      const distance = Math.hypot(candidate.x - animal.x, candidate.z - animal.z);
      if (distance < threatDistance) {
        threat = candidate;
        threatDistance = distance;
      }
    }

    const playerDistance = Math.hypot(playerX - animal.x, playerZ - animal.z);
    let fleeing = false;
    let fleeX = 0, fleeZ = 0;
    if (threat && threatDistance < (animal.kind === 'bird' ? 32 : 25)) {
      fleeing = true;
      fleeX = animal.x - threat.x;
      fleeZ = animal.z - threat.z;
    } else if (player.mode !== 'fly' && playerDistance < info.flee) {
      fleeing = true;
      fleeX = animal.x - playerX;
      fleeZ = animal.z - playerZ;
    }

    if (fleeing) {
      const length = Math.hypot(fleeX, fleeZ) || 1;
      animal.targetX = animal.x + (fleeX / length) * 22;
      animal.targetZ = animal.z + (fleeZ / length) * 22;
      animal.state = 'flee';
      animal.fleeTimer = 2.2;
    } else if (animal.fleeTimer > 0) {
      animal.fleeTimer = Math.max(0, animal.fleeTimer - dt);
    } else {
      animal.wanderTimer -= dt;
      if (animal.wanderTimer <= 0 || animal.state === 'flee') {
        const angle = Math.random() * TAU;
        const distance = 4 + Math.random() * 11;
        animal.targetX = animal.x + Math.cos(angle) * distance;
        animal.targetZ = animal.z + Math.sin(angle) * distance;
        animal.wanderTimer = 3 + Math.random() * 6;
        animal.state = 'wander';
      }
    }

    const speed = animal.state === 'flee' ? info.run : info.walk;
    const arrived = moveToward(animal, animal.targetX, animal.targetZ, speed, dt);
    if (arrived && animal.state !== 'flee') animal.state = 'idle';
    if (!arrived && animal.state === 'flee' && animal.fleeTimer <= 0) animal.state = 'wander';
    animateModel(animal, dt, !arrived, speed);
  }

  function damagePlayer() {
    if (biteCooldown > 0 || invulnerable > 0) return;
    biteCooldown = 1.45;
    invulnerable = 0.8;
    health = Math.max(0, health - 1);
    hud.setHealth?.(health, MAX_HEALTH, true);
    if (health <= 0) {
      player.setMode('walk');
      player.respawn?.();
      health = MAX_HEALTH;
      invulnerable = 3.5;
      hud.setHealth?.(health, MAX_HEALTH, false);
      hud.toast('Волк загнал вас. Вы очнулись возле дома.');
    } else {
      hud.toast('Волк укусил вас. Уходите от него!');
    }
  }

  function updateWolf(wolf, dt, playerX, playerZ) {
    wolf.energy = Math.max(0, wolf.energy - dt * 0.24);
    wolf.attackTimer = Math.max(0, wolf.attackTimer - dt);
    const playerDistance = Math.hypot(playerX - wolf.x, playerZ - wolf.z);
    const closeToPlayer = player.mode !== 'fly' && !player.swimming &&
      playerDistance < 1.65 && Math.abs((player.feetY ?? wolf.y) - wolf.y) < 2.1;

    if (closeToPlayer && wolf.attackTimer <= 0) {
      wolf.attackTimer = 1.65;
      damagePlayer();
    }

    if (wolf.energy <= 0) {
      wolf.vitality = Math.max(0, wolf.vitality - dt * 7.5);
      if (wolf.vitality <= 0) {
        removeAnimal(wolf);
        return;
      }
    }

    if (wolf.eatTimer > 0) {
      wolf.eatTimer = Math.max(0, wolf.eatTimer - dt);
      wolf.state = 'eat';
      animateModel(wolf, dt, false, 0);
      return;
    }

    let prey = wolf.energy < 86 ? closestPrey(wolf) : null;
    if (prey) {
      wolf.state = 'hunt';
      wolf.targetX = prey.x;
      wolf.targetZ = prey.z;
      const distance = Math.hypot(prey.x - wolf.x, prey.z - wolf.z);
      if (distance < 1.35) {
        const preyName = prey.name.toLowerCase();
        removeAnimal(prey);
        wolf.energy = Math.min(100, wolf.energy + 66);
        wolf.vitality = Math.min(100, wolf.vitality + 16);
        wolf.eatTimer = 1.8;
        hud.toast('Волк поймал: ' + preyName + '.');
        animateModel(wolf, dt, false, 0);
        return;
      }
      const arrived = moveToward(wolf, prey.x, prey.z, SPECIES.wolf.run, dt);
      animateModel(wolf, dt, !arrived, SPECIES.wolf.run);
      return;
    }

    wolf.wanderTimer -= dt;
    if (wolf.wanderTimer <= 0 || wolf.state === 'hunt') {
      const angle = Math.random() * TAU;
      const distance = 8 + Math.random() * 20;
      wolf.targetX = wolf.x + Math.cos(angle) * distance;
      wolf.targetZ = wolf.z + Math.sin(angle) * distance;
      wolf.wanderTimer = 3 + Math.random() * 5;
      wolf.state = 'wander';
    }
    const arrived = moveToward(wolf, wolf.targetX, wolf.targetZ, SPECIES.wolf.walk, dt);
    if (arrived) wolf.state = 'idle';
    animateModel(wolf, dt, !arrived, SPECIES.wolf.walk);
  }

  function update(dt) {
    biteCooldown = Math.max(0, biteCooldown - dt);
    invulnerable = Math.max(0, invulnerable - dt);
    const playerX = camera.position.x;
    const playerZ = camera.position.z;

    for (const animal of [...animals]) {
      if (animal.dead) continue;
      const distance = Math.hypot(animal.x - playerX, animal.z - playerZ);
      if (distance > 360) {
        removeAnimal(animal);
        continue;
      }
      if (animal.kind === 'wolf') updateWolf(animal, dt, playerX, playerZ);
      else updatePrey(animal, dt, playerX, playerZ);
    }

    populationTimer -= dt;
    if (populationTimer <= 0) {
      populationTimer = 8;
      for (const kind of Object.keys(population)) {
        if (countSpecies(kind) < population[kind]) {
          spawnAnimal(kind);
          break;
        }
      }
    }
  }

  function getSaveState() {
    return { health };
  }

  function restoreState(state) {
    const value = Number(state?.health);
    health = Number.isFinite(value) ? THREE.MathUtils.clamp(Math.round(value), 0, MAX_HEALTH) : MAX_HEALTH;
    if (health <= 0) health = MAX_HEALTH;
    hud.setHealth?.(health, MAX_HEALTH, false);
  }

  hud.setHealth?.(health, MAX_HEALTH, false);

  return {
    update,
    get count() { return animals.length; },
    get health() { return health; },
    getSaveState,
    restoreState,
  };
}
