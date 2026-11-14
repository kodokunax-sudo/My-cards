import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import {
  EYE_HEIGHT, PLAYER_HEIGHT, GRAVITY,
} from './config.js';

const WALK_SPEED = 5.4;
const RUN_SPEED = 10.2;
const FLY_SPEED = 14.0;
const FLY_FAST = 34.0;
const FLY_BOOST_RAMP_SECONDS = 3.0;
const FLY_BOOST_MAX_MULTIPLIER = 3.0;
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

  // The animation pivot sits around the hips, so swimming and falling rotate
  // the whole body naturally instead of swinging it around the ankles.
  const motion = new THREE.Group();
  motion.name = 'player-body-animation';
  motion.position.y = 0.78;
  root.add(motion);

  const skin = new THREE.MeshStandardMaterial({
    color: 0xc18b6b, roughness: 0.9,
  });
  const skinLight = new THREE.MeshStandardMaterial({
    color: 0xd5a080, roughness: 0.92,
  });
  const shirt = new THREE.MeshStandardMaterial({
    color: 0x315d83, roughness: 0.94,
  });
  const shirtLight = new THREE.MeshStandardMaterial({
    color: 0x477ba0, roughness: 0.92,
  });
  const shirtDark = new THREE.MeshStandardMaterial({
    color: 0x203f5a, roughness: 0.96,
  });
  const pants = new THREE.MeshStandardMaterial({
    color: 0x505b68, roughness: 0.98,
  });
  const pantsLight = new THREE.MeshStandardMaterial({
    color: 0x687482, roughness: 0.98,
  });
  const boots = new THREE.MeshStandardMaterial({
    color: 0x43382f, roughness: 1,
  });
  const sole = new THREE.MeshStandardMaterial({
    color: 0x292722, roughness: 1,
  });
  const detail = new THREE.MeshStandardMaterial({
    color: 0xb9c1c7, roughness: 0.82, metalness: 0.08,
  });

  function ellipsoid(parent, material, position, scale, segments = 14) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, segments, 12),
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

  // Compact, balanced torso with a simple jacket, rather than exaggerated
  // bodybuilder anatomy. The character's chest faces local +Z.
  ellipsoid(motion, pants, [0, -0.055, 0], [0.205, 0.145, 0.135]);
  ellipsoid(motion, shirt, [0, 0.295, -0.005], [0.255, 0.355, 0.155], 16);
  ellipsoid(motion, shirtDark, [0, 0.025, 0.005], [0.225, 0.105, 0.145]);
  ellipsoid(motion, shirtLight, [0, 0.535, 0.012], [0.205, 0.09, 0.145]);
  ellipsoid(motion, shirtDark, [0, 0.575, 0.015], [0.105, 0.045, 0.12]);

  // A restrained front seam and pockets make the outfit readable at close range.
  box(motion, shirtDark, [0.018, 0.34, 0.012], [0, 0.29, 0.154]);
  for (const side of [-1, 1]) {
    box(motion, shirtLight, [0.09, 0.085, 0.012], [side * 0.145, 0.34, 0.15]);
    box(motion, shirtDark, [0.092, 0.014, 0.014], [side * 0.145, 0.29, 0.153]);
  }
  for (const y of [0.43, 0.33, 0.23]) {
    ellipsoid(motion, detail, [0.012, y, 0.166], [0.012, 0.012, 0.008], 8);
  }

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.078, 0.13, 12), skin);
  neck.position.set(0, 0.61, 0);
  neck.castShadow = true;
  neck.userData.noCollider = true;
  motion.add(neck);
  const head = ellipsoid(motion, skin, [0, 0.755, 0.005], [0.13, 0.145, 0.125], 16);
  // The head remains outside the first-person view, but is present for external views.
  head.layers.set(1);

  function makeArm(side) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.245, 0.515, 0);
    motion.add(shoulder);

    ellipsoid(shoulder, shirt, [side * 0.012, -0.13, 0], [0.105, 0.17, 0.098]);
    ellipsoid(shoulder, shirtLight, [side * 0.012, -0.255, 0], [0.086, 0.045, 0.084]);

    const elbow = new THREE.Group();
    elbow.position.set(0, -0.30, 0);
    shoulder.add(elbow);
    ellipsoid(elbow, shirt, [0, -0.125, 0], [0.079, 0.155, 0.078]);
    ellipsoid(elbow, shirtDark, [0, -0.255, 0], [0.082, 0.035, 0.081]);

    const hand = new THREE.Group();
    hand.position.set(0, -0.285, 0);
    elbow.add(hand);

    // A compact, readable hand: broad palm, rounded knuckle line and a small
    // tucked-in thumb. It is deliberately simple, but no longer a tiny ball
    // attached to a segmented tube.
    ellipsoid(hand, skin, [0, -0.035, 0.012], [0.071, 0.079, 0.057], 18);
    ellipsoid(hand, skinLight, [0, -0.074, 0.057], [0.050, 0.018, 0.008], 14);
    ellipsoid(hand, skin, [side * -0.047, -0.043, 0.018], [0.022, 0.036, 0.025], 12);

    return { shoulder, elbow, hand };
  }

  // Keep the full-body arms in a separate render layer. The first-person
  // camera uses layers 0 and 2, while the articulated survival hand/tool
  // model is rendered on layer 0. This prevents the avatar arms from being
  // drawn underneath the dedicated first-person arms (the "three arms" bug).
  const leftArm = makeArm(-1);
  const rightArm = makeArm(1);
  // The ordinary left arm belongs to the visible character body and follows
  // the body's walk/swim/fall animation. Only the avatar's right arm is hidden,
  // because the animated first-person right hand replaces it in the camera.
  leftArm.shoulder.traverse((object) => object.layers.set(0));
  rightArm.shoulder.traverse((object) => object.layers.set(1));

  function makeLeg(side) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.12, -0.12, 0);
    motion.add(hip);

    ellipsoid(hip, pants, [0, -0.15, 0], [0.105, 0.205, 0.108]);

    const knee = new THREE.Group();
    knee.position.y = -0.31;
    hip.add(knee);
    ellipsoid(knee, pants, [0, -0.14, 0], [0.073, 0.18, 0.078]);
    ellipsoid(knee, pantsLight, [side * 0.012, -0.12, 0.065], [0.025, 0.10, 0.018], 10);
    box(knee, boots, [0.18, 0.12, 0.29], [0, -0.27, -0.055]);
    box(knee, sole, [0.182, 0.025, 0.292], [0, -0.337, -0.055]);
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
  function animate(dt, speed, sprinting, swimming, underwater, flying, grounded, verticalVelocity) {
    const moveAmount = THREE.MathUtils.clamp(speed / (sprinting ? 10.2 : 5.4), 0, 1);
    let leftShoulderX = 0;
    let rightShoulderX = 0;
    let leftShoulderZ = -0.06;
    let rightShoulderZ = 0.06;
    let leftElbowX = -0.08;
    let rightElbowX = -0.08;
    let leftElbowZ = -0.02;
    let rightElbowZ = 0.02;
    let leftLegX = 0;
    let rightLegX = 0;
    let bodyY = 0;
    let bodyX = 0;
    let bodyZ = 0;
    let blendSpeed = 10;

    if (swimming && underwater) {
      // Underwater: the body becomes nearly horizontal, arms alternate in a
      // front-crawl pull, and the legs perform a continuous flutter kick.
      phase += dt * (sprinting ? 7.4 : 5.8);
      const wave = Math.sin(phase);
      leftShoulderX = 0.88 + wave * 0.72;
      rightShoulderX = 0.88 - wave * 0.72;
      leftShoulderZ = -0.12;
      rightShoulderZ = 0.12;
      leftElbowX = -0.34 + Math.max(0, -wave) * 0.52;
      rightElbowX = -0.34 + Math.max(0, wave) * 0.52;
      leftLegX = wave * 0.58;
      rightLegX = -wave * 0.58;
      bodyY = 0.025 + Math.sin(phase * 2) * 0.018;
      bodyX = -1.02 + Math.sin(phase) * 0.035;
      bodyZ = Math.sin(phase * 0.5) * 0.018;
      blendSpeed = 7.5;
    } else if (swimming) {
      // At the surface: arms stay extended left/right to scull and keep the
      // shoulders above the water, while the legs tread gently below.
      phase += dt * (sprinting ? 4.7 : 3.3);
      const wave = Math.sin(phase);
      leftShoulderX = -0.06 + Math.sin(phase * 0.72) * 0.10;
      rightShoulderX = -0.06 - Math.sin(phase * 0.72) * 0.10;
      leftShoulderZ = -1.28 + wave * 0.075;
      rightShoulderZ = 1.28 - wave * 0.075;
      leftElbowX = -0.16 + Math.max(0, wave) * 0.12;
      rightElbowX = -0.16 + Math.max(0, -wave) * 0.12;
      leftElbowZ = -0.13;
      rightElbowZ = 0.13;
      leftLegX = 0.36 + wave * 0.34;
      rightLegX = 0.36 - wave * 0.34;
      bodyY = Math.sin(phase * 2) * 0.022;
      bodyX = 0.035 + Math.sin(phase) * 0.018;
      bodyZ = Math.sin(phase * 0.5) * 0.025;
      blendSpeed = 8;
    } else if (!flying && !grounded && verticalVelocity > 0.15) {
      // Jumping upward: the arms open to the sides, the knees bend, and the
      // chest leans slightly back before the arc reaches its apex.
      phase += dt * 2.8;
      const sway = Math.sin(phase) * 0.045;
      leftShoulderX = -0.22;
      rightShoulderX = -0.22;
      leftShoulderZ = -0.58 + sway;
      rightShoulderZ = 0.58 - sway;
      leftElbowX = -0.48;
      rightElbowX = -0.48;
      leftElbowZ = -0.12;
      rightElbowZ = 0.12;
      leftLegX = 0.48;
      rightLegX = 0.48;
      bodyY = 0.015;
      bodyX = 0.14;
      blendSpeed = 8;
    } else if (!flying && !grounded) {
      // Falling: the chest pitches forward, arms spread asymmetrically for
      // balance, and bent knees react to the changing fall speed.
      phase += dt * 3.6;
      const flutter = Math.sin(phase) * 0.10;
      const fallAmount = THREE.MathUtils.clamp((-verticalVelocity - 1.0) / 15, 0, 1);
      leftShoulderX = -0.18 + flutter;
      rightShoulderX = -0.18 - flutter;
      leftShoulderZ = -0.92 - fallAmount * 0.16;
      rightShoulderZ = 0.92 + fallAmount * 0.16;
      leftElbowX = -0.48 - fallAmount * 0.12;
      rightElbowX = -0.48 - fallAmount * 0.12;
      leftElbowZ = -0.18;
      rightElbowZ = 0.18;
      leftLegX = 0.52 + flutter * 0.5;
      rightLegX = 0.42 - flutter * 0.5;
      bodyX = -0.22 - fallAmount * 0.12;
      bodyZ = flutter * 0.6;
      blendSpeed = 6.8;
    } else if (flying) {
      // Flight: arms reach forward and the legs trail behind.
      leftShoulderX = 1.28;
      rightShoulderX = 1.28;
      leftShoulderZ = -0.10;
      rightShoulderZ = 0.10;
      leftElbowX = -0.28;
      rightElbowX = -0.28;
      leftLegX = -0.12;
      rightLegX = -0.12;
      bodyX = -0.18;
      blendSpeed = 8;
    } else {
      // Walking and running use a simple opposing arm/leg gait.
      if (moveAmount > 0.02) phase += dt * (sprinting ? 10.5 : 7.3);
      else phase += dt * 1.2;
      const swing = Math.sin(phase) * moveAmount * (sprinting ? 0.78 : 0.48);
      leftShoulderX = swing;
      rightShoulderX = -swing;
      leftElbowX = -0.08 - Math.max(0, -swing) * 0.16;
      rightElbowX = -0.08 - Math.max(0, swing) * 0.16;
      leftLegX = -swing;
      rightLegX = swing;
      bodyY = moveAmount > 0.02
        ? Math.abs(Math.sin(phase * 2)) * (sprinting ? 0.032 : 0.016)
        : Math.sin(phase) * 0.003;
      bodyZ = Math.sin(phase) * (moveAmount * 0.012 + 0.001);
      blendSpeed = 12;
    }

    const blend = 1 - Math.exp(-blendSpeed * Math.max(0, dt));
    const settle = (object, axis, target) => {
      object.rotation[axis] += (target - object.rotation[axis]) * blend;
    };
    settle(leftArm.shoulder, 'x', leftShoulderX);
    settle(rightArm.shoulder, 'x', rightShoulderX);
    settle(leftArm.shoulder, 'z', leftShoulderZ);
    settle(rightArm.shoulder, 'z', rightShoulderZ);
    settle(leftArm.elbow, 'x', leftElbowX);
    settle(rightArm.elbow, 'x', rightElbowX);
    settle(leftArm.elbow, 'z', leftElbowZ);
    settle(rightArm.elbow, 'z', rightElbowZ);
    settle(leftLeg, 'x', leftLegX);
    settle(rightLeg, 'x', rightLegX);
    motion.position.y += (0.78 + bodyY - motion.position.y) * blend;
    motion.rotation.x += (bodyX - motion.rotation.x) * blend;
    motion.rotation.z += (bodyZ - motion.rotation.z) * blend;
  }

  // Keep the actual avatar body on the first-person camera layer. The head and
  // neck stay hidden to prevent clipping; the left arm remains attached to the
  // torso and visible, while only the right body arm is replaced by the animated
  // first-person tool/hand model.
  root.traverse((object) => object.layers.set(0));
  head.layers.set(1);
  neck.layers.set(1);
  leftArm.shoulder.traverse((object) => object.layers.set(0));
  rightArm.shoulder.traverse((object) => object.layers.set(1));

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
  let flyBoostTime = 0;
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
      underwater,
      mode === 'fly',
      grounded,
      velocity.y
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
    if (next === 'fly' || previous === 'fly') flyBoostTime = 0;

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
      direction.set(0, 0, 0);
      if (mx || mz) {
        direction.addScaledVector(forward, mz).addScaledVector(right, mx);
        direction.normalize().multiplyScalar(Math.min(1, Math.hypot(mx, mz)));
      }
      const lift = (keys.Space ? 1 : 0) - (keys.ControlLeft ? 1 : 0) + vertical;

      // Flying builds momentum while the player actively moves. After three
      // continuous seconds the flight reaches 3x its current base speed.
      const hasFlightInput = Math.hypot(mx, mz, lift) > 0.04;
      if (hasFlightInput) {
        flyBoostTime = Math.min(FLY_BOOST_RAMP_SECONDS, flyBoostTime + dt);
      } else {
        flyBoostTime = Math.max(0, flyBoostTime - dt * 1.6);
      }
      const boostProgress = THREE.MathUtils.clamp(
        flyBoostTime / FLY_BOOST_RAMP_SECONDS, 0, 1
      );
      const easedBoost = boostProgress * boostProgress * (3 - 2 * boostProgress);
      const flightMultiplier = THREE.MathUtils.lerp(
        1, FLY_BOOST_MAX_MULTIPLIER, easedBoost
      );
      const baseFlightSpeed = sprinting ? FLY_FAST : FLY_SPEED;
      const speed = baseFlightSpeed * flightMultiplier;

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
    get flySpeedMultiplier() {
      const progress = THREE.MathUtils.clamp(flyBoostTime / FLY_BOOST_RAMP_SECONDS, 0, 1);
      const eased = progress * progress * (3 - 2 * progress);
      return THREE.MathUtils.lerp(1, FLY_BOOST_MAX_MULTIPLIER, eased);
    },
    get body() { return avatar.root; },
    getSaveState() {
      return {
        position: camera.position.toArray(),
        quaternion: camera.quaternion.toArray(),
        feetY,
        oxygen,
        mode: mode === 'fly' ? 'fly' : 'walk',
      };
    },
    restoreState(state) {
      if (!state || !Array.isArray(state.position) || state.position.length < 3) return false;
      const [x, y, z] = state.position.map(Number);
      if (![x, y, z].every(Number.isFinite) ||
        Math.abs(x) > 12000 || Math.abs(z) > 12000 || y < -200 || y > 2000) return false;

      const nextMode = state.mode === 'fly' ? 'fly' : 'walk';
      if (mode !== nextMode) setMode(nextMode);

      camera.position.set(x, y, z);
      if (Array.isArray(state.quaternion) && state.quaternion.length === 4 &&
        state.quaternion.map(Number).every(Number.isFinite)) {
        camera.quaternion.set(...state.quaternion.map(Number)).normalize();
      }

      feetY = Number.isFinite(Number(state.feetY))
        ? THREE.MathUtils.clamp(Number(state.feetY), -200, 1990)
        : camera.position.y - EYE_HEIGHT;
      oxygen = Number.isFinite(Number(state.oxygen))
        ? THREE.MathUtils.clamp(Number(state.oxygen), 0, MAX_OXYGEN)
        : MAX_OXYGEN;

      velocity.set(0, 0, 0);
      jumpQueued = 0;
      grounded = nextMode !== 'fly';
      clearWaterState();
      onModeChange?.(mode);
      syncAvatar();
      return true;
    },
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
    respawn() {
      resetToSpawn(false);
    },
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
