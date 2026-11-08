export const CONFIG = Object.freeze({
  appName:'MiniBrain Neural Society', appVersion:'0.4.0',
  persistence:Object.freeze({provider:'localStorage',key:'minibrain-neural-society-v1',schemaVersion:1,maxChats:24,maxMessagesPerChat:240}),
  server:Object.freeze({url:'https://rahzoolvfdbenyabryut.supabase.co/functions/v1/minibrain-chat',publishableKey:'sb_publishable_cppFCgxwVk-ZvZ46NbfXHw_dGtTSVxn',maxNewTokens:150}),
  agents:Object.freeze({maxAgents:12,maxPrivateMemoryChars:4000,maxSharedMemoryChars:6000,contextMessages:12,maxContextMessageChars:900}),
  discussions:Object.freeze({minParticipants:2,maxParticipants:8,minTurns:2,maxTurns:10,defaultTurns:4})
});
