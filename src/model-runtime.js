import { CONFIG } from './config.js';
export function getModelInfo(){return {loaded:true,loading:false,device:'server',modelId:'Серверная модель'};}
export async function generateText({systemPrompt,userPrompt,temperature=0.72,maxNewTokens=CONFIG.server.maxNewTokens,onToken=()=>{}}){
 const response=await fetch(CONFIG.server.url,{method:'POST',headers:{'Content-Type':'application/json','apikey':CONFIG.server.publishableKey},body:JSON.stringify({messages:[{role:'system',content:String(systemPrompt||'')},{role:'user',content:String(userPrompt||'')}],temperature,max_tokens:maxNewTokens})});
 let data;try{data=await response.json();}catch{throw new Error('Сервер вернул некорректный ответ.');}
 if(!response.ok)throw new Error(data.error||'Ошибка серверной генерации ('+response.status+').');
 const answer=String(data.text||'').trim();if(!answer)throw new Error('Серверная модель вернула пустой ответ.');onToken(answer);return answer;
}
