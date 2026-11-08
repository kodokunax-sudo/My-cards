import { CONFIG } from './config.js';
import { getDefaultAgents } from './agents.js';

const STORE_KEY = CONFIG.persistence.key;
const STORE_VERSION = CONFIG.persistence.schemaVersion;

function makeId(prefix = 'id') {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
}

export function createInitialState() {
  const agents = getDefaultAgents();
  const chat = createChatRecord('Общий разговор');

  return {
    schemaVersion: STORE_VERSION,
    updatedAt: new Date().toISOString(),
    sharedMemory: '',
    agents,
    chats: [chat],
    settings: {
      activeChatId: chat.id,
      selectedAgentId: agents[0].id,
      selectedAgentIds: agents.slice(0, 2).map(agent => agent.id),
      deviceMode: 'auto'
    }
  };
}

function isValidState(value) {
  return Boolean(
    value &&
    value.schemaVersion === STORE_VERSION &&
    Array.isArray(value.agents) &&
    value.agents.length > 0 &&
    Array.isArray(value.chats) &&
    value.chats.length > 0 &&
    value.settings &&
    typeof value.sharedMemory === 'string'
  );
}

function normalizeState(value) {
  if (!isValidState(value)) return createInitialState();

  const defaults = createInitialState();
  const knownAgentIds = new Set(value.agents.map(agent => agent.id));
  const normalizedChats = value.chats
    .filter(chat => chat && typeof chat.id === 'string' && Array.isArray(chat.messages))
    .slice(-CONFIG.persistence.maxChats)
    .map(chat => ({
      id: chat.id,
      title: String(chat.title || 'Диалог').slice(0, 80),
      createdAt: chat.createdAt || new Date().toISOString(),
      updatedAt: chat.updatedAt || chat.createdAt || new Date().toISOString(),
      messages: chat.messages
        .slice(-CONFIG.persistence.maxMessagesPerChat)
        .filter(message => message && typeof message.content === 'string' && typeof message.type === 'string')
    }));
  const chats = normalizedChats.length ? normalizedChats : [createChatRecord()];

  const hasSelectedList = Array.isArray(value.settings.selectedAgentIds);
  const selectedAgentIds = hasSelectedList
    ? value.settings.selectedAgentIds
      .filter(id => knownAgentIds.has(id))
      .slice(0, CONFIG.discussions.maxParticipants)
    : defaults.settings.selectedAgentIds.filter(id => knownAgentIds.has(id));

  const fallbackAgentId = value.agents[0].id;
  const selectedAgentId = knownAgentIds.has(value.settings.selectedAgentId)
    ? value.settings.selectedAgentId
    : fallbackAgentId;

  return {
    schemaVersion: STORE_VERSION,
    updatedAt: value.updatedAt || new Date().toISOString(),
    sharedMemory: String(value.sharedMemory || '').slice(0, CONFIG.agents.maxSharedMemoryChars),
    agents: value.agents.slice(0, CONFIG.agents.maxAgents).map(agent => ({
      id: String(agent.id),
      name: String(agent.name || 'Агент').slice(0, 32),
      avatar: String(agent.avatar || '✧').slice(0, 4),
      role: String(agent.role || 'Участник').slice(0, 64),
      style: String(agent.style || '').slice(0, 500),
      goal: String(agent.goal || '').slice(0, 500),
      memory: String(agent.memory || '').slice(0, CONFIG.agents.maxPrivateMemoryChars),
      temperature: Math.max(0.2, Math.min(1.2, Number(agent.temperature) || 0.72))
    })),
    chats,
    settings: {
      activeChatId: chats.some(chat => chat.id === value.settings.activeChatId)
        ? value.settings.activeChatId
        : chats[0].id,
      selectedAgentId,
      selectedAgentIds,
      deviceMode: ['auto', 'webgpu', 'wasm'].includes(value.settings.deviceMode)
        ? value.settings.deviceMode
        : 'auto'
    }
  };
}

export function createLocalStore() {
  return {
    load() {
      try {
        const raw = localStorage.getItem(STORE_KEY);
        if (!raw) {
          const initial = createInitialState();
          this.save(initial);
          return initial;
        }
        return normalizeState(JSON.parse(raw));
      } catch (error) {
        console.warn('Не удалось прочитать MiniBrain localStorage:', error);
        return createInitialState();
      }
    },

    save(state) {
      try {
        state.updatedAt = new Date().toISOString();
        const safeState = normalizeState(state);
        localStorage.setItem(STORE_KEY, JSON.stringify(safeState));
        return { ok: true, savedAt: new Date() };
      } catch (error) {
        console.error('Не удалось сохранить MiniBrain:', error);
        return { ok: false, error };
      }
    },

    reset() {
      try {
        localStorage.removeItem(STORE_KEY);
        return { ok: true };
      } catch (error) {
        return { ok: false, error };
      }
    },

    export(state) {
      return JSON.stringify(normalizeState(state), null, 2);
    },

    get key() {
      return STORE_KEY;
    }
  };
}

export function createChatRecord(title = 'Новый диалог') {
  const now = new Date().toISOString();
  return {
    id: makeId('chat'),
    title: String(title || 'Новый диалог').slice(0, 80),
    createdAt: now,
    updatedAt: now,
    messages: []
  };
}

export function createMessageRecord({ type, content, speakerId = null, speakerName = '', avatar = '' }) {
  return {
    id: makeId('message'),
    type,
    content: String(content || '').slice(0, 5000),
    speakerId,
    speakerName,
    avatar,
    createdAt: new Date().toISOString()
  };
}

export function createDataDownload(jsonText) {
  const blob = new Blob([jsonText], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'minibrain-neural-society-' + new Date().toISOString().slice(0, 10) + '.json';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
