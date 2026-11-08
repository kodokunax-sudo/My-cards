import { CONFIG } from './config.js';

const MODEL_ID = CONFIG.languageModel.id;
const TRANSFORMERS_URL = CONFIG.languageModel.transformersUrl;

let generator = null;
let transformers = null;
let loadingPromise = null;
let activeDevice = null;

export function supportsWebGPU() {
  return typeof navigator !== 'undefined' && Boolean(navigator.gpu);
}

export function getModelInfo() {
  return {
    loaded: Boolean(generator),
    loading: Boolean(loadingPromise),
    device: activeDevice,
    modelId: MODEL_ID,
    webgpuAvailable: supportsWebGPU()
  };
}

export async function loadLanguageModel({ device = 'auto', onProgress = () => {} } = {}) {
  if (generator) return getModelInfo();
  if (loadingPromise) return loadingPromise;

  const selectedDevice = device === 'auto'
    ? (supportsWebGPU() ? 'webgpu' : 'wasm')
    : device;

  if (selectedDevice === 'webgpu' && !supportsWebGPU()) {
    throw new Error('WebGPU не обнаружен. Выбери CPU · WASM или режим «Автоматически».');
  }

  loadingPromise = (async () => {
    try {
      if (!transformers) transformers = await import(TRANSFORMERS_URL);
      const { pipeline, env } = transformers;
      env.useBrowserCache = true;
      env.cacheKey = CONFIG.languageModel.cacheKey;

      const dtype = selectedDevice === 'webgpu'
        ? CONFIG.languageModel.webgpuDtype
        : CONFIG.languageModel.wasmDtype;

      onProgress({
        status: 'initializing',
        progress: 0,
        file: 'Подготовка движка',
        device: selectedDevice
      });

      generator = await pipeline('text-generation', MODEL_ID, {
        device: selectedDevice,
        dtype,
        progress_callback: info => onProgress({ ...info, device: selectedDevice })
      });

      activeDevice = selectedDevice;
      onProgress({ status: 'ready', progress: 100, file: 'Модель готова', device: selectedDevice });
      return getModelInfo();
    } catch (error) {
      generator = null;
      activeDevice = null;
      throw error;
    } finally {
      loadingPromise = null;
    }
  })();

  return loadingPromise;
}

export async function generateText({
  systemPrompt,
  userPrompt,
  temperature = 0.72,
  maxNewTokens = CONFIG.languageModel.maxNewTokens,
  onToken = () => {}
}) {
  if (!generator) throw new Error('Сначала загрузи языковую модель.');

  const { TextStreamer } = transformers;
  const messages = [
    { role: 'system', content: String(systemPrompt || '') },
    { role: 'user', content: String(userPrompt || '') }
  ];

  const streamer = new TextStreamer(generator.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: token => onToken(token)
  });

  const output = await generator(messages, {
    max_new_tokens: Math.max(32, Math.min(220, Number(maxNewTokens) || 150)),
    do_sample: true,
    temperature: Math.max(
      CONFIG.languageModel.temperatureMin,
      Math.min(CONFIG.languageModel.temperatureMax, Number(temperature) || 0.72)
    ),
    top_p: CONFIG.languageModel.topP,
    repetition_penalty: CONFIG.languageModel.repetitionPenalty,
    streamer
  });

  const generated = output?.[0]?.generated_text;
  const text = Array.isArray(generated)
    ? generated[generated.length - 1]?.content
    : generated;

  const cleaned = String(text || '').trim();
  if (!cleaned) throw new Error('Модель вернула пустой ответ. Попробуй повторить ход.');
  return cleaned;
}
