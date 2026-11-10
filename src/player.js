import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import {
  EYE_HEIGHT, PLAYER_HEIGHT, GRAVITY,
} from './config.js';

const WALK_SPEED = 5.4;
const RUN_SPEED = 10.2;
const FLY_SPEED = 14.0;
const FLY_FAST = 34.0;
const BODY_RADIUS = 0.34;
const STEP_UP = 1.4;
const MAX_STEP_DOWN = 3.0;
const JUMP_SPEED = 6.4;
const AIR_CONTROL = 5.0;
const GROUND_ACCELERATION = 19.0;

const SWIM_SPEED = 3.4;
const SWIM_SPRINT_SPEED = 5.1;
const SWIM_ACCELERATION = 4.2;
const WATER_DRAG = 1.65;
const MAX_OXYGEN = 24;
const EYE_WATER_OFFSET = 0.65;

function createPlayerAvatar(scene) {
  const root = new THREE.Group();
  root.name = 'player-visible-body';
  root.userData.noCollider = true;

  const motion = new THREE.Group();
  motion.name = 'player-body-animation';
  root.add(motion);

  const skin = new THREE.MeshStandardMaterial({
    color: 0xb98261, roughness: 0.88, flatShading: true,
  });
  const skinLight = new THREE.MeshStandardMaterial({
    color: 0xd29a75, roughness: 0.9, flatShading: true,
  });
  const skinShadow = new THREE.MeshStandardMaterial({
    color: 0x8d5d48, roughness: 0.94, flatShading: true,
  });
  const shorts = new THREE.MeshStandardMaterial({
    color: 0x344d43, roughness: 0.96, flatShading: true,
  });
  const shortsTrim = new THREE.MeshStandardMaterial({
    color: 0xc09b5c, roughness: 0.88, flatShading: true,
  });
  const boots = new THREE.MeshStandardMaterial({
    color: 0x403128, roughness: 1, flatShading: true,
  });

  function ellipsoid(parent, material, position, scale, segments = 12) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, segments, Math.max(8, segments - 2)),
      material
    );
    mesh.position.set(position[0], position[1], position[2]);
    mesh.scale.set(scale[0], scale[1], scale[2]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.noCollider = true;
    parent.add(mesh);
    return mesh;
  }

  function box(parent, material, size, position) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(size[0], size[1], size[2]),
      material
    );
    mesh.position.set(position[0], position[1], position[2]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.noCollider = true;
    parent.add(mesh);
    return mesh;
  }

  // Muscular torso: wide chest, separate pectorals, rounded shoulders and
  // visible abdominal groups. Character faces local -Z.
  ellipsoid(motion, skinShadow, [0, 0.86, -0.015], [0.29, 0.22, 0.185]);
  ellipsoid(motion, skin, [0, 1.105, -0.02], [0.335, 0.33, 0.205], 14);
  ellipsoid(motion, skinLight, [-0.155, 1.20, 0.125], [0.205, 0.145, 0.105]);
  ellipsoid(motion, skinLight, [0.155, 1.20, 0.125], [0.205, 0.145, 0.105]);

  // Pectoral lower edge and clavicle highlights make the chest readable
  // from the first-person downward camera angle.
  ellipsoid(motion, skinShadow, [-0.145, 1.075, 0.142], [0.17, 0.032, 0.035]);
  ellipsoid(motion, skinShadow, [0.145, 1.075, 0.142], [0.17, 0.032, 0.035]);
  ellipsoid(motion, skinLight, [0, 1.31, 0.095], [0.23, 0.045, 0.075]);

  // Three pairs of abdominal muscles, plus obliques.
  for (const y of [0.99, 0.89, 0.79]) {
    for (const side of [-1, 1]) {
      ellipsoid(motion, skinLight, [side * 0.082, y, 0.157], [0.073, 0.042, 0.045], 10);
    }
  }
  ellipsoid(motion, skin, [-0.245, 0.99, 0.005], [0.075, 0.22, 0.12]);
  ellipsoid(motion, skin, [0.245, 0.99, 0.005], [0.075, 0.22, 0.12]);

  // Neck and a low-profile head. The head is on layer 1 so it does not
  // intersect the first-person camera.
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.105, 0.19, 10), skin);
  neck.position.set(0, 1.39, 0.02);
  neck.castShadow = true;
  neck.userData.noCollider = true;
  motion.add(neck);
  const head = ellipsoid(motion, skin, [0, 1.57, 0.105], [0.145, 0.17, 0.15], 12);
  head.layers.set(1);

  // Shorts and belt.
  ellipsoid(motion, shorts, [0, 0.68, 0], [0.255, 0.17, 0.19]);
  box(motion, shortsTrim, [0.50, 0.045, 0.385], [0, 0.77, -0.005]);
  box(motion, shortsTrim, [0.075, 0.09, 0.035], [0, 0.765, -0.205]);

  function makeArm(side, sizeMultiplier) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.30, 1.285, 0.005);
    motion.add(shoulder);

    // Muscle volume is multiplied on every part of the right arm.
    ellipsoid(shoulder, skin, [side * 0.015, -0.035, 0], [
      0.145 * sizeMultiplier, 0.155, 0.145 * sizeMultiplier,
    ]);
    ellipsoid(shoulder, skinLight, [side * 0.02, -0.105, 0.015], [
      0.125 * sizeMultiplier, 0.20, 0.12 * sizeMultiplier,
    ]);

    const upper = ellipsoid(shoulder, skin, [side * 0.018, -0.255, -0.005], [
      0.112 * sizeMultiplier, 0.245, 0.12 * sizeMultiplier,
    ]);
    ellipsoid(shoulder, skinLight, [side * 0.02, -0.255, 0.075], [
      0.105 * sizeMultiplier, 0.155, 0.065 * sizeMultiplier,
    ]);

    const elbow = new THREE.Group();
    elbow.position.set(0, -0.455, 0);
    shoulder.add(elbow);
    ellipsoid(elbow, skin, [0, -0.17, 0], [
      0.087 * sizeMultiplier, 0.205, 0.09 * sizeMultiplier,
    ]);
    ellipsoid(elbow, skinLight, [0, -0.16, 0.055], [
      0.078 * sizeMultiplier, 0.14, 0.055 * sizeMultiplier,
    ]);
    ellipsoid(elbow, skin, [0, -0.365, -0.005], [
      0.085 * sizeMultiplier, 0.095, 0.09 * sizeMultiplier,
    ]);
    return { shoulder, elbow, upper };
  }

  // The right arm is deliberately 1.5x the left arm's muscle volume.
  const leftArm = makeArm(-1, 1.0);
  const rightArm = makeArm(1, 1.5);

  function makeLeg(side) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.135, 0.67, 0);
    motion.add(hip);
    ellipsoid(hip, shorts, [0, -0.08, 0], [0.145, 0.18, 0.16]);
    ellipsoid(hip, skin, [0, -0.255, 0.005], [0.125, 0.245, 0.125]);
    ellipsoid(hip, skinLight, [0, -0.255, 0.075], [0.105, 0.16, 0.065]);

    const knee = new THREE.Group();
    knee.position.y = -0.47;
    hip.add(knee);
    ellipsoid(knee, skin, [0, -0.16, 0], [0.095, 0.205, 0.10]);
    box(knee, boots, [0.205, 0.12, 0.31], [0, -0.39, -0.055]);
    return hip;
  }

  const leftLeg = makeLeg(-1);
  const rightLeg = makeLeg(1);

  const hitbox = new THREE.Group();
  hitbox.name = 'player-capsule-hitbox';
  hitbox.userData.noCollider = true;
  const wire = new THREE.MeshBasicMaterial({
    color: 0x36e6c0,
    wireframe: true,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
  });
  const cylinder = new THREE.Mesh(
    new THREE.CylinderGeometry(BODY_RADIUS, BODY_RADIUS, PLAYER_HEIGHT, 16, 1, false),
    wire
  );
  cylinder.position.y = PLAYER_HEIGHT * 0.5;
  cylinder.userData.noCollider = true;
  hitbox.add(cylinder);

  let phase = 0;
  function animate(dt, speed, sprinting, swimming, flying) {
    const moveAmount = THREE.MathUtils.clamp(speed / (sprinting ? 10.2 : 5.4), 0, 1);
    if (swimming) {
      phase += dt * (sprinting ? 7.2 : 5.2);
      const wave = Math.sin(phase);
      leftArm.shoulder.rotation.x = -0.55 + wave * 0.62;
      rightArm.shoulder.rotation.x = -0.55 - wave * 0.62;
      leftArm.shoulder.rotation.z = -0.16;
      rightArm.shoulder.rotation.z = 0.16;
      leftArm.elbow.rotation.x = -0.4 + Math.max(0, wave) * 0.5;
      rightArm.elbow.rotation.x = -0.4 + Math.max(0, -wave) * 0.5;
      leftLeg.rotation.x = -wave * 0.42;
      rightLeg.rotation.x = wave * 0.42;
      motion.position.y = Math.sin(phase * 2) * 0.018;
      motion.rotation.z = Math.sin(phase) * 0.018;
      return;
    }

    if (flying) {
      leftArm.shoulder.rotation.x = -0.78;
      rightArm.shoulder.rotation.x = -0.78;
      leftArm.shoulder.rotation.z = -0.14;
      rightArm.shoulder.rotation.z = 0.14;
      leftArm.elbow.rotation.x = -0.28;
      rightArm.elbow.rotation.x = -0.28;
      leftLeg.rotation.x = 0.12;
      rightLeg.rotation.x = 0.12;
      motion.position.y = 0;
      motion.rotation.z = 0;
      return;
    }

    if (moveAmount > 0.02) phase += dt * (sprinting ? 10.5 : 7.3);
    const swing = Math.sin(phase) * moveAmount * (sprinting ? 0.92 : 0.58);
    leftArm.shoulder.rotation.x = swing * 0.86;
    rightArm.shoulder.rotation.x = -swing * 0.86;
    leftArm.shoulder.rotation.z = -0.08;
    rightArm.shoulder.rotation.z = 0.08;
    leftArm.elbow.rotation.x = -0.10 - Math.max(0, -swing) * 0.22;
    rightArm.elbow.rotation.x = -0.10 - Math.max(0, swing) * 0.22;
    leftLeg.rotation.x = -swing;
    rightLeg.rotation.x = swing;
    motion.position.y = moveAmount > 0.02 ? Math.abs(Math.sin(phase * 2)) * (sprinting ? 0.035 : 0.018) : 0;
    motion.rotation.z = Math.sin(phase) * moveAmount * 0.012;
  }

  root.visible = true;
  hitbox.visible = false;
  scene.add(root, hitbox);
  return { root, hitbox, animate };
}

export function createPlayer(camera, domElement, physics, worldInfo, onModeChange, scene) {
  const controls = new PointerLockControls(camera, domElement);
  const spawn = worldInfo?.spawn || {
    x: 0, y: 0, z: 70, lookAt: { x: 0, y: 25, z: 0 },
  };
  const spawnFloor = physics.groundAt(spawn.x, spawn.z, spawn.y, 0.5, 1.0) ?? spawn.y;
  let feetY = spawnFloor;

  camera.position.set(spawn.x, feetY + EYE_HEIGHT, spawn.z);
  camera.lookAt(
    spawn.lookAt?.x ?? 0,
    spawn.lookAt?.y ?? 25,
    spawn.lookAt?.z ?? 0
  );
  controls.getObject().position.copy(camera.position);

  const keys = Object.create(null);
  const stick = { x: 0, y: 0 };
  let vertical = 0;
  let runToggle = false;
  let mode = 'walk';
  let grounded = true;
  let swimming = false;
  let underwater = false;
  let activeWater = null;
  let oxygen = MAX_OXYGEN;
  let jumpQueued = 0;
  let bobPhase = 0;
  let dragging = false;
  let pointerLocked = false;
  let drownedEvent = false;

  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const velocity = new THREE.Vector3();
  const avatar = createPlayerAvatar(scene);
  const avatarEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  let hitboxVisible = false;

  function syncAvatar(dt = 0) {
    avatar.root.position.set(camera.position.x, feetY, camera.position.z);
    avatarEuler.setFromQuaternion(camera.quaternion, 'YXZ');
    avatar.root.rotation.y = avatarEuler.y;
    avatar.root.visible = mode !== 'cinematic';
    avatar.hitbox.position.copy(avatar.root.position);
    avatar.hitbox.rotation.y = avatar.root.rotation.y;
    avatar.hitbox.visible = hitboxVisible && avatar.root.visible;
    avatar.animate(
      dt,
      Math.hypot(velocity.x, velocity.z),
      !!(keys.ShiftLeft || keys.ShiftRight || runToggle),
      swimming,
      mode === 'fly'
    );
  }

  syncAvatar();

  domElement.addEventListener('mousedown', (event) => {
    if (!pointerLocked && event.button === 0) dragging = true;
  });
  window.addEventListener('mouseup', () => { dragging = false; });
  window.addEventListener('mousemove', (event) => {
    if (pointerLocked || !dragging) return;
    applyLook(event.movementX || 0, event.movementY || 0);
  });

  function applyLook(dx, dy) {
    euler.setFromQuaternion(camera.quaternion, 'YXZ');
    euler.y -= dx * 0.0022;
    euler.x -= dy * 0.0022;
    euler.x = THREE.MathUtils.clamp(euler.x, -1.48, 1.48);
    camera.quaternion.setFromEuler(euler);
  }

  controls.addEventListener('lock', () => {
    pointerLocked = true;
    dragging = false;
  });
  controls.addEventListener('unlock', () => {
    pointerLocked = false;
  });

  function waterAt(x, z) {
    const region = worldInfo?.getWaterRegionAt?.(x, z) || null;
    if (!region) return null;
    // Rivers may slowly rise/fall and widen along their course. Keep the
    // swimmer's local waterline and bottom in sync with the current position.
    return {
      ...region,
      surfaceY: region.surfaceAt ? region.surfaceAt(x, z) : region.surfaceY,
      bottomY: region.bottomAt ? region.bottomAt(x, z) : region.bottomY,
    };
  }

  function clearWaterState() {
    swimming = false;
    underwater = false;
    activeWater = null;
  }

  function setMode(next) {
    if (mode === next) return;
    const previous = mode;
    mode = next;

    if (next === 'fly' || next === 'cinematic') {
      velocity.set(0, 0, 0);
      grounded = false;
      clearWaterState();
    } else if (previous === 'fly' || previous === 'cinematic') {
      feetY = camera.position.y - EYE_HEIGHT;
      velocity.set(0, 0, 0);
      grounded = false;
      clearWaterState();
    }

    onModeChange?.(mode);
    syncAvatar();
  }

  function onKeyDown(event) {
    const key = event.code;
    if (key === 'KeyH' && !event.repeat) {
      hitboxVisible = !hitboxVisible;
      syncAvatar();
      return;
    }

    if (key === 'Space' && mode !== 'fly') {
      event.preventDefault();
      if (!swimming && !event.repeat) jumpQueued = 0.16;
    }

    // C is a water-only dive control. In flight, Ctrl remains the descend key.
    if (key === 'KeyC' && (!swimming || mode === 'fly')) return;
    keys[key] = true;
    if (key === 'KeyF') setMode(mode === 'fly' ? 'walk' : 'fly');
    if (key === 'KeyT') setMode(mode === 'cinematic' ? 'walk' : 'cinematic');

    if (mode === 'cinematic' &&
      ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) {
      setMode('walk');
    }
  }

  function onKeyUp(event) {
    keys[event.code] = false;
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', () => {
    for (const key in keys) keys[key] = false;
    stick.x = 0;
    stick.y = 0;
    vertical = 0;
    dragging = false;
  });

  const cinematic = { angle: 0.7, t: 0 };

  function updateCinematic(dt) {
    cinematic.t += dt;
    cinematic.angle += dt * 0.055;
    const radius = 96 + 46 * Math.sin(cinematic.t * 0.085);
    const height = 7 + 40 * (0.5 + 0.5 * Math.sin(cinematic.t * 0.13 + 0.7));
    const lookHeight = 16 + 30 * (0.5 + 0.5 * Math.sin(cinematic.t * 0.101 + 2.1));
    camera.position.set(
      Math.cos(cinematic.angle) * radius,
      height,
      Math.sin(cinematic.angle) * radius
    );
    camera.lookAt(0, lookHeight, 0);
  }

  function resetToSpawn(drowned = false) {
    if (drowned) drownedEvent = true;
    clearWaterState();
    grounded = true;
    oxygen = MAX_OXYGEN;
    feetY = spawnFloor;
    velocity.set(0, 0, 0);
    jumpQueued = 0;
    camera.position.set(spawn.x, spawnFloor + EYE_HEIGHT, spawn.z);
    camera.lookAt(
      spawn.lookAt?.x ?? 0,
      spawn.lookAt?.y ?? 25,
      spawn.lookAt?.z ?? 0
    );
    syncAvatar();
  }

  function respawnAfterDrowning() {
    resetToSpawn(true);
  }

  function tryGroundMove(dx, dz) {
    if (Math.abs(dx) + Math.abs(dz) < 1e-7) return false;

    // If an earlier frame left the capsule slightly inside an obstacle,
    // move it back to the nearest free position before attempting movement.
    const resolved = physics.resolvePosition?.(
      camera.position.x, camera.position.z, feetY, BODY_RADIUS, PLAYER_HEIGHT
    );
    if (resolved?.changed) {
      camera.position.x = resolved.x;
      camera.position.z = resolved.z;
      const recoveredFloor = physics.groundAt(
        camera.position.x, camera.position.z, feetY, STEP_UP, MAX_STEP_DOWN
      );
      if (grounded && recoveredFloor !== null) feetY = recoveredFloor;
    }

    const nx = camera.position.x + dx;
    const nz = camera.position.z + dz;
    let nextFeet = feetY;

    if (grounded) {
      const floor = physics.groundAt(nx, nz, feetY, STEP_UP, MAX_STEP_DOWN);
      const terrainFloor = physics.terrainAt?.(nx, nz);
      if (floor === null && !Number.isFinite(terrainFloor)) return false;
      nextFeet = floor !== null ? floor : terrainFloor;
      // Refuse near-vertical walls, but do not let a small interpolation or
      // substep difference turn a climbable hillside into a missing floor.
      const horizontalStep = Math.hypot(dx, dz);
      const allowedRise = Math.max(STEP_UP, horizontalStep * 2.2 + 0.24);
      const allowedDrop = Math.max(MAX_STEP_DOWN, horizontalStep * 4.0 + 0.35);
      const heightDelta = nextFeet - feetY;
      if (heightDelta > allowedRise || heightDelta < -allowedDrop) return false;
    }

    if (physics.isBlocked(nx, nextFeet, nz, BODY_RADIUS, PLAYER_HEIGHT)) return false;
    camera.position.x = nx;
    camera.position.z = nz;
    if (grounded) feetY = nextFeet;
    return true;
  }

  function trySwimMove(dx, dz) {
    if (Math.abs(dx) + Math.abs(dz) < 1e-7) return false;

    const nx = camera.position.x + dx;
    const nz = camera.position.z + dz;
    const nextRegion = waterAt(nx, nz);

    const connectedRivers = !!(
      nextRegion && activeWater &&
      nextRegion.id !== 'fountain' && activeWater.id !== 'fountain'
    );
    const leavingWater = nextRegion?.id !== activeWater?.id && !connectedRivers;
    let exitFloor = null;

    if (leavingWater) {
      // A swimmer may leave once their head is above the surface and the
      // sampled shoreline is within one normal step. Requiring feet above
      // the waterline trapped players beneath sloped banks.
      const surface = activeWater?.surfaceY ?? 0;
      const headClearedSurface = feetY + EYE_HEIGHT >= surface - 0.12;
      exitFloor = physics.terrainAt?.(nx, nz);
      if (!Number.isFinite(exitFloor)) {
        exitFloor = physics.groundAt(nx, nz, feetY, 1.45, 2.2);
      }
      const reachableShore = Number.isFinite(exitFloor) &&
        exitFloor >= feetY - 0.65 &&
        exitFloor <= feetY + 1.45;
      if (!headClearedSurface || !reachableShore) return false;
    }

    const collisionFeet = leavingWater ? Math.max(feetY, exitFloor) : feetY;
    if (physics.isBlocked(nx, collisionFeet, nz, BODY_RADIUS, PLAYER_HEIGHT)) return false;

    camera.position.x = nx;
    camera.position.z = nz;
    if (leavingWater) {
      feetY = exitFloor;
      camera.position.y = feetY + EYE_HEIGHT;
      velocity.y = 0;
      grounded = true;
      clearWaterState();
      return true;
    }
    if (swimming && nextRegion) activeWater = nextRegion;
    return true;
  }

  function beginSwimming(region) {
    swimming = true;
    grounded = false;
    activeWater = region;
    jumpQueued = 0;
    velocity.x *= 0.5;
    velocity.z *= 0.5;
    // Keep the entry velocity. A player jumping or falling into water
    // should enter smoothly rather than snap to the surface.
    velocity.y *= 0.42;
  }

  function updateSwimming(dt, mx, mz, sprinting) {
    if (!activeWater) {
      activeWater = waterAt(camera.position.x, camera.position.z);
      if (!activeWater) {
        clearWaterState();
        return;
      }
    }

    const localWater = waterAt(camera.position.x, camera.position.z);
    if (localWater && localWater.id === activeWater.id) activeWater = localWater;

    // Full camera-relative 3D movement: looking down and pressing W dives;
    // looking upward and pressing W carries the swimmer toward the surface.
    camera.getWorldDirection(forward).normalize();
    right.set(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
    direction.set(0, 0, 0);
    if (mx || mz) {
      direction.addScaledVector(right, mx);
      direction.addScaledVector(forward, mz);
      if (direction.lengthSq() > 1) direction.normalize();
    }

    const speed = sprinting ? SWIM_SPRINT_SPEED : SWIM_SPEED;
    const targetX = direction.x * speed;
    const targetZ = direction.z * speed;
    const response = Math.min(1, SWIM_ACCELERATION * dt);

    velocity.x += (targetX - velocity.x) * response;
    velocity.z += (targetZ - velocity.z) * response;
    if (!mx && !mz) {
      const damping = Math.exp(-WATER_DRAG * dt);
      velocity.x *= damping;
      velocity.z *= damping;
    }

    // Water resistance removes vertical momentum gradually instead of
    // resetting it every frame.
    const surfaceY = activeWater.surfaceY;
    const targetFeet = surfaceY - EYE_HEIGHT + EYE_WATER_OFFSET;
    const verticalInput = THREE.MathUtils.clamp(
      (keys.Space ? 1 : 0) -
      (keys.KeyC ? 1 : 0) + vertical,
      -1, 1
    );

    if (Math.abs(verticalInput) > 0.01) {
      const pitchDrive = direction.y * speed * 2.1;
      const buoyancyAssist = THREE.MathUtils.clamp((targetFeet - feetY) * 0.42, -2.0, 2.0);
      const verticalAcceleration = verticalInput * 8.5 + pitchDrive + buoyancyAssist - velocity.y * 2.1;
      velocity.y = THREE.MathUtils.clamp(
        velocity.y + verticalAcceleration * dt, -4.2, 4.2
      );
    } else {
      const pitchDrive = direction.y * speed * 1.4;
      const buoyancyAcceleration =
        THREE.MathUtils.clamp((targetFeet - feetY) * 7.2, -12, 12) -
        velocity.y * 4.0 + pitchDrive;
      velocity.y = THREE.MathUtils.clamp(
        velocity.y + buoyancyAcceleration * dt, -4.2, 4.2
      );
    }

    // Sub-stepping keeps the swimmer from tunnelling through the pool wall.
    const moveX = velocity.x * dt;
    const moveZ = velocity.z * dt;
    const distance = Math.hypot(moveX, moveZ);
    const substeps = Math.max(1, Math.ceil(distance / (BODY_RADIUS * 0.35)));
    for (let i = 0; i < substeps; i++) {
      const dx = moveX / substeps;
      const dz = moveZ / substeps;
      if (!trySwimMove(dx, dz)) {
        const movedX = trySwimMove(dx, 0);
        const movedZ = trySwimMove(0, dz);
        if (!movedX) velocity.x = 0;
        if (!movedZ) velocity.z = 0;
      }
      if (!swimming) break;
    }

    if (!swimming) {
      // The swimmer has climbed high enough to leave the water region.
      velocity.y = Math.min(velocity.y, 0);
      return;
    }

    const localBottomY = activeWater.bottomAt
      ? activeWater.bottomAt(camera.position.x, camera.position.z)
      : activeWater.bottomY;
    const bottomY = localBottomY + 0.22;
    let nextFeet = feetY + velocity.y * dt;
    if (nextFeet < bottomY) {
      nextFeet = bottomY;
      velocity.y = Math.max(0, velocity.y);
    }

    const topLimit = surfaceY + (activeWater.exitHeight ?? 1.9);
    if (nextFeet > topLimit) {
      nextFeet = topLimit;
      velocity.y = Math.min(0, velocity.y);
    }

    // Only the top of the character is tested for ceilings. Side walls and
    // the circular pool shell are tested by trySwimMove.
    if (nextFeet > feetY &&
      physics.isHeadBlocked(
        camera.position.x,
        nextFeet + PLAYER_HEIGHT,
        camera.position.z,
        BODY_RADIUS * 0.65
      )) {
      nextFeet = feetY;
      velocity.y = 0;
    }

    feetY = nextFeet;
    camera.position.y = feetY + EYE_HEIGHT;
    underwater = camera.position.y < surfaceY - 0.08;

    if (underwater) {
      oxygen = Math.max(0, oxygen - dt);
      if (oxygen <= 0) {
        respawnAfterDrowning();
        return;
      }
    } else {
      oxygen = Math.min(MAX_OXYGEN, oxygen + dt * 6.5);
    }

    bobPhase += dt * (sprinting ? 4.8 : 3.4);
    camera.position.y += Math.sin(bobPhase) * 0.008;
  }

  function update(dt) {
    if (mode === 'cinematic') {
      updateCinematic(dt);
      clearWaterState();
      oxygen = Math.min(MAX_OXYGEN, oxygen + dt * 6.5);
      syncAvatar(dt);
      return;
    }

    const sprinting = !!(keys.ShiftLeft || keys.ShiftRight || runToggle);
    const mx = THREE.MathUtils.clamp(
      (keys.KeyD || keys.ArrowRight ? 1 : 0) -
      (keys.KeyA || keys.ArrowLeft ? 1 : 0) + stick.x, -1, 1
    );
    const mz = THREE.MathUtils.clamp(
      (keys.KeyW || keys.ArrowUp ? 1 : 0) -
      (keys.KeyS || keys.ArrowDown ? 1 : 0) + stick.y, -1, 1
    );

    if (mode === 'fly') {
      camera.getWorldDirection(forward);
      right.set(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
      const speed = sprinting ? FLY_FAST : FLY_SPEED;
      direction.set(0, 0, 0);
      if (mx || mz) {
        direction.addScaledVector(forward, mz).addScaledVector(right, mx);
        direction.normalize().multiplyScalar(Math.min(1, Math.hypot(mx, mz)));
      }
      const lift = (keys.Space ? 1 : 0) - (keys.ControlLeft ? 1 : 0) + vertical;
      camera.position.addScaledVector(direction, speed * dt);
      camera.position.y = THREE.MathUtils.clamp(camera.position.y + lift * speed * dt, -100, 500);
      feetY = camera.position.y - EYE_HEIGHT;
      clearWaterState();
      const region = waterAt(camera.position.x, camera.position.z);
      underwater = !!region && camera.position.y < region.surfaceY - 0.08;
      if (underwater) {
        oxygen = Math.max(0, oxygen - dt);
        if (oxygen <= 0) {
          respawnAfterDrowning();
          return;
        }
      } else {
        oxygen = Math.min(MAX_OXYGEN, oxygen + dt * 6.5);
      }
      syncAvatar(dt);
      return;
    }

    if (!swimming) {
      const region = waterAt(camera.position.x, camera.position.z);
      const intersectsSurface = region &&
        feetY < region.surfaceY + 0.30 &&
        feetY + PLAYER_HEIGHT > region.bottomY;
      if (intersectsSurface) beginSwimming(region);
    }

    if (swimming) {
      updateSwimming(dt, mx, mz, sprinting);
      syncAvatar(dt);
      return;
    }

    underwater = false;

    euler.setFromQuaternion(camera.quaternion, 'YXZ');
    const yaw = euler.y;
    forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    right.set(Math.cos(yaw), 0, -Math.sin(yaw));

    direction.set(0, 0, 0);
    if (mx || mz) {
      direction.addScaledVector(forward, mz).addScaledVector(right, mx);
      direction.normalize().multiplyScalar(Math.min(1, Math.hypot(mx, mz)));
    }

    const targetSpeed = sprinting ? RUN_SPEED : WALK_SPEED;
    const desiredX = direction.x * targetSpeed;
    const desiredZ = direction.z * targetSpeed;
    const acceleration = grounded ? GROUND_ACCELERATION : AIR_CONTROL;
    const blend = Math.min(1, acceleration * dt);
    velocity.x += (desiredX - velocity.x) * blend;
    velocity.z += (desiredZ - velocity.z) * blend;

    const moveX = velocity.x * dt;
    const moveZ = velocity.z * dt;
    const moveDistance = Math.hypot(moveX, moveZ);
    const substeps = Math.max(1, Math.ceil(moveDistance / (BODY_RADIUS * 0.45)));
    for (let i = 0; i < substeps; i++) {
      if (!tryGroundMove(moveX / substeps, moveZ / substeps)) {
        const movedX = tryGroundMove(moveX / substeps, 0);
        const movedZ = tryGroundMove(0, moveZ / substeps);
        if (!movedX) velocity.x = 0;
        if (!movedZ) velocity.z = 0;
      }
    }

    if (jumpQueued > 0) {
      jumpQueued = Math.max(0, jumpQueued - dt);
      if (grounded) {
        velocity.y = JUMP_SPEED;
        grounded = false;
        jumpQueued = 0;
      }
    }

    if (!grounded) {
      const previousFeet = feetY;
      velocity.y -= GRAVITY * dt;
      let nextFeet = feetY + velocity.y * dt;

      if (velocity.y > 0 &&
        physics.isHeadBlocked(
          camera.position.x,
          nextFeet + PLAYER_HEIGHT,
          camera.position.z,
          BODY_RADIUS * 0.65
        )) {
        velocity.y = 0;
        nextFeet = previousFeet;
      }

      if (velocity.y <= 0) {
        const floor = physics.groundAt(
          camera.position.x, camera.position.z, previousFeet, 0.14,
          Math.max(MAX_STEP_DOWN, previousFeet - nextFeet + 0.14)
        );
        const terrainFloor = physics.terrainAt?.(camera.position.x, camera.position.z);
        const landingFloor = floor !== null ? floor : terrainFloor;
        if (Number.isFinite(landingFloor) && nextFeet <= landingFloor + 0.04) {
          // Also recover if a previous frame placed the capsule a little below
          // the rendered surface. Never keep integrating gravity underground.
          nextFeet = landingFloor;
          velocity.y = 0;
          grounded = true;
        }
      }

      feetY = nextFeet;
    } else {
      const floor = physics.groundAt(camera.position.x, camera.position.z, feetY, STEP_UP, MAX_STEP_DOWN);
      const terrainFloor = physics.terrainAt?.(camera.position.x, camera.position.z);
      if (floor !== null) feetY = floor;
      else if (Number.isFinite(terrainFloor) && Math.abs(terrainFloor - feetY) < 3.8) feetY = terrainFloor;
      velocity.y = 0;
    }

    if (feetY < -40) {
      resetToSpawn(false);
      return;
    }

    bobPhase += dt * (sprinting ? 11.5 : 8.0) * (direction.lengthSq() > 0.001 ? 1 : 0);
    const bob = grounded && direction.lengthSq() > 0.001
      ? Math.sin(bobPhase) * (sprinting ? 0.025 : 0.014)
      : 0;
    camera.position.y = feetY + EYE_HEIGHT + bob;

    euler.setFromQuaternion(camera.quaternion, 'YXZ');
    euler.z = grounded && direction.lengthSq() > 0.001 ? Math.sin(bobPhase * 0.5) * 0.002 : 0;
    camera.quaternion.setFromEuler(euler);

    oxygen = Math.min(MAX_OXYGEN, oxygen + dt * 6.5);
    syncAvatar(dt);
  }

  return {
    controls,
    update,
    get mode() { return mode; },
    get run() { return runToggle; },
    get grounded() { return grounded; },
    get feetY() { return feetY; },
    get swimming() { return swimming; },
    get underwater() { return underwater; },
    get oxygen() { return oxygen; },
    get maxOxygen() { return MAX_OXYGEN; },
    get oxygenRatio() { return oxygen / MAX_OXYGEN; },
    get activeWater() { return activeWater; },
    get body() { return avatar.root; },
    get hitbox() {
      return {
        type: 'cylinder', radius: BODY_RADIUS, height: PLAYER_HEIGHT,
        feetY, centerX: camera.position.x, centerZ: camera.position.z,
      };
    },
    setHitboxVisible(visible) {
      hitboxVisible = !!visible;
      syncAvatar();
    },
    consumeDrownedEvent() {
      const value = drownedEvent;
      drownedEvent = false;
      return value;
    },
    setMode,
    jump() {
      if (mode !== 'fly' && !swimming && !grounded) jumpQueued = Math.max(jumpQueued, 0.16);
      else if (mode !== 'fly' && !swimming) jumpQueued = 0.16;
    },
    setMoveVector(x, y) {
      stick.x = THREE.MathUtils.clamp(x, -1, 1);
      stick.y = THREE.MathUtils.clamp(y, -1, 1);
    },
    setVertical(value) { vertical = THREE.MathUtils.clamp(value, -1, 1); },
    setRun(on) { runToggle = !!on; },
    look(dx, dy) { applyLook(dx, dy); },
    lock: () => controls.lock(),
    unlock: () => controls.unlock(),
    get locked() { return pointerLocked; },
  };
}
