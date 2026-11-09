import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { POOL_RADIUS, EYE_HEIGHT } from './config.js';

const WALK_SPEED = 4.4;
const RUN_SPEED = 11.0;
const FLY_SPEED = 14.0;
const FLY_FAST = 42.0;

/** Высота опоры под ногами. */
export function groundHeight(x, z) {
  const d = Math.hypot(x, z);
  if (d < 14.2) return 4.2;            // площадка островка
  if (d < 15.4) return 3.4;            // верхний ярус
  if (d < 16.6) return 2.4;            // средний ярус
  if (Math.abs(z) <= 3.0 && x > 15.0 && x < 57.0) {
    if (x >= 53.2) return Math.max(0, 2.4 * (1 - (x - 53.2) / 2.4));
    return 2.4;                        // настил моста
  }
  return 0;
}

function isValid(x, z) {
  const d = Math.hypot(x, z);
  const onIsland = d < 16.6;
  const onDeck = Math.abs(z) <= 2.6 && x > 15.0 && x < 57.0;
  if (onIsland) return onDeck || d <= 15.4;
  if (onDeck) return true;
  if (Math.abs(d - 132) < 3.2) return false;   // колоннада
  return d >= POOL_RADIUS + 2.2;
}

export function createPlayer(camera, domElement, onModeChange) {
  const controls = new PointerLockControls(camera, domElement);
  camera.position.set(0, 1.62, 132);
  camera.rotation.set(0.19, 0, 0);

  const keys = Object.create(null);
  const stick = { x: 0, y: 0 };     // виртуальный джойстик (тач)
  let vertical = 0;                // вверх/вниз в режиме полёта (тач)
  let runToggle = false;
  let mode = 'walk';           // walk | fly | cinematic
  let bobPhase = 0;
  let dragging = false;
  let pointerLocked = false;

  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const dir = new THREE.Vector3();

  // --- мышь: захват указателя + запасной вариант «перетаскивание» ---
  domElement.addEventListener('mousedown', (e) => {
    if (!pointerLocked && e.button === 0) dragging = true;
  });
  window.addEventListener('mouseup', () => { dragging = false; });
  window.addEventListener('mousemove', (e) => {
    if (pointerLocked || !dragging) return;
    applyLook(e.movementX || 0, e.movementY || 0);
  });

  function applyLook(dx, dy) {
    euler.setFromQuaternion(camera.quaternion, 'YXZ');
    euler.y -= dx * 0.0022;
    euler.x -= dy * 0.0022;
    euler.x = Math.max(-1.5, Math.min(1.5, euler.x));
    camera.quaternion.setFromEuler(euler);
  }
  controls.addEventListener('lock', () => { pointerLocked = true; });
  controls.addEventListener('unlock', () => { pointerLocked = false; });

  function setMode(next) {
    if (mode === next) return;
    mode = next;
    onModeChange?.(mode);
  }

  const toggles = {
    fly: () => setMode(mode === 'fly' ? 'walk' : 'fly'),
    cinematic: () => setMode(mode === 'cinematic' ? 'walk' : 'cinematic'),
  };

  function onKeyDown(e) {
    const k = e.code;
    keys[k] = true;
    if (k === 'KeyF') toggles.fly();
    if (k === 'KeyT') toggles.cinematic();
    if (mode === 'cinematic' && ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) {
      setMode('walk');
    }
  }
  function onKeyUp(e) { keys[e.code] = false; }
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

  const cinematic = { angle: 0.7, t: 0 };

  function updateCinematic(dt) {
    cinematic.t += dt;
    const t = cinematic.t;
    cinematic.angle += dt * 0.055;
    const radius = 96 + 46 * Math.sin(t * 0.085);
    const height = 7 + 40 * (0.5 + 0.5 * Math.sin(t * 0.13 + 0.7));
    const look = 16 + 30 * (0.5 + 0.5 * Math.sin(t * 0.101 + 2.1));
    camera.position.set(
      Math.cos(cinematic.angle) * radius,
      height,
      Math.sin(cinematic.angle) * radius
    );
    camera.lookAt(0, look, 0);
  }

  function update(dt) {
    if (mode === 'cinematic') { updateCinematic(dt); return; }

    euler.setFromQuaternion(camera.quaternion, 'YXZ');
    const yaw = euler.y;

    let mx = 0, mz = 0, my = 0;
    if (keys.KeyW || keys.ArrowUp) mz += 1;
    if (keys.KeyS || keys.ArrowDown) mz -= 1;
    if (keys.KeyD || keys.ArrowRight) mx += 1;
    if (keys.KeyA || keys.ArrowLeft) mx -= 1;
    mx += stick.x;
    mz += stick.y;
    const sprinting = keys.ShiftLeft || keys.ShiftRight || runToggle;

    if (mode === 'fly') {
      camera.getWorldDirection(forward);
      right.crossVectors(forward, camera.up).normalize();
      const speed = sprinting ? FLY_FAST : FLY_SPEED;
      dir.set(0, 0, 0);
      if (mx || mz) {
        dir.addScaledVector(forward, mz).addScaledVector(right, mx);
        const mag = Math.min(1, Math.hypot(mx, mz));
        dir.normalize().multiplyScalar(mag);
      }
      if (keys.Space) my += 1;
      if (keys.KeyC || keys.ControlLeft) my -= 1;
      my += vertical;
      camera.position.addScaledVector(dir, speed * dt);
      camera.position.y += my * speed * dt;
      const r = Math.hypot(camera.position.x, camera.position.z);
      if (r > 600) { camera.position.x *= 600 / r; camera.position.z *= 600 / r; }
      if (camera.position.y < 0.6) camera.position.y = 0.6;
      if (camera.position.y > 400) camera.position.y = 400;
      return;
    }

    // ходьба
    const speed = sprinting ? RUN_SPEED : WALK_SPEED;
    forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    right.set(Math.cos(yaw), 0, -Math.sin(yaw));
    dir.set(0, 0, 0);
    if (mx || mz) {
      dir.addScaledVector(forward, mz).addScaledVector(right, mx);
      const mag = Math.min(1, Math.hypot(mx, mz));
      dir.normalize().multiplyScalar(mag);
    }
    const moving = dir.lengthSq() > 0.0001;
    if (moving) {
      const nx = camera.position.x + dir.x * speed * dt;
      const nz = camera.position.z + dir.z * speed * dt;
      if (isValid(nx, nz)) { camera.position.x = nx; camera.position.z = nz; }
      else if (isValid(nx, camera.position.z)) camera.position.x = nx;
      else if (isValid(camera.position.x, nz)) camera.position.z = nz;
      bobPhase += dt * (sprinting ? 12.0 : 8.0);
    }

    const g = groundHeight(camera.position.x, camera.position.z);
    const bob = moving ? Math.sin(bobPhase) * (sprinting ? 0.085 : 0.045) : 0;
    const target = g + EYE_HEIGHT + bob;
    camera.position.y += (target - camera.position.y) * Math.min(1, dt * 9);

    // лёгкий крен при шаге
    const roll = moving ? Math.sin(bobPhase * 0.5) * 0.004 : 0;
    euler.setFromQuaternion(camera.quaternion, 'YXZ');
    euler.z = roll;
    camera.quaternion.setFromEuler(euler);
  }

  return {
    controls,
    update,
    get mode() { return mode; },
    get run() { return runToggle; },
    setMode,
    setMoveVector(x, y) { stick.x = x; stick.y = y; },
    setVertical(v) { vertical = v; },
    setRun(on) { runToggle = !!on; },
    look(dx, dy) { applyLook(dx, dy); },
    lock: () => controls.lock(),
    unlock: () => controls.unlock(),
    get locked() { return pointerLocked; },
  };
}
