import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import {
  EYE_HEIGHT, PLAYER_HEIGHT, GRAVITY, POOL_RADIUS, WATER_Y, POOL_BOTTOM_Y,
} from './config.js';

const WALK_SPEED = 4.6;
const RUN_SPEED = 8.8;
const FLY_SPEED = 14.0;
const FLY_FAST = 34.0;
const BODY_RADIUS = 0.32;
const STEP_UP = 0.46;
const MAX_STEP_DOWN = 0.82;
const JUMP_SPEED = 6.4;
const AIR_CONTROL = 5.0;
const GROUND_ACCELERATION = 15.0;

// The circular wall is just inside the water mesh. Keep the player's centre
// a little farther in so the capsule never clips through the basin wall.
const WATER_RADIUS = POOL_RADIUS - 1.25 - 0.8;
const SWIM_SURFACE_FEET = WATER_Y + 0.12 - EYE_HEIGHT;
const SWIM_TOP_FEET = WATER_Y + 1.05;
const MAX_OXYGEN = 24;
const SWIM_SPEED = 2.8;
const SWIM_RUN_SPEED = 4.0;

export function createPlayer(camera, domElement, physics, onModeChange) {
  const controls = new PointerLockControls(camera, domElement);

  const spawn = new THREE.Vector3(0, 0, 70);
  const spawnFloor = physics.groundAt(spawn.x, spawn.z, 0, 0.5, 1.0) ?? 0;
  let feetY = spawnFloor;

  camera.position.set(spawn.x, feetY + EYE_HEIGHT, spawn.z);
  camera.lookAt(0, 25, 0);
  controls.getObject().position.copy(camera.position);

  const keys = Object.create(null);
  const stick = { x: 0, y: 0 };
  let vertical = 0;
  let runToggle = false;
  let mode = 'walk';
  let grounded = true;
  let swimming = false;
  let underwater = false;
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

  // Pointer lock is preferred; click-and-drag remains available on browsers
  // that reject pointer lock.
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

  function setMode(next) {
    if (mode === next) return;
    const previous = mode;
    mode = next;

    if (next === 'fly') {
      velocity.set(0, 0, 0);
      grounded = false;
      swimming = false;
      underwater = false;
    } else if (previous === 'fly' || previous === 'cinematic') {
      // Leaving a free-flight/cinematic camera re-enters the physical world
      // from the camera's actual position, then gravity/buoyancy takes over.
      feetY = camera.position.y - EYE_HEIGHT;
      velocity.set(0, 0, 0);
      grounded = false;
      swimming = false;
      underwater = false;
    }

    onModeChange?.(mode);
  }

  function onKeyDown(event) {
    const key = event.code;
    if (key === 'Space' && mode !== 'fly') {
      event.preventDefault();
      if (!swimming && !event.repeat) jumpQueued = 0.16;
    }

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

  function tryHorizontalMove(dx, dz, allowLeavingWater = false) {
    if (Math.abs(dx) + Math.abs(dz) < 1e-7) return false;

    const nx = camera.position.x + dx;
    const nz = camera.position.z + dz;
    const distance = Math.hypot(nx, nz);
    const nextInsideWater = distance < WATER_RADIUS + 0.35;

    // The player may leave the pool only after swimming above its stone rim.
    if (swimming && !nextInsideWater && feetY < WATER_Y + 0.65) return false;
    if (swimming && !nextInsideWater) allowLeavingWater = true;

    let nextFeet = feetY;
    if (!swimming || allowLeavingWater) {
      const floor = physics.groundAt(nx, nz, feetY, STEP_UP, MAX_STEP_DOWN);
      if (grounded && floor === null && !swimming) return false;
      if (grounded && floor !== null) nextFeet = floor;
    }

    if (physics.isBlocked(nx, nextFeet, nz, BODY_RADIUS, PLAYER_HEIGHT)) return false;

    camera.position.x = nx;
    camera.position.z = nz;
    if (grounded && nextFeet !== feetY) feetY = nextFeet;
    return true;
  }

  function respawnAfterDrowning() {
    drownedEvent = true;
    swimming = false;
    underwater = false;
    grounded = true;
    oxygen = MAX_OXYGEN;
    feetY = spawnFloor;
    velocity.set(0, 0, 0);
    jumpQueued = 0;
    camera.position.set(spawn.x, spawnFloor + EYE_HEIGHT, spawn.z);
    camera.lookAt(0, 25, 0);
  }

  function updateSwimming(dt, mx, mz, sprinting) {
    euler.setFromQuaternion(camera.quaternion, 'YXZ');
    const yaw = euler.y;
    forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    right.set(Math.cos(yaw), 0, -Math.sin(yaw));

    direction.set(0, 0, 0);
    if (mx || mz) {
      direction.addScaledVector(forward, mz).addScaledVector(right, mx);
      direction.normalize().multiplyScalar(Math.min(1, Math.hypot(mx, mz)));
    }

    const swimSpeed = sprinting ? SWIM_RUN_SPEED : SWIM_SPEED;
    const blend = Math.min(1, 4.5 * dt);
    velocity.x += (direction.x * swimSpeed - velocity.x) * blend;
    velocity.z += (direction.z * swimSpeed - velocity.z) * blend;

    const moveX = velocity.x * dt;
    const moveZ = velocity.z * dt;
    const distance = Math.hypot(moveX, moveZ);
    const substeps = Math.max(1, Math.ceil(distance / (BODY_RADIUS * 0.4)));
    for (let i = 0; i < substeps; i++) {
      const sx = moveX / substeps;
      const sz = moveZ / substeps;
      if (!tryHorizontalMove(sx, sz)) {
        const movedX = tryHorizontalMove(sx, 0);
        const movedZ = tryHorizontalMove(0, sz);
        if (!movedX) velocity.x = 0;
        if (!movedZ) velocity.z = 0;
      }
    }

    // Space swims upward, C/Control dives. Releasing both lets buoyancy
    // carry the player back toward the surface.
    const verticalInput = THREE.MathUtils.clamp(
      (keys.Space ? 1 : 0) -
      ((keys.KeyC || keys.ControlLeft) ? 1 : 0) + vertical, -1, 1
    );

    if (Math.abs(verticalInput) > 0.01) {
      const desiredVertical = verticalInput * 2.65;
      velocity.y += (desiredVertical - velocity.y) * Math.min(1, 4.2 * dt);
    } else {
      const buoyancy = (SWIM_SURFACE_FEET - feetY) * 3.0;
      velocity.y += (buoyancy - velocity.y) * Math.min(1, 2.4 * dt);
    }

    const previousFeet = feetY;
    let nextFeet = feetY + velocity.y * dt;
    nextFeet = Math.min(nextFeet, SWIM_TOP_FEET);

    // The pool floor is a real walkable mesh, 28 metres below the waterline.
    const bottom = physics.groundAt(
      camera.position.x, camera.position.z, previousFeet, 0.16,
      Math.max(0.3, previousFeet - POOL_BOTTOM_Y + 0.3)
    );
    if (bottom !== null && nextFeet < bottom + 0.18) {
      nextFeet = bottom + 0.18;
      velocity.y = Math.max(0, velocity.y);
    }

    // Prevent swimming through the bridge, fountain structure or basin walls.
    if (nextFeet > previousFeet &&
      physics.isBlocked(camera.position.x, nextFeet, camera.position.z, BODY_RADIUS, PLAYER_HEIGHT)) {
      nextFeet = previousFeet;
      velocity.y = 0;
    }
    feetY = nextFeet;

    const distanceFromCentre = Math.hypot(camera.position.x, camera.position.z);
    if (distanceFromCentre > POOL_RADIUS + 1.6 && feetY > WATER_Y + 0.45) {
      swimming = false;
      grounded = false;
      velocity.y = Math.min(velocity.y, 0);
      return;
    }

    camera.position.y = feetY + EYE_HEIGHT;
    underwater = camera.position.y < WATER_Y - 0.08;

    if (underwater) {
      oxygen = Math.max(0, oxygen - dt);
      if (oxygen <= 0) {
        respawnAfterDrowning();
        return;
      }
    } else {
      oxygen = Math.min(MAX_OXYGEN, oxygen + dt * 5.5);
    }

    bobPhase += dt * (sprinting ? 5.0 : 3.6);
    camera.position.y += Math.sin(bobPhase) * 0.012;
  }

  function update(dt) {
    if (mode === 'cinematic') {
      updateCinematic(dt);
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
      right.crossVectors(forward, camera.up).normalize();
      const speed = sprinting ? FLY_FAST : FLY_SPEED;
      direction.set(0, 0, 0);
      if (mx || mz) {
        direction.addScaledVector(forward, mz).addScaledVector(right, mx);
        direction.normalize().multiplyScalar(Math.min(1, Math.hypot(mx, mz)));
      }
      const lift = (keys.Space ? 1 : 0) - (keys.KeyC || keys.ControlLeft ? 1 : 0) + vertical;
      camera.position.addScaledVector(direction, speed * dt);
      camera.position.y = THREE.MathUtils.clamp(camera.position.y + lift * speed * dt, 0.5, 500);
      feetY = camera.position.y - EYE_HEIGHT;
      swimming = false;
      underwater = false;
      oxygen = Math.min(MAX_OXYGEN, oxygen + dt * 5.5);
      return;
    }

    const insideWater = Math.hypot(camera.position.x, camera.position.z) < WATER_RADIUS;
    if (!swimming && insideWater && feetY < WATER_Y + 0.28) {
      swimming = true;
      grounded = false;
      // The character becomes buoyant when entering the pool.
      feetY = Math.min(feetY, SWIM_SURFACE_FEET);
      velocity.y = 0;
      jumpQueued = 0;
      velocity.x *= 0.35;
      velocity.z *= 0.35;
    }

    if (swimming) {
      updateSwimming(dt, mx, mz, sprinting);
      return;
    }

    underwater = false;

    // Horizontal acceleration and friction. Air control is weaker than ground control.
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
    const stepX = moveX / substeps;
    const stepZ = moveZ / substeps;

    for (let i = 0; i < substeps; i++) {
      if (!tryHorizontalMove(stepX, stepZ)) {
        const movedX = tryHorizontalMove(stepX, 0);
        const movedZ = tryHorizontalMove(0, stepZ);
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
        physics.isBlocked(camera.position.x, nextFeet, camera.position.z, BODY_RADIUS, PLAYER_HEIGHT)) {
        velocity.y = 0;
        nextFeet = previousFeet;
      }

      if (velocity.y <= 0) {
        const floor = physics.groundAt(
          camera.position.x, camera.position.z, previousFeet, 0.14,
          Math.max(MAX_STEP_DOWN, previousFeet - nextFeet + 0.14)
        );
        if (floor !== null && nextFeet <= floor && previousFeet >= floor - 0.12) {
          nextFeet = floor;
          velocity.y = 0;
          grounded = true;
        }
      }

      feetY = nextFeet;
    } else {
      const floor = physics.groundAt(camera.position.x, camera.position.z, feetY, STEP_UP, MAX_STEP_DOWN);
      if (floor !== null) feetY = floor;
      velocity.y = 0;
    }

    if (feetY < -30) {
      respawnAfterDrowning();
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

    oxygen = Math.min(MAX_OXYGEN, oxygen + dt * 5.5);
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
