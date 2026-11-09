import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { EYE_HEIGHT, PLAYER_HEIGHT, GRAVITY } from './config.js';

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

export function createPlayer(camera, domElement, physics, onModeChange) {
  const controls = new PointerLockControls(camera, domElement);

  // Spawn on the open plaza, facing the fountain. Eye height is derived
  // from the real ground surface and the configured human body height.
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
  let jumpQueued = 0;
  let bobPhase = 0;
  let dragging = false;
  let pointerLocked = false;

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
    } else if (previous === 'fly' || previous === 'cinematic') {
      // Leaving a free-flight/cinematic camera re-enters the physical world
      // from the camera's actual position, then gravity takes over.
      feetY = camera.position.y - EYE_HEIGHT;
      velocity.set(0, 0, 0);
      grounded = false;
    }

    onModeChange?.(mode);
  }

  function onKeyDown(event) {
    const key = event.code;
    if (key === 'Space' && mode !== 'fly') {
      event.preventDefault();
      if (!event.repeat) jumpQueued = 0.16;
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

  function tryHorizontalMove(dx, dz) {
    if (Math.abs(dx) + Math.abs(dz) < 1e-7) return false;

    const nx = camera.position.x + dx;
    const nz = camera.position.z + dz;
    let nextFeet = feetY;

    if (grounded) {
      const floor = physics.groundAt(nx, nz, feetY, STEP_UP, MAX_STEP_DOWN);
      if (floor === null) return false;
      nextFeet = floor;
    }

    if (physics.isBlocked(nx, nextFeet, nz, BODY_RADIUS, PLAYER_HEIGHT)) return false;

    camera.position.x = nx;
    camera.position.z = nz;
    if (grounded) feetY = nextFeet;
    return true;
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
      return;
    }

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
        // Resolve each axis independently to slide along walls instead of sticking.
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

      // Ceiling/head collision also uses the real scene geometry.
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

    // Safety recovery in case the player ever falls outside the walkable world.
    if (feetY < -30) {
      const floor = physics.groundAt(spawn.x, spawn.z, 0, 0.5, 2) ?? 0;
      camera.position.set(spawn.x, floor + EYE_HEIGHT, spawn.z);
      feetY = floor;
      velocity.set(0, 0, 0);
      grounded = true;
    }

    bobPhase += dt * (sprinting ? 11.5 : 8.0) * (direction.lengthSq() > 0.001 ? 1 : 0);
    const bob = grounded && direction.lengthSq() > 0.001
      ? Math.sin(bobPhase) * (sprinting ? 0.025 : 0.014)
      : 0;
    camera.position.y = feetY + EYE_HEIGHT + bob;

    // Tiny step roll only; yaw and pitch remain controlled by the camera.
    euler.setFromQuaternion(camera.quaternion, 'YXZ');
    euler.z = grounded && direction.lengthSq() > 0.001 ? Math.sin(bobPhase * 0.5) * 0.002 : 0;
    camera.quaternion.setFromEuler(euler);
  }

  return {
    controls,
    update,
    get mode() { return mode; },
    get run() { return runToggle; },
    get grounded() { return grounded; },
    get feetY() { return feetY; },
    setMode,
    jump() { if (mode !== 'fly' && !grounded) jumpQueued = Math.max(jumpQueued, 0.16); else if (mode !== 'fly') jumpQueued = 0.16; },
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
