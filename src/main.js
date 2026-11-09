import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { PALETTE, FOUNTAIN_HEIGHT } from './config.js';
import { createSky } from './sky.js';
import { createEnvironment } from './environment.js';
import { createFountain } from './fountain.js';
import { createWater } from './water.js';
import { createPlayer } from './player.js';
import { createPhysicsWorld } from './physics.js';
import { createHud } from './hud.js';
import { createAmbience } from './audio.js';
import { createTouchControls } from './touch.js';

const canvas = document.getElementById('scene');
const overlay = document.getElementById('overlay');
const startBtn = document.getElementById('start-btn');

const renderer = new THREE.WebGLRenderer({
  canvas, antialias: true, powerPreference: 'high-performance', stencil: false,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.02;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(new THREE.Color(0xd9ae86), 0.00115);

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 6000);
camera.position.set(0, 1.62, 132);
camera.rotation.set(0.19, 0, 0);
camera.layers.enable(2);   // слой 2 — поверхность воды (исключается из отражений)

// ---------- сцена ----------
const sky = createSky(scene);
const env = createEnvironment(scene);
const fountain = createFountain(scene);
const water = createWater(scene, fountain, camera, renderer);
const hud = createHud();
const audio = createAmbience();
const physics = createPhysicsWorld(scene);
const player = createPlayer(camera, canvas, physics, (mode) => {
  hud.setMode(mode);
  touch?.setFlyState(mode === 'fly');
});

const touch = createTouchControls(player, {
  fly: () => player.setMode(player.mode === 'fly' ? 'walk' : 'fly'),
  tour: () => player.setMode(player.mode === 'cinematic' ? 'walk' : 'cinematic'),
  sound: () => {
    const on = audio.toggle();
    touch.setSoundState(on);
    hud.toast(on ? 'Звук включён' : 'Звук выключен');
  },
});
if (touch) {
  touch.setSoundState(audio.enabled);
}

// ---------- постобработка ----------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight), 0.38, 0.72, 0.85
);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ---------- адаптивное качество ----------
const QUALITY = {
  high:   { pr: 1.8, bloom: true,  cube: 3,  shadow: 2048 },
  medium: { pr: 1.1, bloom: true,  cube: 6,  shadow: 1024 },
  low:    { pr: 0.7, bloom: false, cube: 14, shadow: 512 },
};
const order = ['high', 'medium', 'low'];
let quality = 'high';

const forced = new URLSearchParams(location.search).get('quality');
if (forced && QUALITY[forced]) quality = forced;
else if (touch && window.innerWidth < 900) quality = 'medium';

function applyQuality() {
  const q = QUALITY[quality];
  const pr = Math.min(window.devicePixelRatio, q.pr);
  renderer.setPixelRatio(pr);
  bloom.enabled = q.bloom;
  water.setCubeInterval(q.cube);
  env.setShadowSize(q.shadow);
  resize();
}

// ---------- ввод ----------
let started = false;
function enterScene() {
  if (started) return;
  started = true;
  overlay.classList.add('hidden');
  audio.start();
  if (!touch) {
    // Keep pointer-lock request inside the actual click gesture.
    try { player.lock(); } catch (error) { /* drag-to-look remains available */ }
  }
}
startBtn.addEventListener('click', enterScene);
canvas.addEventListener('click', (e) => {
  if (started && !player.locked && !touch && e.pointerType === 'mouse') player.lock();
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyM') {
    const on = audio.toggle();
    touch?.setSoundState(on);
    hud.toast(on ? 'Звук включён' : 'Звук выключен');
  }
  if (e.code === 'Escape') player.unlock();
});

// ---------- цикл ----------
const clock = new THREE.Clock();
let elapsed = 0;
let frames = 0;
let nightStartedMessageShown = false;
const NIGHT_START_SECONDS = 180;
const NIGHT_TRANSITION_SECONDS = 55;
const dayFog = new THREE.Color(0xd9ae86);
const nightFog = new THREE.Color(0x081326);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  const pr = Math.min(window.devicePixelRatio, QUALITY[quality].pr);
  renderer.setPixelRatio(pr);
  renderer.setSize(w, h);
  composer.setSize(w, h);
  bloom.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

// авто-понижение качества, если кадр стабильно тяжёлый
let sampleStart = 0, sampleCount = 0;
function sampleQuality(dt) {
  if (forced || quality === 'low') return;
  if (sampleStart === 0) { sampleStart = performance.now(); return; }
  sampleCount++;
  if (sampleCount < 45) return;
  const avg = (performance.now() - sampleStart) / sampleCount;
  sampleCount = 0; sampleStart = performance.now();
  if (avg > 42) {
    const i = order.indexOf(quality);
    if (i < order.length - 1) {
      quality = order[i + 1];
      applyQuality();
      hud.toast(`Качество снижено до «${quality === 'medium' ? 'среднего' : 'низкого'}» для плавности`);
    }
  }
}
applyQuality();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;
  frames++;

  renderer.shadowMap.needsUpdate = true;

  player.update(dt);

  // The park starts changing at exactly 03:00 of session time.
  const nightLinear = THREE.MathUtils.clamp(
    (elapsed - NIGHT_START_SECONDS) / NIGHT_TRANSITION_SECONDS, 0, 1
  );
  const nightProgress = nightLinear * nightLinear * (3 - 2 * nightLinear);
  sky.update(elapsed, camera, nightProgress);
  env.setTimeOfDay(nightProgress);
  env.update(elapsed, renderer.getPixelRatio());
  water.setNight(nightProgress);
  scene.fog.color.copy(dayFog).lerp(nightFog, nightProgress);
  scene.fog.density = THREE.MathUtils.lerp(0.00115, 0.00175, nightProgress);
  if (elapsed >= NIGHT_START_SECONDS && !nightStartedMessageShown) {
    nightStartedMessageShown = true;
    hud.toast('Солнце садится. Наступает ночь.');
  }
  water.update(elapsed, dt, renderer.getPixelRatio());
  hud.update(camera);
  audio.setDistance(Math.hypot(camera.position.x, camera.position.z));
  sampleQuality(dt);

  composer.render();

  if (frames === 2) {
    startBtn.disabled = false;
    startBtn.textContent = touch ? 'Начать прогулку' : 'Войти в парк';
  }
}
animate();

// для отладки из консоли
window.__scene = { scene, camera, renderer, fountain, water, player, physics, FOUNTAIN_HEIGHT };
