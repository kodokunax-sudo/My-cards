import { CONFIG } from './config.js';
import { isValidBrain } from './brain.js';

export function loadLocalBrain() {
  try {
    const raw = localStorage.getItem(CONFIG.storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isValidBrain(parsed) ? parsed : null;
  } catch (error) {
    console.warn('Не удалось прочитать локальную модель:', error);
    return null;
  }
}

export function saveLocalBrain(model) {
  try {
    localStorage.setItem(CONFIG.storageKey, JSON.stringify(model));
    return { ok: true, savedAt: new Date() };
  } catch (error) {
    console.error('Не удалось сохранить модель:', error);
    return { ok: false, error };
  }
}

export function downloadBrain(model) {
  const content = JSON.stringify(model, null, 2);
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `minibrain-model-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function readBrainFile(file) {
  if (!file) throw new Error('Файл не выбран.');
  const text = await file.text();
  const parsed = JSON.parse(text);
  if (!isValidBrain(parsed)) {
    throw new Error('Файл не является совместимой моделью MiniBrain v2.');
  }
  return parsed;
}
