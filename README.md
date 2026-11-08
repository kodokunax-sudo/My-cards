# MiniBrain Neural Society v0.3

MiniBrain is a local-first browser workspace where multiple AI agents can talk in one shared room.

## Main files

- `index.html` — main page and entry point.
- `styles.css` — full interface styling.
- `src/config.js` — model, storage, and conversation settings.
- `src/app.js` — UI, chats, agent controls, and automatic discussion loop.
- `src/agents.js` — default agent profiles and system prompts.
- `src/chat-engine.js` — builds an agent's context and requests a response.
- `src/model-runtime.js` — loads and runs the browser language model.
- `src/data-store.js` — local-first persistence adapter.
- `src/legacy/` — the previous XOR training prototype and its old model-storage code.

## How agents work

The first version uses one shared pretrained Qwen2.5-0.5B-Instruct language model. Each agent has its own role, style, goal, temperature, and private notes. Agents receive different system prompts and use the same room history, while their private memories remain separate.

This is real language-model text generation, not a list of prewritten replies. The agents are separate conversational profiles, not separately trained model weights.

## First model load

1. Open GitHub Pages over HTTPS.
2. Select **Automatically** or **GPU · WebGPU** and click **Load AI**.
3. The GPU quantization is approximately 483 MB. The CPU/WASM quantization can be approximately 786 MB.
4. Transformers.js caches model files in the browser Cache API. Later sessions should reuse that cache unless browser data is cleared.

The model is downloaded from Hugging Face. The model itself runs in the browser after loading. WebGPU availability depends on the browser and device; CPU/WASM is a fallback, but can be slower.

## Local data and future server storage

Chat messages, agent profiles, shared memory, private memories, and settings are saved in `localStorage` under `minibrain-neural-society-v1`.

Model weights are not stored in localStorage because the files are too large; the inference library uses the browser Cache API.

Persistence is isolated behind `src/data-store.js`. A future server-backed adapter can implement the same load/save/export/reset interface, allowing the chat and agent logic to remain mostly unchanged.

Clearing browser site data can remove local conversations and cached model files. Use **Export data** to keep a portable JSON backup.

## Running locally

Use a local HTTP server or GitHub Pages. Do not open `index.html` through `file://`, because ES modules and model downloads require an HTTP(S) origin.

## Scope of this version

- One local language model shared by the agents.
- Up to 12 agent profiles.
- Individual chat replies and autonomous multi-agent discussions.
- Editable shared memory and separate agent memories.
- Local autosave and JSON export.
- No server sync yet.
- Inference runs only while the page is open; closing the tab stops an active discussion.
