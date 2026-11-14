import * as THREE from 'three';

import {
  PALETTE, FOUNTAIN_HEIGHT,
  DAY_DURATION_SECONDS, NIGHT_DURATION_SECONDS, DAY_NIGHT_CYCLE_SECONDS,
} from './config.js';
import { createSky } from './sky.js';
import { createEnvironment } from './environment.js';
import { createFountain } from './fountain.js';
import { createWater } from './water.js';
import { createPlayer } from './player.js';
import { createPhysicsWorld } from './physics.js';
import { createHud } from './hud.js';
import { createAmbience } from './audio.js';
import { createTouchControls } from './touch.js';
import { createWorld } from './world.js';
import { createOcclusionCuller } from './occlusion.js';
import { createSurvival, SAVE_KEY } from './survival.js';
import { createWildlife } from './animals.js';


window.__titanBootStatus?.('Подготавливаем графику и игровые модули...');
await new Promise((resolve) => requestAnimationFrame(() =>
  requestAnimationFrame(resolve)
));
window.__titanBootStatus?.('Создаём мир, модели, воду и физику...');


const canvas = document.getElementById('scene');
const overlay = document.getElementById('overlay');
const startBtn = document.getElementById('start-btn');

const isCoarseDevice = (navigator.maxTouchPoints || 0) > 0 ||
  ('ontouchstart' in window) ||
  (window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches);
const renderer = new THREE.WebGLRenderer({
  canvas, antialias: false,
  powerPreference: isCoarseDevice ? 'low-power' : 'high-performance',
  stencil: false,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isCoarseDevice ? 0.48 : 0.9));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.84;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(new THREE.Color(0xd9ae86), 0.00020);

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 12000);
// First-person hands and tools are attached to the camera. Add the camera to
// the scene so Three.js traverses and renders those child view models.
scene.add(camera);
camera.layers.enable(2);   // слой 2 — поверхность воды (исключается из отражений)

// ---------- сцена ----------
const sky = createSky(scene);
const env = createEnvironment(scene);
const fountain = createFountain(scene);
const water = createWater(scene, fountain, camera, renderer, { mobile: isCoarseDevice });
const world = await createWorld(
  scene,
  (message) => window.__titanBootStatus?.(message),
  { mobile: isCoarseDevice }
);
const occlusionCuller = createOcclusionCuller(renderer, scene, camera);
const hud = createHud();
const audio = createAmbience();
const physics = createPhysicsWorld(scene, world);
const SAVE_DB_NAME = 'titan-fountain-save';
const SAVE_DB_STORE = 'snapshots';

function openSaveDatabase() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB is unavailable'));
      return;
    }
    const request = window.indexedDB.open(SAVE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SAVE_DB_STORE)) {
        db.createObjectStore(SAVE_DB_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open save database'));
  });
}

async function readIndexedSave() {
  const db = await openSaveDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(SAVE_DB_STORE, 'readonly');
    const request = transaction.objectStore(SAVE_DB_STORE).get('latest');
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error('Could not read save database'));
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => { db.close(); reject(transaction.error || new Error('Save read failed')); };
    transaction.onabort = () => { db.close(); reject(transaction.error || new Error('Save read aborted')); };
  });
}

function writeIndexedSave(snapshot) {
  return openSaveDatabase().then((db) => new Promise((resolve, reject) => {
    const transaction = db.transaction(SAVE_DB_STORE, 'readwrite');
    transaction.objectStore(SAVE_DB_STORE).put(snapshot, 'latest');
    transaction.oncomplete = () => { db.close(); resolve(true); };
    transaction.onerror = () => { db.close(); reject(transaction.error || new Error('Save write failed')); };
    transaction.onabort = () => { db.close(); reject(transaction.error || new Error('Save write aborted')); };
  }));
}

function readLocalSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    return null;
  }
}

async function loadSavedGame() {
  const localSave = readLocalSave();
  try {
    const indexedSave = await readIndexedSave();
    const localTime = Number(localSave?.savedAt) || 0;
    const indexedTime = Number(indexedSave?.savedAt) || 0;
    const latest = indexedTime > localTime ? indexedSave : localSave;
    if (latest && latest === indexedSave && latest !== localSave) {
      try { localStorage.setItem(SAVE_KEY, JSON.stringify(latest)); } catch (error) { /* IndexedDB remains the primary backup. */ }
    }
    return latest;
  } catch (error) {
    return localSave;
  }
}

const previousSave = await loadSavedGame();
try { window.navigator.storage?.persist?.().catch(() => {}); } catch (error) { /* optional browser feature */ }
let elapsed = Number(previousSave?.session?.elapsed);
if (!Number.isFinite(elapsed) || elapsed < 0) elapsed = 0;

let survival = null;

const player = createPlayer(camera, canvas, physics, world, (mode) => {
  hud.setMode(mode);
  touch?.setFlyState(mode === 'fly');
}, scene);

const touch = createTouchControls(player, {
  fly: () => player.setMode(player.mode === 'fly' ? 'walk' : 'fly'),
  tour: () => player.setMode(player.mode === 'cinematic' ? 'walk' : 'cinematic'),
  sound: () => {
    const on = audio.toggle();
    touch.setSoundState(on);
    hud.toast(on ? 'Звук включён' : 'Звук выключен');
  },
  eat: () => survival?.eatSelectedFood?.(),
});
if (touch) {
  touch.setSoundState(audio.enabled);
}
if (previousSave?.session?.player) {
  player.restoreState(previousSave.session.player);
}

const wildlife = createWildlife(scene, world, camera, player, hud, {
  mobile: isCoarseDevice,
});
wildlife.restoreState(previousSave?.session?.wildlife);

window.__titanBootStatus?.('Расставляем ресурсы и готовим управление...');
await new Promise((resolve) => requestAnimationFrame(() =>
  requestAnimationFrame(resolve)
));
let saveWarningShown = false;
function notifySaveFailure() {
  if (saveWarningShown) return;
  saveWarningShown = true;
  hud.toast('Не удалось сохранить игру. Проверьте хранилище браузера.');
}

survival = createSurvival(scene, camera, canvas, world, player, hud, {
  mobile: isCoarseDevice,
  wildlife,
  initialSave: previousSave,
  onSave: writeIndexedSave,
  onSaveError: notifySaveFailure,
  getSessionState: () => ({
    elapsed,
    player: player.getSaveState(),
    wildlife: wildlife.getSaveState(),
  }),
});
if (!survival.save()) notifySaveFailure();

function saveGameBeforeExit() {
  const saved = survival.save();
  saveGraphicsSettings();
  return saved;
}
window.addEventListener('pagehide', saveGameBeforeExit);
window.addEventListener('beforeunload', saveGameBeforeExit);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveGameBeforeExit();
});

// ---------- постобработка ----------
// Phones render directly to avoid the extra full-screen composer buffers.
let composer = null;
let bloom = null;
if (!isCoarseDevice) {
  const [
    { EffectComposer },
    { RenderPass },
    { UnrealBloomPass },
    { OutputPass },
  ] = await Promise.all([
    import('three/addons/postprocessing/EffectComposer.js'),
    import('three/addons/postprocessing/RenderPass.js'),
    import('three/addons/postprocessing/UnrealBloomPass.js'),
    import('three/addons/postprocessing/OutputPass.js'),
  ]);
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight), 0.15, 0.62, 0.94
  );
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
}

// ---------- графика, дальность прорисовки и адаптивная производительность ----------
const QUALITY = {
  low: {
    pr: 0.55, bloom: false, cubeInterval: 30, cubeSize: 64,
    shadow: 512, shadows: false, reflections: false, particles: false,
  },
  medium: {
    pr: 0.72, bloom: false, cubeInterval: 20, cubeSize: 64,
    shadow: 768, shadows: true, reflections: false, particles: false,
  },
  high: {
    pr: 0.98, bloom: true, cubeInterval: 8, cubeSize: 160,
    shadow: 1536, shadows: true, reflections: true, particles: true,
  },
};
const QUALITY_ORDER = ['low', 'medium', 'high'];
const SETTINGS_KEY = 'titan-graphics-settings-v2';
const qualitySelect = document.getElementById('graphics-quality');
const viewDistanceInput = document.getElementById('view-distance');
const viewDistanceValue = document.getElementById('view-distance-value');
const shadowsInput = document.getElementById('graphics-shadows');
const reflectionsInput = document.getElementById('graphics-reflections');
const bloomInput = document.getElementById('graphics-bloom');
const graphicsStatus = document.getElementById('graphics-status');
const settingsToggle = document.getElementById('settings-toggle');
const settingsPanel = document.getElementById('settings-panel');
const resumeButton = document.getElementById('settings-resume');
const menuSoundButton = document.getElementById('menu-sound-toggle');

function detectDeviceQuality() {
  // Phones start with the lightest profile to avoid GPU/context failures
  // while the large world is being rendered for the first time.
  if (touch) return 'low';
  const memory = Number(navigator.deviceMemory || 0);
  const cores = Number(navigator.hardwareConcurrency || 0);
  if ((memory > 0 && memory <= 4) || (cores > 0 && cores <= 4)) return 'low';
  return 'medium';
}

function loadSavedSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    return null;
  }
}
const savedSettings = loadSavedSettings();
const forced = isCoarseDevice ? null : new URLSearchParams(location.search).get('quality');
let autoQuality = isCoarseDevice ? true : !QUALITY[forced];
let quality = isCoarseDevice ? 'low' : QUALITY[forced] ? forced :
  (savedSettings?.auto === false && QUALITY[savedSettings?.quality]
    ? savedSettings.quality : detectDeviceQuality());
if (!isCoarseDevice && savedSettings && savedSettings.auto === true && !forced) autoQuality = true;
else if (!isCoarseDevice && savedSettings && savedSettings.auto === false && !forced) autoQuality = false;

let drawDistance = isCoarseDevice ? 2200 : THREE.MathUtils.clamp(
  Number(savedSettings?.drawDistance) || 3200, 900, 8000
);
let graphicsOptions = {
  shadows: QUALITY[quality].shadows,
  reflections: QUALITY[quality].reflections,
  bloom: QUALITY[quality].bloom,
};
if (!isCoarseDevice && savedSettings?.options && typeof savedSettings.options === 'object') {
  graphicsOptions = {
    shadows: savedSettings.options.shadows !== false,
    reflections: savedSettings.options.reflections !== false,
    bloom: savedSettings.options.bloom === true,
  };
}

function saveGraphicsSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      quality, auto: autoQuality, drawDistance, options: graphicsOptions,
    }));
  } catch (error) {
    // Private browsing or storage limits must not prevent graphics changes.
  }
}

function updateDistanceLabel() {
  if (viewDistanceValue) {
    viewDistanceValue.value = (drawDistance / 1000).toLocaleString('ru-RU', {
      minimumFractionDigits: 1, maximumFractionDigits: 1,
    }) + ' км';
    viewDistanceValue.textContent = viewDistanceValue.value;
  }
}

function updateGraphicsStatus() {
  if (!graphicsStatus) return;
  const label = quality === 'low' ? 'Низкое' : quality === 'high' ? 'Высокое' : 'Среднее';
  graphicsStatus.textContent = autoQuality
    ? `Авто: ${label.toLowerCase()} качество. Если FPS упадёт, качество будет снижено.`
    : `Ручной режим: ${label.toLowerCase()} качество. Настройки сохраняются на этом устройстве.`;
}

function syncGraphicsControls() {
  if (qualitySelect) qualitySelect.value = autoQuality ? 'auto' : quality;
  if (viewDistanceInput) viewDistanceInput.value = String(drawDistance);
  if (shadowsInput) shadowsInput.checked = graphicsOptions.shadows;
  if (reflectionsInput) reflectionsInput.checked = graphicsOptions.reflections;
  if (bloomInput) bloomInput.checked = graphicsOptions.bloom;
  updateDistanceLabel();
  updateGraphicsStatus();
}

function applyDrawDistance() {
  camera.far = drawDistance;
  camera.updateProjectionMatrix();
  water.setDrawDistance(drawDistance);
  // The exponential fog eases into the selected far plane instead of hiding
  // the world much earlier than the slider promises.
  scene.fog.density = 0.00020 * (3200 / drawDistance);
  saveGraphicsSettings();
  updateDistanceLabel();
}

function applyQuality() {
  const profile = QUALITY[quality];
  renderer.setPixelRatio(Math.min(
    window.devicePixelRatio || 1,
    isCoarseDevice ? Math.min(profile.pr, 0.48) : profile.pr
  ));
  if (bloom) bloom.enabled = graphicsOptions.bloom;
  renderer.shadowMap.enabled = graphicsOptions.shadows;
  env.setShadowSize(profile.shadow);
  renderer.shadowMap.needsUpdate = graphicsOptions.shadows;

  water.setCubeInterval(profile.cubeInterval);
  water.setReflectionSize(profile.cubeSize);
  water.setReflectionsEnabled(graphicsOptions.reflections);
  water.setParticleEffectsEnabled(profile.particles);
  applyDrawDistance();
  resize();
  updateGraphicsStatus();
}

function chooseQuality(nextQuality, resetOptions = true) {
  if (!QUALITY[nextQuality]) return;
  quality = nextQuality;
  if (resetOptions) {
    graphicsOptions = {
      shadows: QUALITY[quality].shadows,
      reflections: QUALITY[quality].reflections,
      bloom: QUALITY[quality].bloom,
    };
  }
  syncGraphicsControls();
  applyQuality();
  saveGraphicsSettings();
}

let paused = false;

function syncMenuSoundButton() {
  if (!menuSoundButton) return;
  menuSoundButton.textContent = audio.enabled ? 'ЗВУК: ВКЛЮЧЁН' : 'ЗВУК: ВЫКЛЮЧЕН';
  menuSoundButton.setAttribute('aria-pressed', audio.enabled ? 'true' : 'false');
}

function setSettingsOpen(open) {
  if (!settingsPanel || !settingsToggle) return;
  const shouldOpen = !!open;
  settingsPanel.hidden = !shouldOpen;
  settingsPanel.classList.toggle('menu-open', shouldOpen);
  settingsToggle.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
  paused = shouldOpen && started;
  document.body.classList.toggle('paused', paused);
  if (shouldOpen) {
    player.unlock();
    survival.close();
    player.setRun(false);
    touch?.setRunState(false);
  }
  syncMenuSoundButton();
}

settingsToggle?.addEventListener('click', () => {
  setSettingsOpen(settingsPanel?.hidden !== false);
});
resumeButton?.addEventListener('click', () => setSettingsOpen(false));
menuSoundButton?.addEventListener('click', () => {
  audio.toggle();
  touch?.setSoundState(audio.enabled);
  syncMenuSoundButton();
});
syncMenuSoundButton();
qualitySelect?.addEventListener('change', () => {
  if (qualitySelect.value === 'auto') {
    autoQuality = true;
    chooseQuality(detectDeviceQuality(), true);
  } else {
    autoQuality = false;
    chooseQuality(qualitySelect.value, true);
  }
});
viewDistanceInput?.addEventListener('input', () => {
  drawDistance = THREE.MathUtils.clamp(Number(viewDistanceInput.value) || 3200, 900, 8000);
  applyDrawDistance();
});
shadowsInput?.addEventListener('change', () => {
  graphicsOptions.shadows = shadowsInput.checked;
  applyQuality();
  saveGraphicsSettings();
});
reflectionsInput?.addEventListener('change', () => {
  graphicsOptions.reflections = reflectionsInput.checked;
  applyQuality();
  saveGraphicsSettings();
});
bloomInput?.addEventListener('change', () => {
  graphicsOptions.bloom = bloomInput.checked;
  applyQuality();
  saveGraphicsSettings();
});

// The browser's own frustum culling discards chunks behind the camera.
// The far plane additionally clips terrain, trees and props beyond this radius.
camera.far = drawDistance;
if (isCoarseDevice) {
  for (const control of [qualitySelect, shadowsInput, reflectionsInput, bloomInput]) {
    if (control) control.disabled = true;
  }
}
syncGraphicsControls();
applyQuality();

// Auto quality reacts faster to sustained slow frames, but never overrides
// a manually selected Low / Medium / High profile.
let sampleStart = 0;
let sampleCount = 0;
let slowSamples = 0;
let fastSamples = 0;
function sampleQuality() {
  if (!autoQuality) return;
  if (sampleStart === 0) {
    sampleStart = performance.now();
    return;
  }
  sampleCount++;
  if (sampleCount < 75) return;
  const averageFrameMs = (performance.now() - sampleStart) / sampleCount;
  sampleCount = 0;
  sampleStart = performance.now();

  if (averageFrameMs > 31) {
    slowSamples++;
    fastSamples = 0;
  } else if (averageFrameMs < 19) {
    fastSamples++;
    slowSamples = 0;
  } else {
    slowSamples = 0;
    fastSamples = 0;
  }

  if (slowSamples >= 2) {
    const index = QUALITY_ORDER.indexOf(quality);
    if (index > 0) {
      chooseQuality(QUALITY_ORDER[index - 1], true);
      hud.toast(`Автонастройка: качество снижено до «${quality === 'low' ? 'низкого' : 'среднего'}»`);
    }
    slowSamples = 0;
  } else if (!isCoarseDevice && fastSamples >= 12 && quality !== 'high') {
    const index = QUALITY_ORDER.indexOf(quality);
    chooseQuality(QUALITY_ORDER[index + 1], true);
    hud.toast('Автонастройка: качество повышено');
    fastSamples = 0;
  }
}

// ---------- ввод ----------
let started = false;

async function requestMobileLandscape() {
  if (!touch) return;
  try {
    const root = document.documentElement;
    if (!document.fullscreenElement && typeof root.requestFullscreen === 'function') {
      await root.requestFullscreen({ navigationUI: 'hide' });
    }
  } catch (error) {
    // Fullscreen is optional; manual rotation remains available on iOS/Safari.
  }
  try {
    if (screen.orientation && typeof screen.orientation.lock === 'function') {
      await screen.orientation.lock('landscape');
    }
  } catch (error) {
    // Some browsers only allow orientation locking for installed apps.
  }
}

function enterScene() {
  if (started) return;
  started = true;
  document.body.classList.remove('menu');
  document.body.classList.add('in-game');
  overlay.classList.add('hidden');
  audio.start();
  if (touch) {
    // This call is made directly from the Start tap, as required by browsers.
    requestMobileLandscape();
  } else {
    // Keep pointer-lock request inside the actual click gesture.
    try { Promise.resolve(player.lock()).catch(() => {}); } catch (error) { /* drag-to-look remains available */ }
  }
  // Start rendering only after the player taps Start. This avoids wasting a
  // phone GPU on a hidden scene and keeps the start screen responsive.
  requestAnimationFrame(animate);
}
window.__titanStartGame = enterScene;
canvas.addEventListener('click', (e) => {
  if (started && !paused && !player.locked && !touch && e.pointerType === 'mouse') {
    try { Promise.resolve(player.lock()).catch(() => {}); } catch (error) { /* drag-to-look remains available */ }
  }
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyM') {
    const on = audio.toggle();
    touch?.setSoundState(on);
    syncMenuSoundButton();
    hud.toast(on ? 'Звук включён' : 'Звук выключен');
  }
  if (e.code === 'Escape' && started) {
    if (settingsPanel && !settingsPanel.hidden) setSettingsOpen(false);
    else setSettingsOpen(true);
    player.unlock();
  }
  if ((e.code === 'KeyO' || e.code === 'KeyP') && !e.repeat) {
    setSettingsOpen(settingsPanel?.hidden !== false);
  }
});

// ---------- цикл ----------
let lastFrameTime = performance.now();
let saveAccumulator = 0;
let previousDayPhase = 0;
const NIGHT_TRANSITION_SECONDS = 55;
previousDayPhase = elapsed % DAY_NIGHT_CYCLE_SECONDS;
const DUSK_START_SECONDS = DAY_DURATION_SECONDS - NIGHT_TRANSITION_SECONDS;
const DAWN_START_SECONDS = DAY_NIGHT_CYCLE_SECONDS - NIGHT_TRANSITION_SECONDS;
const dayFog = new THREE.Color(0xd9ae86);
const nightFog = new THREE.Color(0x081326);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  const pr = Math.min(
    window.devicePixelRatio || 1,
    isCoarseDevice ? Math.min(QUALITY[quality].pr, 0.48) : QUALITY[quality].pr
  );
  renderer.setPixelRatio(pr);
  renderer.setSize(w, h);
  composer?.setSize(w, h);
  bloom?.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => {
  window.setTimeout(resize, 120);
});
document.addEventListener('fullscreenchange', resize);

function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const realDt = Math.max(0, Math.min((now - lastFrameTime) / 1000, 6 * 60 * 60));
  lastFrameTime = now;
  const dt = Math.min(realDt, 0.05);

  if (paused) {
    try {
      if (composer) composer.render();
      else renderer.render(scene, camera);
    } finally {
      occlusionCuller.restore();
    }
    return;
  }

  elapsed += realDt;
  player.update(dt);
  wildlife.update(dt);
  const backgroundCatchup = Math.max(0, realDt - dt);
  if (backgroundCatchup > 0) {
    player.advanceBackground?.(backgroundCatchup);
    wildlife.advanceBackground?.(backgroundCatchup);
    survival.advanceBackground?.(backgroundCatchup);
  }
  survival.update(dt);
  saveAccumulator += realDt;
  if (saveAccumulator >= 8) {
    saveAccumulator %= 8;
    if (!survival.save()) notifySaveFailure();
  }
  touch?.setSwimState(player.swimming);
  if (player.consumeDrownedEvent()) {
    hud.toast('Вы утонули: закончился кислород. Вы вернулись к стартовому дому.');
  }

  // A full cycle lasts 24 minutes: 14 minutes of day, then 10 minutes
  // of night. Dusk and dawn are blended into the final 55 seconds of each
  // period, so the cycle still keeps the exact requested duration.
  const dayPhase = elapsed % DAY_NIGHT_CYCLE_SECONDS;
  let nightLinear = 0;
  if (dayPhase >= DUSK_START_SECONDS && dayPhase < DAY_DURATION_SECONDS) {
    const t = THREE.MathUtils.clamp(
      (dayPhase - DUSK_START_SECONDS) / NIGHT_TRANSITION_SECONDS, 0, 1
    );
    nightLinear = t * t * (3 - 2 * t);
  } else if (dayPhase >= DAY_DURATION_SECONDS && dayPhase < DAWN_START_SECONDS) {
    nightLinear = 1;
  } else if (dayPhase >= DAWN_START_SECONDS) {
    const t = THREE.MathUtils.clamp(
      (dayPhase - DAWN_START_SECONDS) / NIGHT_TRANSITION_SECONDS, 0, 1
    );
    const dawn = t * t * (3 - 2 * t);
    nightLinear = 1 - dawn;
  }
  const nightProgress = nightLinear;
  hud.setWorldClock(dayPhase, nightLinear >= 0.5);

  if (dayPhase < previousDayPhase) {
    hud.toast('Наступило утро. Начинается новый день.');
  } else if (dayPhase >= DAY_DURATION_SECONDS && previousDayPhase < DAY_DURATION_SECONDS) {
    hud.toast('Наступила ночь. До рассвета 10 минут.');
  }
  previousDayPhase = dayPhase;
  sky.update(elapsed, camera, nightProgress, dayPhase);
  env.setTimeOfDay(nightProgress, dayPhase);
  if (env.update(elapsed, renderer.getPixelRatio(), camera.position)) {
    renderer.shadowMap.needsUpdate = true;
  }
  const streamProgress = world.update(elapsed, camera.position);
  const worldLoading = document.getElementById('world-loading');
  if (worldLoading && streamProgress) {
    if (streamProgress.pending > 0) {
      worldLoading.textContent = 'Подгружаем ближайшую область…';
      worldLoading.classList.add('active');
    } else {
      worldLoading.classList.remove('active');
    }
  }
  water.setNight(nightProgress);
  if (player.underwater) {
    scene.fog.color.set(0x063248);
    scene.fog.density = 0.055;
  } else {
    scene.fog.color.copy(dayFog).lerp(nightFog, nightProgress);
    scene.fog.density = THREE.MathUtils.lerp(
      0.00020 * (3200 / drawDistance), 0.00038 * (3200 / drawDistance), nightProgress
    );
  }
  const fountainRegion = world.getWaterRegionAt(camera.position.x, camera.position.z);
  const beneathFountainSurface = fountainRegion?.id === 'fountain' && player.underwater;
  water.update(elapsed, dt, renderer.getPixelRatio(), beneathFountainSurface);
  hud.update(camera, player);
  audio.setDistance(Math.hypot(camera.position.x, camera.position.z));
  sampleQuality();

  try {
    if (started) occlusionCuller.update(quality);
    if (composer) composer.render();
    else renderer.render(scene, camera);
  } finally {
    // Reflection rendering has already completed above. Restore the chunks
    // immediately after the main camera so other camera passes see the world.
    occlusionCuller.restore();
  }

}
startBtn.disabled = false;
startBtn.textContent = touch ? 'Начать прогулку' : 'Войти в парк';

// для отладки из консоли
window.__scene = {
  scene, camera, renderer, fountain, water, world, player, physics,
  occlusionCuller, survival, wildlife, FOUNTAIN_HEIGHT,
};
