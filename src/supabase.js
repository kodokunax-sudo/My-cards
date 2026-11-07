import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0/+esm';
import { CONFIG } from './config.js';

let client = null;

function getClient() {
  if (client) return client;
  const { url, publishableKey } = CONFIG.supabase;
  if (!url || !publishableKey) {
    throw new Error('В src/config.js не заполнены настройки Supabase.');
  }
  if (publishableKey.startsWith('sb_secret_') || publishableKey.includes('service_role')) {
    throw new Error('Нельзя использовать secret/service_role key в браузере. Нужен publishable key.');
  }
  client = createClient(url, publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  return client;
}

export async function connectAnonymous() {
  const supabase = getClient();
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (sessionData.session?.user) return sessionData.session.user;

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  if (!data.user) throw new Error('Supabase не вернул пользователя.');
  return data.user;
}

export async function saveBrainToCloud(model, metrics) {
  const supabase = getClient();
  const user = await connectAnonymous();
  const row = {
    owner_id: user.id,
    model_name: CONFIG.cloudModelName,
    architecture: {
      type: 'multilayer-perceptron',
      inputCount: model.inputCount,
      hiddenCount: model.hiddenCount,
      outputCount: 1,
      hiddenActivation: 'tanh',
      outputActivation: 'sigmoid',
      optimizer: 'adam'
    },
    weights: model,
    metrics,
    updated_at: new Date().toISOString()
  };
  const { data, error } = await supabase
    .from('ai_models')
    .upsert(row, { onConflict: 'owner_id,model_name' })
    .select('id,updated_at')
    .single();
  if (error) throw error;
  return { user, saved: data };
}

export async function loadBrainFromCloud() {
  const supabase = getClient();
  const user = await connectAnonymous();
  const { data, error } = await supabase
    .from('ai_models')
    .select('weights,metrics,updated_at')
    .eq('owner_id', user.id)
    .eq('model_name', CONFIG.cloudModelName)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return data;
}
