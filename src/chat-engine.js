import { CONFIG } from './config.js';
import { buildAgentSystemPrompt } from './agents.js';
import { generateText } from './model-runtime.js';

function formatHistory(messages, currentAgentId) {
  return messages.slice(-CONFIG.agents.contextMessages).map(message => {
    const speaker = message.type === 'user'
      ? 'Пользователь'
      : (message.speakerName || (message.speakerId === currentAgentId ? 'Ты' : 'Агент'));
    const content = String(message.content || '').slice(0, CONFIG.agents.maxContextMessageChars);
    return speaker + ': ' + content;
  }).join('\n\n');
}

export async function generateAgentReply({
  agent,
  messages,
  sharedMemory,
  topic = '',
  onToken = () => {}
}) {
  const systemPrompt = buildAgentSystemPrompt(agent, sharedMemory);
  const history = formatHistory(messages, agent.id);

  const userPrompt = [
    'Это общий диалог нескольких агентов.',
    topic ? 'Главная тема: ' + topic : '',
    '',
    'Последние сообщения комнаты:',
    history || 'Разговор только начинается.',
    '',
    'Сейчас твоя очередь, ' + agent.name + '. Ответь на последнюю мысль по существу.',
    'Обратись к конкретному аргументу другого участника, если это уместно.',
    'Не пересказывай историю целиком. Добавь один новый полезный шаг в обсуждение.'
  ].filter(Boolean).join('\n');

  return generateText({
    systemPrompt,
    userPrompt,
    temperature: agent.temperature,
    maxNewTokens: CONFIG.server.maxNewTokens,
    onToken
  });
}
