import { CONFIG } from './config.js';
import { createBrain, evaluateBrain, forward, isValidBrain, trainEpoch } from './brain.js';
import { downloadBrain, loadLocalBrain, readBrainFile, saveLocalBrain } from './storage.js';

const $ = id => document.getElementById(id);
const ui = {
  status: $('status'), accuracy: $('accuracy'), loss: $('loss'), epochsDone: $('epochsDone'),
  memoryStatus: $('memoryStatus'), epochs: $('epochs'), epochValue: $('epochValue'),
  learningRate: $('learningRate'), learningRateValue: $('learningRateValue'),
  train: $('trainButton'), reset: $('resetButton'), progress: $('progressBar'),
  progressText: $('progressText'), progressPercent: $('progressPercent'), chart: $('lossChart'),
  samples: $('sampleRows'), inputA: $('inputA'), inputB: $('inputB'),
  prediction: $('prediction'), confidence: $('confidence'), probabilityBar: $('probabilityBar'),
  probabilityText: $('probabilityText'), export: $('exportButton'), import: $('importButton'),
  importFile: $('importFile'), localSave: $('localSaveText'), cloudIndicator: $('cloudIndicator'),
  cloudConnect: $('cloudConnectButton'), cloudSave: $('cloudSaveButton'),
  cloudLoad: $('cloudLoadButton'), cloudStatus: $('cloudStatus')
};

let brain = loadLocalBrain() || createBrain();
let running = false;
let loopRunning = false;
let runToken = 0;
let remainingEpochs = 0;
let totalEpochs = 0;
let cloudModulePromise = null;

function setStatus(text, tone = 'mint') {
  ui.status.textContent = text;
  ui.status.style.color = tone === 'red' ? 'var(--red)' : tone === 'gold' ? 'var(--gold)' : 'var(--mint)';
}
function fmt(value) {
  return Number(value).toLocaleString('ru-RU');
}
function saveLocal(reason = 'Модель сохранена') {
  const result = saveLocalBrain(brain);
  if (result.ok) {
    ui.memoryStatus.textContent = 'Локально сохранена';
    ui.localSave.textContent = reason + ' · ' + result.savedAt.toLocaleTimeString('ru-RU');
  } else {
    ui.memoryStatus.textContent = 'Ошибка';
    ui.localSave.textContent = 'Не удалось сохранить в браузере: ' + (result.error?.message || 'недостаточно места');
  }
}
function drawChart() {
  const canvas = ui.chart;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = '#26394b';
  ctx.lineWidth = 1;
  for (let i = 1; i < 5; i++) {
    const y = h * i / 5;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
  const values = brain.lossHistory || [];
  if (values.length < 2) return;
  const max = Math.max(0.1, ...values);
  const min = Math.min(0, ...values);
  const range = Math.max(0.000001, max - min);
  ctx.beginPath();
  values.forEach((value, index) => {
    const x = 14 + (w - 28) * index / (values.length - 1);
    const y = h - 14 - (value - min) / range * (h - 28);
    if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = '#82e6c5';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
}
function renderSamples(metrics) {
  ui.samples.innerHTML = metrics.rows.map(row => {
    const state = row.correct
      ? '<span class="state-good">✓ Да</span>'
      : '<span class="state-bad">× Нет</span>';
    const answer = brain.epoch ? row.prediction + ' · ' + (row.probability * 100).toFixed(1) + '%' : '—';
    const result = brain.epoch ? state : '<span class="state-pending">Ожидает обучения</span>';
    return '<tr><td>' + row.input[0] + '</td><td>' + row.input[1] +
      '</td><td>' + row.target + '</td><td>' + answer +
      '</td><td>' + result + '</td></tr>';
  }).join('');
}
function renderPrediction() {
  const input = [Number(ui.inputA.value), Number(ui.inputB.value)];
  const probability = forward(brain, input).probability;
  const prediction = probability >= 0.5 ? 1 : 0;
  ui.prediction.textContent = brain.epoch ? String(prediction) : '—';
  ui.confidence.textContent = brain.epoch
    ? (Math.max(probability, 1 - probability) * 100).toFixed(1) + '%'
    : 'Сначала обучение';
  ui.probabilityBar.style.width = (probability * 100) + '%';
  ui.probabilityText.textContent = 'Вероятность ответа 1: ' + (probability * 100).toFixed(1) + '%';
}
function render() {
  const metrics = evaluateBrain(brain);
  ui.accuracy.textContent = Math.round(metrics.accuracy * 100) + '%';
  ui.loss.textContent = metrics.loss.toFixed(4);
  ui.epochsDone.textContent = fmt(brain.epoch);
  renderSamples(metrics);
  renderPrediction();
  drawChart();
}
function updateProgress() {
  const done = totalEpochs - remainingEpochs;
  const percent = totalEpochs ? Math.round(done / totalEpochs * 100) : 0;
  ui.progress.style.width = percent + '%';
  ui.progressPercent.textContent = percent + '%';
  ui.progressText.textContent = running
    ? 'Обучение: ' + percent + '% · осталось ' + fmt(remainingEpochs) + ' эпох'
    : remainingEpochs > 0 ? 'Пауза · осталось ' + fmt(remainingEpochs) + ' эпох' : 'Готова к обучению';
}
function updateControls() {
  ui.train.textContent = running ? 'Ⅱ Пауза' : remainingEpochs > 0 ? '▶ Продолжить' : '▶ Обучить';
  ui.reset.disabled = running;
  ui.epochs.disabled = running || remainingEpochs > 0;
  ui.learningRate.disabled = running;
  setStatus(running ? '● ОБУЧАЕТСЯ' : remainingEpochs > 0 ? '● ПАУЗА' : '● ГОТОВА');
}
async function trainingLoop(token) {
  while (running && remainingEpochs > 0 && token === runToken) {
    const count = Math.min(CONFIG.epochsPerFrame, remainingEpochs);
    const rate = Number(ui.learningRate.value);
    for (let i = 0; i < count; i++) {
      const metrics = trainEpoch(brain, rate);
      if (brain.epoch % 20 === 0) {
        brain.lossHistory.push(metrics.loss);
        if (brain.lossHistory.length > CONFIG.chartHistoryLimit) brain.lossHistory.shift();
      }
    }
    remainingEpochs -= count;
    render();
    updateProgress();
    if (brain.epoch % CONFIG.saveEveryEpochs === 0) saveLocal('Автосохранение');
    await new Promise(resolve => requestAnimationFrame(resolve));
  }
  if (token !== runToken) return;
  loopRunning = false;
  if (remainingEpochs === 0) {
    brain.lossHistory.push(evaluateBrain(brain).loss);
    saveLocal('Обучение завершено');
    ui.progress.style.width = '100%';
    ui.progressPercent.textContent = '100%';
    ui.progressText.textContent = 'Обучение завершено · точность ' + Math.round(evaluateBrain(brain).accuracy * 100) + '%';
  }
  running = false;
  updateControls();
  render();
}
function startOrPause() {
  if (running) {
    running = false;
    updateControls();
    updateProgress();
    return;
  }
  if (remainingEpochs <= 0) {
    totalEpochs = Number(ui.epochs.value);
    remainingEpochs = totalEpochs;
  }
  running = true;
  updateControls();
  updateProgress();
  if (!loopRunning) {
    loopRunning = true;
    const token = ++runToken;
    trainingLoop(token).catch(error => {
      if (token !== runToken) return;
      running = false;
      loopRunning = false;
      setStatus('● ОШИБКА', 'red');
      ui.progressText.textContent = 'Ошибка обучения: ' + error.message;
      updateControls();
      console.error(error);
    });
  }
}
function resetBrain() {
  runToken += 1;
  running = false;
  loopRunning = false;
  remainingEpochs = 0;
  totalEpochs = 0;
  brain = createBrain();
  ui.progress.style.width = '0%';
  ui.progressPercent.textContent = '0%';
  saveLocal('Новая модель создана');
  updateControls();
  updateProgress();
  render();
}
async function getCloud() {
  if (!cloudModulePromise) cloudModulePromise = import('./supabase.js');
  return cloudModulePromise;
}
function cloudMessage(error) {
  const message = String(error?.message || error || 'Неизвестная ошибка');
  if (/anonymous|sign.?in|disabled|not enabled/i.test(message)) {
    return 'Включи Anonymous Sign-Ins: Supabase → Authentication → Sign In / Providers.';
  }
  if (/Failed to fetch|NetworkError|fetch/i.test(message)) {
    return 'Нет связи с Supabase. Проверь интернет и доступность проекта.';
  }
  return message;
}
async function connectCloud() {
  ui.cloudConnect.disabled = true;
  ui.cloudStatus.textContent = 'Подключение к Supabase…';
  try {
    const cloud = await getCloud();
    const user = await cloud.connectAnonymous();
    ui.cloudIndicator.classList.add('connected');
    ui.cloudStatus.textContent = 'Подключено · ID ' + user.id.slice(0, 8) + '…';
  } catch (error) {
    ui.cloudIndicator.classList.remove('connected');
    ui.cloudStatus.textContent = cloudMessage(error);
    console.warn('Supabase connection:', error);
  } finally {
    ui.cloudConnect.disabled = false;
  }
}
async function saveCloud() {
  ui.cloudSave.disabled = true;
  ui.cloudStatus.textContent = 'Сохранение модели в облако…';
  try {
    const cloud = await getCloud();
    const metrics = evaluateBrain(brain);
    const result = await cloud.saveBrainToCloud(brain, {
      accuracy: metrics.accuracy, loss: metrics.loss, epochs: brain.epoch
    });
    ui.cloudIndicator.classList.add('connected');
    ui.cloudStatus.textContent = 'Модель сохранена в облако · ' +
      new Date(result.saved.updated_at).toLocaleString('ru-RU');
  } catch (error) {
    ui.cloudStatus.textContent = cloudMessage(error);
    console.warn('Supabase save:', error);
  } finally {
    ui.cloudSave.disabled = false;
  }
}
async function loadCloud() {
  ui.cloudLoad.disabled = true;
  ui.cloudStatus.textContent = 'Загрузка модели из облака…';
  try {
    const cloud = await getCloud();
    const record = await cloud.loadBrainFromCloud();
    if (!record) {
      ui.cloudStatus.textContent = 'В облаке пока нет сохранённой модели MiniBrain.';
      return;
    }
    if (!isValidBrain(record.weights)) throw new Error('Облачная модель имеет неподходящий формат.');
    runToken += 1;
    running = false;
    loopRunning = false;
    remainingEpochs = 0;
    brain = record.weights;
    saveLocal('Облачная модель загружена и сохранена локально');
    ui.progress.style.width = '0%';
    ui.progressPercent.textContent = '0%';
    updateControls();
    updateProgress();
    render();
    ui.cloudIndicator.classList.add('connected');
    ui.cloudStatus.textContent = 'Облачная модель загружена · ' +
      new Date(record.updated_at).toLocaleString('ru-RU');
  } catch (error) {
    ui.cloudStatus.textContent = cloudMessage(error);
    console.warn('Supabase load:', error);
  } finally {
    ui.cloudLoad.disabled = false;
  }
}
function bindEvents() {
  ui.epochs.addEventListener('input', () => { ui.epochValue.textContent = fmt(ui.epochs.value); });
  ui.learningRate.addEventListener('input', () => {
    ui.learningRateValue.textContent = Number(ui.learningRate.value).toFixed(3);
  });
  ui.train.addEventListener('click', startOrPause);
  ui.reset.addEventListener('click', resetBrain);
  ui.inputA.addEventListener('change', renderPrediction);
  ui.inputB.addEventListener('change', renderPrediction);
  ui.export.addEventListener('click', () => downloadBrain(brain));
  ui.import.addEventListener('click', () => ui.importFile.click());
  ui.importFile.addEventListener('change', async event => {
    try {
      const imported = await readBrainFile(event.target.files?.[0]);
      runToken += 1;
      running = false;
      loopRunning = false;
      remainingEpochs = 0;
      brain = imported;
      saveLocal('Модель импортирована');
      updateControls();
      updateProgress();
      render();
    } catch (error) {
      ui.localSave.textContent = 'Ошибка импорта: ' + error.message;
    } finally {
      event.target.value = '';
    }
  });
  ui.cloudConnect.addEventListener('click', connectCloud);
  ui.cloudSave.addEventListener('click', saveCloud);
  ui.cloudLoad.addEventListener('click', loadCloud);
}
function boot() {
  ui.epochs.value = String(CONFIG.defaultEpochs);
  ui.epochValue.textContent = fmt(CONFIG.defaultEpochs);
  ui.learningRate.value = String(CONFIG.defaultLearningRate);
  ui.learningRateValue.textContent = CONFIG.defaultLearningRate.toFixed(3);
  bindEvents();
  render();
  updateControls();
  updateProgress();
  ui.localSave.textContent = 'Модель сохраняется в этом браузере. Для другого устройства используй облако.';
  const warning = $('boot-warning');
  if (warning) warning.hidden = true;
  window.__MINIBRAIN_READY__ = true;
  console.info(CONFIG.appName + ' ' + CONFIG.appVersion + ': интерфейс загружен.');
}

try {
  boot();
} catch (error) {
  console.error('MiniBrain boot error:', error);
  const warning = $('boot-warning');
  if (warning) {
    warning.hidden = false;
    warning.textContent = 'MiniBrain не смог запуститься: ' + error.message +
      '. Проверь, что папка src и все модули загружены по указанным путям.';
  }
  setStatus('● ОШИБКА', 'red');
}
