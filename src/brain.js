import { CONFIG } from './config.js';

export const TRAINING_DATA = Object.freeze([
  { input: [0, 0], target: 0 },
  { input: [0, 1], target: 1 },
  { input: [1, 0], target: 1 },
  { input: [1, 1], target: 0 }
]);

function makeRandom(seed) {
  let state = (seed >>> 0) || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

const sigmoid = value => 1 / (1 + Math.exp(-Math.max(-35, Math.min(35, value))));

function toVector(model) {
  return [
    ...model.w1.flat(),
    ...model.b1,
    ...model.w2,
    model.b2
  ];
}

function applyVector(model, vector) {
  let index = 0;
  model.w1 = Array.from({ length: model.hiddenCount }, () => [vector[index++], vector[index++]]);
  model.b1 = Array.from({ length: model.hiddenCount }, () => vector[index++]);
  model.w2 = Array.from({ length: model.hiddenCount }, () => vector[index++]);
  model.b2 = vector[index++];
}

export function createBrain(seed = CONFIG.defaultSeed) {
  const random = makeRandom(seed);
  const hiddenCount = CONFIG.hiddenCount;
  const inputScale = Math.sqrt(2 / (CONFIG.inputCount + hiddenCount));
  const outputScale = Math.sqrt(1 / hiddenCount);
  const model = {
    format: CONFIG.modelFormat,
    version: CONFIG.modelVersion,
    seed,
    epoch: 0,
    step: 0,
    inputCount: CONFIG.inputCount,
    hiddenCount,
    w1: Array.from({ length: hiddenCount }, () => [
      (random() * 2 - 1) * inputScale * 2.2,
      (random() * 2 - 1) * inputScale * 2.2
    ]),
    b1: Array(hiddenCount).fill(0),
    w2: Array.from({ length: hiddenCount }, () => (random() * 2 - 1) * outputScale * 2.2),
    b2: 0,
    adamM: [],
    adamV: [],
    lossHistory: []
  };
  const size = toVector(model).length;
  model.adamM = Array(size).fill(0);
  model.adamV = Array(size).fill(0);
  return model;
}

export function forward(model, input) {
  if (!Array.isArray(input) || input.length !== model.inputCount) {
    throw new Error('У сети ожидалось два входных значения.');
  }
  const hidden = model.w1.map((weights, index) =>
    Math.tanh(weights[0] * input[0] + weights[1] * input[1] + model.b1[index])
  );
  let logit = model.b2;
  for (let index = 0; index < model.hiddenCount; index += 1) {
    logit += hidden[index] * model.w2[index];
  }
  return { probability: sigmoid(logit), hidden };
}

export function evaluateBrain(model) {
  let loss = 0;
  let correct = 0;
  const rows = TRAINING_DATA.map(sample => {
    const probability = forward(model, sample.input).probability;
    const safeP = Math.max(1e-8, Math.min(1 - 1e-8, probability));
    loss += -(sample.target * Math.log(safeP) + (1 - sample.target) * Math.log(1 - safeP));
    const prediction = probability >= 0.5 ? 1 : 0;
    if (prediction === sample.target) correct += 1;
    return { ...sample, probability, prediction, correct: prediction === sample.target };
  });
  return { loss: loss / TRAINING_DATA.length, accuracy: correct / TRAINING_DATA.length, rows };
}

// Один шаг полно-пакетного обучения: градиенты считаются по всем четырём примерам XOR.
export function trainEpoch(model, learningRate = CONFIG.defaultLearningRate) {
  const hiddenCount = model.hiddenCount;
  const gradients = Array(hiddenCount * 2 + hiddenCount + hiddenCount + 1).fill(0);
  const oldW2 = [...model.w2];

  for (const sample of TRAINING_DATA) {
    const { probability, hidden } = forward(model, sample.input);
    const outputDelta = probability - sample.target;
    for (let unit = 0; unit < hiddenCount; unit += 1) {
      gradients[hiddenCount * 3 + unit] += outputDelta * hidden[unit];
    }

    for (let unit = 0; unit < hiddenCount; unit += 1) {
      const hiddenDelta = outputDelta * oldW2[unit] * (1 - hidden[unit] * hidden[unit]);
      gradients[unit * 2] += hiddenDelta * sample.input[0];
      gradients[unit * 2 + 1] += hiddenDelta * sample.input[1];
      gradients[hiddenCount * 2 + unit] += hiddenDelta;
    }
    gradients[gradients.length - 1] += outputDelta;
  }

  const batchSize = TRAINING_DATA.length;
  const params = toVector(model);
  model.step += 1;
  const beta1 = 0.9;
  const beta2 = 0.999;
  const epsilon = 1e-8;
  const correction1 = 1 - Math.pow(beta1, model.step);
  const correction2 = 1 - Math.pow(beta2, model.step);

  for (let index = 0; index < params.length; index += 1) {
    const gradient = gradients[index] / batchSize;
    model.adamM[index] = beta1 * model.adamM[index] + (1 - beta1) * gradient;
    model.adamV[index] = beta2 * model.adamV[index] + (1 - beta2) * gradient * gradient;
    const mHat = model.adamM[index] / correction1;
    const vHat = model.adamV[index] / correction2;
    params[index] -= learningRate * mHat / (Math.sqrt(vHat) + epsilon);
  }

  applyVector(model, params);
  model.epoch += 1;
  return evaluateBrain(model);
}

export function isValidBrain(value) {
  if (!value || value.format !== CONFIG.modelFormat || value.version !== CONFIG.modelVersion) return false;
  if (value.inputCount !== CONFIG.inputCount || value.hiddenCount !== CONFIG.hiddenCount) return false;
  if (!Number.isInteger(value.epoch) || value.epoch < 0) return false;
  if (!Array.isArray(value.w1) || value.w1.length !== CONFIG.hiddenCount) return false;
  if (!value.w1.every(row => Array.isArray(row) && row.length === 2 && row.every(Number.isFinite))) return false;
  if (!Array.isArray(value.b1) || value.b1.length !== CONFIG.hiddenCount || !value.b1.every(Number.isFinite)) return false;
  if (!Array.isArray(value.w2) || value.w2.length !== CONFIG.hiddenCount || !value.w2.every(Number.isFinite)) return false;
  if (!Number.isFinite(value.b2)) return false;
  const expectedSize = CONFIG.hiddenCount * 4 + 1;
  if (!Array.isArray(value.adamM) || value.adamM.length !== expectedSize || !value.adamM.every(Number.isFinite)) return false;
  if (!Array.isArray(value.adamV) || value.adamV.length !== expectedSize || !value.adamV.every(Number.isFinite)) return false;
  if (!Array.isArray(value.lossHistory) || !value.lossHistory.every(Number.isFinite)) return false;
  return true;
}

export function cloneBrain(model) {
  return JSON.parse(JSON.stringify(model));
}
