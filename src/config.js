// Все основные параметры проекта собраны здесь.
// Меняй значения здесь, а не в app.js или brain.js.
export const CONFIG = Object.freeze({
  appName: 'MiniBrain',
  appVersion: '0.2.0',
  storageKey: 'minibrain-v2-model',
  modelFormat: 'minibrain-model',
  modelVersion: 2,
  defaultSeed: 20261107,
  inputCount: 2,
  hiddenCount: 8,
  outputCount: 1,
  defaultEpochs: 3000,
  maxEpochs: 20000,
  epochsPerFrame: 35,
  saveEveryEpochs: 100,
  defaultLearningRate: 0.03,
  minLearningRate: 0.005,
  maxLearningRate: 0.08,
  chartHistoryLimit: 600,
  cloudModelName: 'MiniBrain Main',
  supabase: {
    // Публичные значения проекта. Publishable key предназначен для браузера.
    // Никогда не помещай сюда service_role или secret key.
    url: 'https://rahzoolvfdbenyabryut.supabase.co',
    publishableKey: 'sb_publishable_cppFCgxwVk-ZvZ46NbfXHw_dGtTSVxn'
  }
});
