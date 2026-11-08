# MiniBrain Neural Society v0.4

MiniBrain is a server-first multi-agent chat interface. The browser stores conversations, agent profiles, and memories locally. Text generation is sent to a Supabase Edge Function, which forwards requests to a configured OpenAI-compatible model API.

## Architecture
- GitHub Pages serves the frontend.
- Supabase Edge Function `minibrain-chat` is the gateway.
- The model provider performs inference. Model weights are not downloaded by visitors.
- `localStorage` stores chats, agent profiles, shared memory, and private memories.
- Supabase Postgres stores per-IP request quota buckets only.

## Configure provider
Set these secrets in Supabase Dashboard → Edge Functions → Secrets:
- `AI_BASE_URL`: OpenAI-compatible API base URL (include `/v1` if required; omit `/chat/completions`).
- `AI_API_KEY`: provider API key.
- `AI_MODEL`: exact model identifier accepted by the provider.

The Edge Function is deployed but returns HTTP 503 until all three secrets are configured. Never put provider secrets in GitHub or browser code. Supabase Edge Functions do not host the Qwen weights themselves.

## Limits
The gateway enforces up to 5 requests/minute and 40/day per IP. It caps context size and output tokens. Limits are conservative beta defaults.

## Agents and storage
Искра, Сова, and Вектор share one configured model but use distinct prompts, goals, temperatures, and private memories. Chats, agents, shared memory, and private memories remain in localStorage. Use Export data for a backup.
