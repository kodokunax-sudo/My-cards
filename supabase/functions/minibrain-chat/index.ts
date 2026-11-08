import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const corsHeaders={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"GET, POST, OPTIONS"};
function json(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{...corsHeaders,"Content-Type":"application/json","Cache-Control":"no-store"}});}
async function sha256(value:string){const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return Array.from(new Uint8Array(d)).map(x=>x.toString(16).padStart(2,"0")).join("").slice(0,16);}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:corsHeaders});
 const keys=JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")??"{}"),expected=keys.default;
 if(!expected||req.headers.get("apikey")!==expected)return json({error:"Unauthorized"},401);
 const base=Deno.env.get("AI_BASE_URL")?.replace(/\/+$/,""),apiKey=Deno.env.get("AI_API_KEY"),model=Deno.env.get("AI_MODEL");
 const configured=Boolean(base&&apiKey&&model);
 if(req.method==="GET")return json({ok:true,configured,provider:configured?"ready":"not_configured"});
 if(req.method!=="POST")return json({error:"Method not allowed"},405);
 if(!configured)return json({error:"Серверный ИИ ещё не настроен. Добавьте AI_BASE_URL, AI_API_KEY и AI_MODEL в секреты Supabase."},503);
 let body:any;try{body=await req.json();}catch{return json({error:"Invalid JSON"},400);}
 if(!Array.isArray(body.messages)||body.messages.length<1||body.messages.length>20)return json({error:"messages must contain 1–20 items"},400);
 const messages=body.messages.map((m:any)=>({role:["system","user","assistant"].includes(m?.role)?m.role:"user",content:String(m?.content??"").slice(0,7000)}));
 if(messages.reduce((s:number,m:any)=>s+m.content.length,0)>18000)return json({error:"Context is too large"},413);
 const temperature=Math.max(.2,Math.min(1.2,Number(body.temperature)||.72)),maxTokens=Math.max(32,Math.min(220,Number(body.max_tokens)||150));
 const ip=req.headers.get("cf-connecting-ip")||req.headers.get("x-real-ip")||req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()||"unknown";
 const hash=await sha256(ip),now=new Date(),date=now.toISOString().slice(0,10),minute=now.toISOString().slice(0,16);
 const url=Deno.env.get("SUPABASE_URL"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!service)return json({error:"Quota service unavailable"},503);
 const qr=await fetch(url+"/rest/v1/rpc/minibrain_consume_quota",{method:"POST",headers:{"Content-Type":"application/json",apikey:service,Authorization:"Bearer "+service},body:JSON.stringify({p_daily_key:"day:"+date+":"+hash,p_minute_key:"minute:"+minute+":"+hash,p_daily_limit:40,p_minute_limit:5})});
 if(!qr.ok)return json({error:"Quota service failed"},503);
 const rows=await qr.json();if(!rows?.[0]?.allowed)return json({error:"Лимит: максимум 5 запросов в минуту и 40 в день с одного IP."},429);
 let upstream:Response;try{upstream=await fetch(base+"/chat/completions",{method:"POST",headers:{Authorization:"Bearer "+apiKey,"Content-Type":"application/json"},body:JSON.stringify({model,messages,temperature,max_tokens:maxTokens,stream:false}),signal:AbortSignal.timeout(140000)});}catch{return json({error:"Не удалось связаться с сервером модели."},502);}
 const raw=await upstream.text();if(!upstream.ok)return json({error:"Провайдер ИИ вернул ошибку.",detail:raw.slice(0,500)},upstream.status>=500?502:400);
 let result:any;try{result=JSON.parse(raw);}catch{return json({error:"Некорректный ответ провайдера."},502);}
 const answer=String(result?.choices?.[0]?.message?.content??"").trim();if(!answer)return json({error:"Модель вернула пустой ответ."},502);
 return json({text:answer,model,usage:result.usage??null});
});
