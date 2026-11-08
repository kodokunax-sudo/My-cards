// Central settings for MiniBrain Neural Society.
// Persistent conversations are local-first; a server adapter can replace this later.
export const CONFIG = Object.freeze({
  appName: 'MiniBrain Neural Society',
  appVersion: '0.3.0',
  persistence: Object.freeze({
    provider: 'localStorage',
    key: 'minibrain-neural-society-v1',
    schemaVersion: 1,
    maxChats: 24,
    maxMessagesPerChat: 240
  }),
  languageModel: Object.freeze({
    id: 'onnx-community/Qwen2.5-0.5B-Instruct',
    transformersUrl: 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1',
    webgpuDtype: 'q4f16',
    wasmDtype: 'q4',
    webgpuEstimatedMB: 483,
    wasmEstimatedMB: 786,
    maxNewTokens: 150,
    temperatureMin: 0.2,
    temperatureMax: 1.2,
    topP: 0.9,
    repetitionPenalty: 1.12,
    cacheKey: 'minibrain-neural-society-qwen25-v1'
  }),
  agents: Object.freeze({
    maxAgents: 12,
    maxPrivateMemoryChars: 4000,
    maxSharedMemoryChars: 6000,
    contextMessages: 12,
    maxContextMessageChars: 900
  }),
  discussions: Object.freeze({
    minParticipants: 2,
    maxParticipants: 8,
    minTurns: 2,
    maxTurns: 10,
    defaultTurns: 4
  })
});
