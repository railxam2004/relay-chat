import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { io as client } from 'socket.io-client';
import { createApplication } from '../src/app.js';
import { createDb } from '../src/db.js';
import { getConfig } from '../src/config.js';

const general='00000000-0000-4000-8000-000000000001';
const waitEvent=(socket,event,timeout=5000)=>new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{socket.off(event,listener);reject(new Error(`Нет события ${event}`));},timeout);
  const listener=value=>{clearTimeout(timer);resolve(value);};socket.once(event,listener);
});

describe('API и WebSocket',()=>{
  let server,url,alice,bob,privateChannel,message;
  const sockets=[];
  async function api(endpoint,method='GET',body,token) {
    const response=await fetch(url+'/api'+endpoint,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
    return {status:response.status,body:response.status===204 ? null : await response.json()};
  }
  before(async()=>{
    server=await createApplication({port:0,pgliteDir:':memory:',dbDriver:process.env.TEST_DATABASE_URL?'postgres':'pglite',databaseUrl:process.env.TEST_DATABASE_URL,redisUrl:process.env.TEST_REDIS_URL||null,elasticUrl:process.env.TEST_ELASTICSEARCH_URL||null,messageRateLimit:10000});
    url=await server.listen(0);
    alice=(await api('/auth/register','POST',{username:'alice',displayName:'Алиса',password:'Password123'})).body;
    bob=(await api('/auth/register','POST',{username:'bob',displayName:'Боб',password:'Password123'})).body;
  });
  after(async()=>{for (const socket of sockets) socket.disconnect();await server.close();});
  it('создаёт аккаунты, проверяет пароль и защищает API',async()=>{
    assert.ok(alice.token);assert.equal(alice.user.password_hash,undefined);
    assert.equal((await api('/me')).status,401);
    assert.equal((await api('/auth/login','POST',{username:'alice',password:'WrongPass1'})).status,401);
    assert.equal((await api('/auth/register','POST',{username:'alice',displayName:'Алиса',password:'Password123'})).status,409);
    assert.equal((await api('/auth/login','POST',{username:'ALICE',password:'Password123'})).status,200);
    assert.equal((await api('/auth/register','POST',{username:'bad name',displayName:'Тест',password:'1'})).status,400);
  });
  it('создаёт приватный канал и не раскрывает его посторонним',async()=>{
    const result=await api('/channels','POST',{name:'Секрет',kind:'private'},alice.token);assert.equal(result.status,201);privateChannel=result.body;
    assert.equal((await api(`/channels/${privateChannel.id}/messages`,'GET',null,bob.token)).status,403);
    assert.equal((await api(`/channels/${privateChannel.id}/join`,'POST',{},bob.token)).status,403);
    assert.ok(!(await api('/channels/discover','GET',null,bob.token)).body.some(x=>x.id===privateChannel.id));
  });
  it('принимает приглашение и позволяет покинуть канал',async()=>{
    const invite=(await api(`/channels/${privateChannel.id}/invite`,'GET',null,alice.token)).body;
    assert.equal((await api('/channels/join-invite','POST',invite,bob.token)).status,200);
    assert.equal((await api(`/channels/${privateChannel.id}/invite`,'GET',null,bob.token)).status,403);
    assert.equal((await api(`/channels/${privateChannel.id}/leave`,'POST',{},alice.token)).status,409);
    assert.equal((await api(`/channels/${privateChannel.id}/leave`,'POST',{},bob.token)).status,204);
    assert.equal((await api(`/channels/${privateChannel.id}/messages`,'GET',null,bob.token)).status,403);
  });
  it('доставляет сообщение второму клиенту через WebSocket',async()=>{
    const socket=client(url,{auth:{token:bob.token},transports:['websocket'],autoConnect:false});sockets.push(socket);
    const ready=waitEvent(socket,'ready');socket.connect();await ready;
    const incoming=waitEvent(socket,'message.created');
    const sent=await api(`/channels/${general}/messages`,'POST',{body:'Привет, реальный чат!',clientId:randomUUID()},alice.token);
    assert.equal(sent.status,201);message=sent.body;
    assert.equal((await incoming).id,message.id);assert.equal(message.author.displayName,'Алиса');
  });
  it('повторяет отправку без дубликатов, включая конкурентные запросы',async()=>{
    const clientId=randomUUID();
    const sends=await Promise.all(Array.from({length:6},()=>api(`/channels/${general}/messages`,'POST',{body:'Одна запись',clientId},alice.token)));
    assert.equal(new Set(sends.map(x=>x.body.id)).size,1);
    assert.equal(sends.filter(x=>x.status===201).length,1);
  });
  it('проверяет авторство, ответы и удаление',async()=>{
    assert.equal((await api(`/messages/${message.id}`,'PATCH',{body:'Чужая правка'},bob.token)).status,403);
    assert.equal((await api(`/messages/${message.id}`,'DELETE',null,bob.token)).status,403);
    const reply=await api(`/channels/${general}/messages`,'POST',{body:'Ответ',clientId:randomUUID(),replyToId:message.id},bob.token);
    assert.equal(reply.status,201);assert.equal(reply.body.reply.body,'Привет, реальный чат!');
    assert.equal((await api(`/channels/${privateChannel.id}/messages`,'POST',{body:'Неверный ответ',clientId:randomUUID(),replyToId:message.id},alice.token)).status,400);
    const edit=await api(`/messages/${message.id}`,'PATCH',{body:'Исправленное сообщение'},alice.token);assert.equal(edit.body.body,'Исправленное сообщение');assert.ok(edit.body.editedAt);
    assert.equal((await api(`/messages/${message.id}`,'DELETE',null,alice.token)).status,204);
    const history=(await api(`/channels/${general}/messages`,'GET',null,bob.token)).body.messages;
    assert.equal(history.find(x=>x.id===message.id).body,'');
    assert.equal(history.find(x=>x.id===reply.body.id).reply.body,'Сообщение удалено');
  });
  it('возвращает историю по курсору без пропусков и дублей',async()=>{
    for(let i=0;i<7;i++) await api(`/channels/${general}/messages`,'POST',{body:`История ${i}`,clientId:randomUUID()},alice.token);
    const latest=(await api(`/channels/${general}/messages?limit=3`,'GET',null,bob.token)).body;
    assert.equal(latest.messages.length,3);assert.equal(latest.hasMore,true);
    const earlier=(await api(`/channels/${general}/messages?limit=3&before=${latest.messages[0].id}`,'GET',null,bob.token)).body;
    assert.ok(BigInt(earlier.messages.at(-1).id)<BigInt(latest.messages[0].id));
    const afterPage=(await api(`/channels/${general}/messages?limit=3&after=${earlier.messages.at(-1).id}`,'GET',null,bob.token)).body;
    assert.deepEqual(afterPage.messages.map(x=>x.id),latest.messages.map(x=>x.id));
  });
  it('считает непрочитанные и синхронизирует чтение',async()=>{
    const channels=(await api('/channels','GET',null,bob.token)).body;assert.ok(channels.find(x=>x.id===general).unread>0);
    const messages=(await api(`/channels/${general}/messages`,'GET',null,bob.token)).body.messages;
    await api(`/channels/${general}/read`,'POST',{messageId:messages.at(-1).id},bob.token);
    assert.equal((await api('/channels','GET',null,bob.token)).body.find(x=>x.id===general).unread,0);
  });
  it('ищет только сообщения своих каналов и исключает удалённые',async()=>{
    await api(`/channels/${privateChannel.id}/messages`,'POST',{body:'История секретного канала',clientId:randomUUID()},alice.token);
    const result=await api('/search?q='+encodeURIComponent('История'),'GET',null,bob.token);
    assert.equal(result.status,200);assert.ok(result.body.messages.length>=7);assert.ok(result.body.messages.every(x=>x.channelId!==privateChannel.id));
    assert.equal((await api('/search?q='+encodeURIComponent('Исправленное'),'GET',null,bob.token)).body.messages.length,0);
  });
  it('экранирует SQL-шаблоны поиска и сохраняет текст как текст',async()=>{
    const html="<script>alert('x')</script> 100% _";
    const result=await api(`/channels/${general}/messages`,'POST',{body:html,clientId:randomUUID()},alice.token);assert.equal(result.body.body,html);
    const found=await api('/search?q='+encodeURIComponent('100% _'),'GET',null,bob.token);assert.equal(found.body.messages.length,1);
  });
  it('проверяет размер/формат сообщения и параметры истории',async()=>{
    assert.equal((await api(`/channels/${general}/messages`,'POST',{body:' ',clientId:randomUUID()},alice.token)).status,400);
    assert.equal((await api(`/channels/${general}/messages`,'POST',{body:'x'.repeat(4001),clientId:randomUUID()},alice.token)).status,400);
    assert.equal((await api(`/channels/${general}/messages?limit=1000`,'GET',null,bob.token)).status,400);
  });
  it('сохраняет профиль, отзывает сессию и отключает её сокет',async()=>{
    const result=await api('/me','PATCH',{displayName:'Алиса 2',bio:'Учусь'},alice.token);assert.equal(result.body.displayName,'Алиса 2');
    const socket=client(url,{auth:{token:alice.token},transports:['websocket'],autoConnect:false});sockets.push(socket);
    const ready=waitEvent(socket,'ready');socket.connect();await ready;
    const disconnected=waitEvent(socket,'disconnect');
    assert.equal((await api('/auth/logout','POST',{},alice.token)).status,204);await disconnected;
    assert.equal((await api('/me','GET',null,alice.token)).status,401);
  });
  it('отклоняет WebSocket без авторизации',async()=>{
    const socket=client(url,{auth:{token:'invalid'},transports:['websocket'],autoConnect:false});sockets.push(socket);
    const error=waitEvent(socket,'connect_error');socket.connect();assert.equal((await error).message,'UNAUTHORIZED');socket.disconnect();
  });
});

it('сохраняет PostgreSQL-данные на диск и переживает перезапуск',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'relay-persistence-'));
  const config=getConfig({dbDriver:'pglite',pgliteDir:directory});
  try {
    const first=await createDb(config);
    await first.query("UPDATE channels SET description=$1 WHERE id=$2",['Сохранено на диск',general]);await first.close();
    const second=await createDb(config);
    assert.equal((await second.query('SELECT description FROM channels WHERE id=$1',[general])).rows[0].description,'Сохранено на диск');await second.close();
  } finally {await rm(directory,{recursive:true,force:true});}
});
