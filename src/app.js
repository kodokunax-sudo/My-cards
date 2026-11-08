import { CONFIG } from './config.js';
import { createAgentProfile } from './agents.js';
import { generateAgentReply } from './chat-engine.js';
import { getModelInfo } from './model-runtime.js';
import {
  createChatRecord,
  createDataDownload,
  createLocalStore,
  createMessageRecord
} from './data-store.js';

const $ = id => document.getElementById(id);
const ui = {
  modelDot: $('modelDot'), modelStatus: $('modelStatus'), modelDescription: $('modelDescription'),
  modelNotice: $('modelNotice'), loadModel: $('loadModelButton'),
  newChat: $('newChatButton'), addAgent: $('addAgentButton'), agentList: $('agentList'),
  participantHint: $('participantHint'), chatList: $('chatList'), deleteChat: $('deleteChatButton'),
  activeChatTitle: $('activeChatTitle'), chatMeta: $('chatMeta'), messages: $('messages'),
  emptyState: $('emptyState'), messageForm: $('messageForm'), replyAgent: $('replyAgent'),
  chatInput: $('chatInput'), sendButton: $('sendButton'), discussionTopic: $('discussionTopic'),
  discussionTurns: $('discussionTurns'), discussionButton: $('discussionButton'),
  stopDiscussionButton: $('stopDiscussionButton'), discussionStatus: $('discussionStatus'),
  sharedMemory: $('sharedMemory'), saveSharedMemory: $('saveSharedMemoryButton'),
  sharedMemoryStatus: $('sharedMemoryStatus'), memoryAgentSelect: $('memoryAgentSelect'),
  agentMemory: $('agentMemory'), saveAgentMemory: $('saveAgentMemoryButton'),
  agentMemoryStatus: $('agentMemoryStatus'), exportData: $('exportDataButton'),
  clearData: $('clearDataButton'), storageStatus: $('storageStatus')
};

const store = createLocalStore();
let state = store.load();
let busy = false;
let stopRequested = false;
let currentRunId = 0;
let streamingNode = null;

function activeChat() {
  return state.chats.find(chat => chat.id === state.settings.activeChatId) || state.chats[0];
}

function findAgent(id) {
  return state.agents.find(agent => agent.id === id) || state.agents[0];
}

function formatTime(value) {
  const date = new Date(value || Date.now());
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function persist(label = 'Автосохранение включено.') {
  const result = store.save(state);
  if (result.ok) {
    ui.storageStatus.textContent = label + ' · ' + result.savedAt.toLocaleTimeString('ru-RU');
  } else {
    ui.storageStatus.textContent = 'Не удалось записать данные в localStorage. Экспортируй важные диалоги.';
    console.error('MiniBrain local storage error:', result.error);
  }
}

function setModelStatus(text, ready = false, error = false) {
  ui.modelStatus.textContent = text;
  ui.modelDot.classList.toggle('ready', ready);
  ui.modelDot.style.background = error ? 'var(--red)' : '';
}

function setBusy(value, mode = '') {
  busy = value;
  ui.sendButton.disabled = value;
  ui.chatInput.disabled = value;
  ui.replyAgent.disabled = value;
  ui.newChat.disabled = value;
  ui.discussionButton.disabled = value || state.settings.selectedAgentIds.length < 2;
  ui.stopDiscussionButton.disabled = !value || mode !== 'discussion';
  ui.deleteChat.disabled = value;
  ui.addAgent.disabled = value || state.agents.length >= CONFIG.agents.maxAgents;
}

function clearStreamingNode() {
  if (streamingNode?.parentNode) streamingNode.remove();
  streamingNode = null;
}

function createElement(tag, className, text = '') {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== '') element.textContent = text;
  return element;
}

function renderAgents() {
  ui.agentList.replaceChildren();

  for (const agent of state.agents) {
    const card = createElement('div', 'agent-card' + (state.settings.selectedAgentId === agent.id ? ' active' : ''));
    const avatar = createElement('span', 'agent-avatar', agent.avatar || '✧');
    const main = createElement('div', 'agent-main');
    const select = createElement('button', 'agent-select');
    select.type = 'button';
    select.setAttribute('aria-label', 'Выбрать агента ' + agent.name);
    const name = createElement('span', 'agent-name', agent.name);
    const role = createElement('span', 'agent-role', agent.role);
    select.append(name, role);
    main.append(select);

    const actions = createElement('div', 'agent-actions');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'agent-participant';
    checkbox.checked = state.settings.selectedAgentIds.includes(agent.id);
    checkbox.title = 'Участвует в автономных обсуждениях';
    checkbox.setAttribute('aria-label', 'Добавить ' + agent.name + ' в общие обсуждения');
    actions.append(checkbox);
    card.append(avatar, main, actions);
    ui.agentList.append(card);

    select.addEventListener('click', () => {
      state.settings.selectedAgentId = agent.id;
      renderAgents();
      renderAgentSelectors();
    });

    checkbox.addEventListener('change', () => {
      const selected = new Set(state.settings.selectedAgentIds);
      if (checkbox.checked) selected.add(agent.id);
      else selected.delete(agent.id);
      state.settings.selectedAgentIds = [...selected];
      persist('Состав агентов сохранён');
      renderAgents();
      renderAgentSelectors();
      updateDiscussionAvailability();
    });
  }

  ui.participantHint.textContent = state.settings.selectedAgentIds.length < 2
    ? 'Выбери минимум двух агентов для общего разговора.'
    : 'В общем обсуждении участвуют: ' + state.settings.selectedAgentIds
      .map(id => findAgent(id).name).join(', ');
  updateDiscussionAvailability();
}

function populateSelect(select, agents, selectedId) {
  const previous = selectedId || select.value;
  select.replaceChildren();
  for (const agent of agents) {
    const option = document.createElement('option');
    option.value = agent.id;
    option.textContent = agent.name + ' · ' + agent.role;
    select.append(option);
  }
  if (agents.some(agent => agent.id === previous)) select.value = previous;
  else if (agents[0]) select.value = agents[0].id;
}

function renderAgentSelectors() {
  populateSelect(ui.replyAgent, state.agents, state.settings.selectedAgentId);
  state.settings.selectedAgentId = ui.replyAgent.value || state.settings.selectedAgentId;
  const selectedMemoryAgent = ui.memoryAgentSelect.value || state.settings.selectedAgentId;
  populateSelect(ui.memoryAgentSelect, state.agents, selectedMemoryAgent);
  renderMemoryEditor();
}

function renderMemoryEditor() {
  const agent = findAgent(ui.memoryAgentSelect.value || state.settings.selectedAgentId);
  if (!agent) return;
  if (document.activeElement !== ui.agentMemory) {
    ui.agentMemory.value = agent.memory || '';
  }
}

function renderChats() {
  ui.chatList.replaceChildren();
  for (const chat of [...state.chats].reverse()) {
    const button = createElement('button', 'chat-item' + (chat.id === state.settings.activeChatId ? ' active' : ''));
    button.type = 'button';
    const title = createElement('span', '', chat.title || 'Новый диалог');
    const count = createElement('small', '', String(chat.messages.length));
    button.append(title, count);
    button.addEventListener('click', () => {
      if (busy) return;
      state.settings.activeChatId = chat.id;
      renderChats();
      renderConversation();
      persist('Открыт диалог');
    });
    ui.chatList.append(button);
  }
}

function renderConversation() {
  const chat = activeChat();
  if (!chat) return;

  ui.activeChatTitle.textContent = chat.title || 'Новый диалог';
  ui.chatMeta.textContent = 'Сообщений: ' + chat.messages.length + ' · сохранено локально';
  ui.messages.replaceChildren();

  if (!chat.messages.length) {
    const empty = createElement('div', 'empty-state');
    const symbol = createElement('div', 'empty-symbol', '◌');
    const title = createElement('h3', '', 'Комната пока пуста');
    const copy = createElement('p', '', 'Загрузи языковую модель, напиши сообщение или задай тему для обсуждения агентов.');
    empty.append(symbol, title, copy);
    ui.messages.append(empty);
    return;
  }

  for (const message of chat.messages) {
    ui.messages.append(createMessageNode(message));
  }
  scrollMessages();
}

function createMessageNode(message) {
  const isUser = message.type === 'user';
  const node = createElement('article', 'message' + (isUser ? ' user' : ''));
  const avatar = createElement('div', 'message-avatar', isUser ? '●' : (message.avatar || '✧'));
  const body = createElement('div', 'message-body');
  const meta = createElement('div', 'message-meta');
  const name = createElement('span', 'message-name', isUser ? 'Ты' : (message.speakerName || 'Агент'));
  const time = createElement('span', '', formatTime(message.createdAt));
  meta.append(name, time);
  const bubble = createElement('div', 'message-bubble', message.content || '');
  const timestamp = createElement('div', 'message-time', isUser ? 'Сообщение пользователя' : 'Ответ агента');
  body.append(meta, bubble, timestamp);
  node.append(avatar, body);
  return node;
}

function createStreamingMessage(agent) {
  const node = createElement('article', 'message streaming');
  const avatar = createElement('div', 'message-avatar', agent.avatar || '✧');
  const body = createElement('div', 'message-body');
  const meta = createElement('div', 'message-meta');
  const name = createElement('span', 'message-name', agent.name);
  const time = createElement('span', '', 'печатает…');
  meta.append(name, time);
  const bubble = createElement('div', 'message-bubble');
  const dots = createElement('span', 'typing-indicator');
  dots.append(createElement('i'), createElement('i'), createElement('i'));
  bubble.append(dots);
  body.append(meta, bubble);
  node.append(avatar, body);
  ui.messages.append(node);
  scrollMessages();
  streamingNode = { node, bubble, time, text: '' };
  return streamingNode;
}

function scrollMessages() {
  ui.messages.scrollTop = ui.messages.scrollHeight;
}

function appendMessage(chat, message) {
  chat.messages.push(message);
  if (chat.messages.length > 240) chat.messages.splice(0, chat.messages.length - 240);
  chat.updatedAt = new Date().toISOString();

  if (message.type === 'user' && (chat.title === 'Общий разговор' || chat.title === 'Новый диалог')) {
    chat.title = message.content.replace(/\s+/g, ' ').slice(0, 38) || 'Новый диалог';
  }

  persist('Сообщение сохранено');
  if (chat.id === state.settings.activeChatId) {
    renderConversation();
    renderChats();
  }
}

function updateDiscussionAvailability() {
  ui.discussionButton.disabled = busy || state.settings.selectedAgentIds.length < 2;
  if (state.settings.selectedAgentIds.length < 2 && !busy) {
    ui.discussionStatus.textContent = 'Выбери минимум двух участников в списке агентов.';
  }
}

function ensureModelReady(){return true;}
function handleModelLoad(){
 ui.loadModel.disabled=true;setModelStatus('Серверный ИИ готов',true);
 ui.modelDescription.textContent='Генерация выполняется на сервере. Модель не скачивается на устройство.';
 ui.modelNotice.textContent='Для ответов требуется настроенный серверный провайдер.';
 ui.loadModel.disabled=false;
}

function createNewChat() {
  if (busy) return;
  const chat = createChatRecord('Новый диалог');
  state.chats.push(chat);
  if (state.chats.length > CONFIG.persistence.maxChats) state.chats.shift();
  state.settings.activeChatId = chat.id;
  persist('Создан новый диалог');
  renderChats();
  renderConversation();
  ui.chatInput.focus();
}

async function requestAgentTurn(agent, chat, topic, runId) {
  const bubble = createStreamingMessage(agent);
  let streamed = '';

  try {
    const answer = await generateAgentReply({
      agent,
      messages: chat.messages,
      sharedMemory: state.sharedMemory,
      topic,
      onToken: token => {
        if (runId !== currentRunId) return;
        streamed += token;
        if (streamingNode?.bubble) {
          streamingNode.bubble.textContent = streamed;
          streamingNode.time.textContent = 'генерация…';
          scrollMessages();
        }
      }
    });

    if (runId !== currentRunId) {
      clearStreamingNode();
      return false;
    }

    clearStreamingNode();
    const message = createMessageRecord({
      type: 'agent',
      content: answer || streamed,
      speakerId: agent.id,
      speakerName: agent.name,
      avatar: agent.avatar
    });
    appendMessage(chat, message);
    return true;
  } catch (error) {
    clearStreamingNode();
    console.error('Ошибка ответа агента:', error);
    ui.discussionStatus.textContent = 'Агент ' + agent.name + ' не смог ответить: ' + error.message;
    return false;
  }
}

async function sendUserMessage(event) {
  event.preventDefault();
  if (busy || !ensureModelReady()) return;
  const content = ui.chatInput.value.trim();
  if (!content) return;

  const agent = findAgent(ui.replyAgent.value);
  const chat = activeChat();
  ui.chatInput.value = '';

  appendMessage(chat, createMessageRecord({
    type: 'user',
    content,
    speakerName: 'Ты',
    avatar: '●'
  }));

  setBusy(true, 'single');
  const runId = ++currentRunId;
  ui.discussionStatus.textContent = agent.name + ' готовит ответ…';

  const success = await requestAgentTurn(agent, chat, content, runId);
  if (runId === currentRunId) {
    setBusy(false);
    ui.discussionStatus.textContent = success
      ? 'Ответ добавлен в историю диалога.'
      : 'Ответ не получен. Проверь модель и попробуй ещё раз.';
  }
}

async function startDiscussion() {
  if (busy || !ensureModelReady()) return;
  const selectedIds = state.settings.selectedAgentIds.filter(id => state.agents.some(agent => agent.id === id));
  if (selectedIds.length < 2) {
    ui.discussionStatus.textContent = 'Нужно выбрать минимум двух агентов.';
    return;
  }

  const chat = activeChat();
  const typedTopic = ui.discussionTopic.value.trim();
  const lastUser = [...chat.messages].reverse().find(message => message.type === 'user');
  const topic = typedTopic || lastUser?.content || '';
  if (!topic) {
    ui.discussionStatus.textContent = 'Сначала задай тему обсуждения или напиши сообщение в чат.';
    ui.discussionTopic.focus();
    return;
  }

  if (typedTopic) {
    appendMessage(chat, createMessageRecord({
      type: 'user',
      content: 'Тема для обсуждения: ' + typedTopic,
      speakerName: 'Ты',
      avatar: '●'
    }));
    ui.discussionTopic.value = '';
  }

  const turns = Math.max(CONFIG.discussions.minTurns, Math.min(CONFIG.discussions.maxTurns, Number(ui.discussionTurns.value) || CONFIG.discussions.defaultTurns));
  stopRequested = false;
  setBusy(true, 'discussion');
  ui.discussionStatus.textContent = 'Агенты начали обсуждение: ' + topic;
  const runId = ++currentRunId;

  for (let index = 0; index < turns; index += 1) {
    if (stopRequested || runId !== currentRunId) break;
    const agent = findAgent(selectedIds[index % selectedIds.length]);
    ui.discussionStatus.textContent =
      'Ход ' + (index + 1) + ' из ' + turns + ' · отвечает ' + agent.name;
    const success = await requestAgentTurn(agent, chat, topic, runId);
    if (!success) break;
  }

  if (runId === currentRunId) {
    const stopped = stopRequested;
    setBusy(false);
    ui.discussionStatus.textContent = stopped
      ? 'Обсуждение остановлено. Уже готовые реплики сохранены.'
      : 'Обсуждение завершено · ' + turns + ' ходов запланировано.';
  }
}

function stopDiscussion() {
  if (!busy) return;
  stopRequested = true;
  ui.stopDiscussionButton.disabled = true;
  ui.discussionStatus.textContent = 'Останавливаю после текущего ответа…';
}

function addAgent() {
  if (busy || state.agents.length >= 12) return;
  const name = window.prompt('Имя нового агента:');
  if (name === null) return;
  const role = window.prompt('Его роль, например «Инженер» или «Философ»:');
  if (role === null) return;
  const style = window.prompt('Характер и манера мышления:');
  if (style === null) return;
  const goal = window.prompt('Главная цель агента (можно оставить пустой):') || '';

  try {
    const agent = createAgentProfile({ name, role, style, goal });
    state.agents.push(agent);
    state.settings.selectedAgentId = agent.id;
    state.settings.selectedAgentIds = [...new Set([...state.settings.selectedAgentIds, agent.id])];
    persist('Создан агент ' + agent.name);
    renderAgents();
    renderAgentSelectors();
    ui.memoryAgentSelect.value = agent.id;
    renderMemoryEditor();
  } catch (error) {
    window.alert(error.message);
  }
}

function saveSharedMemory() {
  state.sharedMemory = ui.sharedMemory.value.slice(0, CONFIG.agents.maxSharedMemoryChars);
  persist('Общая память сохранена');
  ui.sharedMemoryStatus.textContent = 'Сохранено локально · ' + formatTime(new Date().toISOString());
}

function saveAgentMemory() {
  const agent = findAgent(ui.memoryAgentSelect.value);
  if (!agent) return;
  agent.memory = ui.agentMemory.value.slice(0, CONFIG.agents.maxPrivateMemoryChars);
  persist('Личная память ' + agent.name + ' сохранена');
  ui.agentMemoryStatus.textContent = 'Заметки агента ' + agent.name + ' сохранены локально.';
}

function deleteCurrentChat() {
  if (busy) return;
  if (!window.confirm('Удалить текущий диалог и все его сообщения?')) return;
  const chatId = state.settings.activeChatId;
  state.chats = state.chats.filter(chat => chat.id !== chatId);
  if (!state.chats.length) state.chats.push(createChatRecord());
  state.settings.activeChatId = state.chats[state.chats.length - 1].id;
  persist('Диалог удалён');
  renderChats();
  renderConversation();
}

function exportLocalData() {
  createDataDownload(store.export(state));
  ui.storageStatus.textContent = 'Экспорт текущих диалогов, агентов и памяти создан.';
}

function clearLocalData() {
  if (busy) return;
  const accepted = window.confirm(
    'Удалить всех агентов, все диалоги и локальную память MiniBrain из этого браузера?\n\n' +
    'Кеш загруженной языковой модели останется в браузере.'
  );
  if (!accepted) return;
  const result = store.reset();
  if (!result.ok) {
    ui.storageStatus.textContent = 'Не удалось очистить данные: ' + result.error.message;
    return;
  }
  state = store.load();
  renderAll();
  ui.storageStatus.textContent = 'Локальные данные очищены. Создан новый пустой набор агентов.';
}

function renderAll() {
  renderAgents();
  renderAgentSelectors();
  renderChats();
  renderConversation();
  ui.sharedMemory.value = state.sharedMemory || '';

  setModelStatus('Серверный ИИ', true);
  ui.loadModel.textContent = 'Проверить сервер';
  ui.modelDescription.textContent = 'Модель работает на сервере. Скачивать веса на устройство не нужно.';
}

function bindEvents() {
  ui.loadModel.addEventListener('click', handleModelLoad);
  ui.newChat.addEventListener('click', createNewChat);
  ui.addAgent.addEventListener('click', addAgent);
  ui.deleteChat.addEventListener('click', deleteCurrentChat);
  ui.replyAgent.addEventListener('change', () => {
    state.settings.selectedAgentId = ui.replyAgent.value;
    persist('Выбран агент для ответа');
    renderAgents();
  });
  ui.messageForm.addEventListener('submit', sendUserMessage);
  ui.chatInput.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      ui.messageForm.requestSubmit();
    }
  });
  ui.discussionButton.addEventListener('click', startDiscussion);
  ui.stopDiscussionButton.addEventListener('click', stopDiscussion);
  ui.saveSharedMemory.addEventListener('click', saveSharedMemory);
  ui.memoryAgentSelect.addEventListener('change', renderMemoryEditor);
  ui.saveAgentMemory.addEventListener('click', saveAgentMemory);
  ui.exportData.addEventListener('click', exportLocalData);
  ui.clearData.addEventListener('click', clearLocalData);
}

function boot() {
  bindEvents();
  renderAll();
  const warning = $('boot-warning');
  if (warning) warning.hidden = true;
  window.__MINIBRAIN_READY__ = true;
  console.info('MiniBrain Neural Society: локальная система диалогов загружена.');
}

try {
  boot();
} catch (error) {
  console.error('MiniBrain startup error:', error);
  const warning = $('boot-warning');
  if (warning) {
    warning.hidden = false;
    warning.textContent = 'MiniBrain не смог запуститься: ' + error.message;
  }
  setModelStatus('Ошибка запуска', false, true);
}
