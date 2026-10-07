import {io} from 'socket.io-client';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {writeFile} from 'node:fs/promises';

const args=Object.fromEntries(process.argv.slice(2).filter(x=>x.startsWith('--')).map(x=>{const [key,...value]=x.slice(2).split('=');return [key,value.join('=')||'true'];}));
const base=(args.url||'http://localhost:3001').replace(/\/$/,'');
const users=Number(args.users||10),count=Number(args.messages||100),concurrency=Number(args.concurrency||5),rate=Number(args.rate||30);
if(!Number.isInteger(users)||users<1||users>200||!Number.isInteger(count)||count<1||count>100000||!Number.isInteger(concurrency)||concurrency<1||concurrency>200||rate<1||rate>10000)throw new Error('Допустимо: users 1..200; messages 1..100000 на пользователя; concurrency 1..200; rate 1..10000');
const run=randomUUID().slice(0,8);
async function api(endpoint,method='GET',body,token){
  const response=await fetch(base+'/api'+endpoint,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
  const data=response.status===204?null:await response.json();
  if(!response.ok)throw new Error(`HTTP ${response.status}: ${data?.error||response.statusText}`);return data;
}
const clients=[];let observer;
try{
  // Sequential registration stays below the default authentication limit.
  for(let i=0;i<users;i++){
    const account=await api('/auth/register','POST',{username:`load_${run}_${i}`,displayName:`Нагрузка ${i+1}`,password:randomUUID()});clients.push(account);
    if(users>30)await new Promise(resolve=>setTimeout(resolve,1600));
  }
  const channel=await api('/channels','POST',{name:`Нагрузка ${run}`,description:'Канал создан нагрузочным тестом.',kind:'public'},clients[0].token);
  for(const account of clients.slice(1))await api(`/channels/${channel.id}/join`,'POST',{},account.token);
  const delivered=new Set();const deliveryLatencies=[];const started=new Map();
  observer=io(base,{auth:{token:clients[0].token},transports:['websocket'],autoConnect:false,reconnection:false});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('WebSocket не подключился')),15000);observer.once('ready',()=>{clearTimeout(timer);resolve();});observer.once('connect_error',error=>{clearTimeout(timer);reject(error);});observer.connect();});
  observer.on('message.created',message=>{if(message.channelId===channel.id){delivered.add(message.clientId);const start=started.get(message.clientId);if(start)deliveryLatencies.push(performance.now()-start);}});
  const total=users*count,latencies=[],failures=[],accepted=new Set();let next=0,schedule=performance.now();
  const begin=performance.now();
  async function worker(){
    while(next<total){
      const index=next++,account=clients[index%users],clientId=randomUUID();
      const slot=schedule;schedule+=1000/rate;const delay=slot-performance.now();if(delay>0)await new Promise(resolve=>setTimeout(resolve,delay));
      const start=performance.now();started.set(clientId,start);
      try{await api(`/channels/${channel.id}/messages`,'POST',{body:`Нагрузка ${run}: ${index+1}/${total}`,clientId},account.token);latencies.push(performance.now()-start);accepted.add(clientId);}
      catch(error){failures.push(error.message);}
    }
  }
  const progress=setInterval(()=>console.log(`HTTP ${accepted.size}/${total}; WebSocket ${delivered.size}; ошибок ${failures.length}`),5000);
  try{await Promise.all(Array.from({length:Math.min(concurrency,total)},worker));}finally{clearInterval(progress);}
  const sentDuration=performance.now()-begin;
  const deadline=performance.now()+10000;
  while([...accepted].some(id=>!delivered.has(id))&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,100));
  const percentile=(array,p)=>{const sorted=[...array].sort((a,b)=>a-b);return Number((sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))]||0).toFixed(2));};
  const missing=[...accepted].filter(id=>!delivered.has(id)).length;
  const result={url:base,channelId:channel.id,users,requested:total,httpAccepted:accepted.size,httpFailed:failures.length,websocketDelivered:delivered.size,missing,seconds:Number((sentDuration/1000).toFixed(2)),acceptedPerSecond:Number((accepted.size/(sentDuration/1000)).toFixed(2)),httpLatencyMs:{p50:percentile(latencies,.5),p95:percentile(latencies,.95),p99:percentile(latencies,.99)},deliveryLatencyMs:{p50:percentile(deliveryLatencies,.5),p95:percentile(deliveryLatencies,.95),p99:percentile(deliveryLatencies,.99)},firstErrors:[...new Set(failures)].slice(0,5),passed:failures.length===0&&missing===0};
  console.log(JSON.stringify(result,null,2));if(args.output)await writeFile(args.output,JSON.stringify(result,null,2)+'\n');
  if(!result.passed)process.exitCode=1;
}finally{
  observer?.disconnect();
  // Test messages intentionally remain for review; sessions do not.
  for(const account of clients)try{await api('/auth/logout','POST',{},account.token);}catch{}
}
