import express from 'express';
import { createServer } from 'node:http';
import { randomUUID, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { createClient } from 'redis';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { z } from 'zod';
import { getConfig } from './config.js';
import { createDb } from './db.js';
import { getSession, hashPassword, verifyPassword, newSession, publicUser } from './auth.js';
import { getMessage, listChannels, isMember, messageColumns, messageJoins, publicMessage } from './models.js';
import { createSearch } from './search.js';

class HttpError extends Error { constructor(status, message) { super(message); this.status=status; } }
const uuid = z.string().uuid();
const cursor = z.string().regex(/^[0-9]{1,18}$/);
const idOf = value => uuid.parse(value);
const messageId = value => cursor.parse(value);
const credentials = z.object({ username:z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,32}$/, 'Логин: 3–32 латинских символа, цифры или _'),password:z.string().min(8,'Пароль должен содержать минимум 8 символов').max(128) });
const profile = z.object({ displayName:z.string().trim().min(1).max(64),bio:z.string().trim().max(200).default('') });
const colors = ['#2563eb','#0891b2','#7c3aed','#d97706','#059669','#db2777'];

export async function createApplication(overrides={}) {
  const config = getConfig(overrides);
  const db = await createDb(config);
  const metrics = { sent:0,duplicates:0,connections:0,searchErrors:0,startedAt:Date.now() };
  const search = createSearch(config,metrics);
  await search.init();
  const app = express();
  const http = createServer(app);
  let redis,pub,sub;
  if (config.redisUrl) {
    redis=createClient({url:config.redisUrl});
    redis.on('error',error=>console.error('Redis:',error.message));
    await redis.connect();
    pub=redis.duplicate(); sub=redis.duplicate();
    pub.on('error',error=>console.error('Redis pub:',error.message));
    sub.on('error',error=>console.error('Redis sub:',error.message));
    await Promise.all([pub.connect(),sub.connect()]);
  }
  const allowed = origin => !origin || config.origins.includes(origin);
  const io = new Server(http, {
    maxHttpBufferSize:16384,
    cors:{origin:(origin,done)=>done(null,allowed(origin)),methods:['GET','POST']},
    allowRequest:(req,done)=>done(null,allowed(req.headers.origin)),
  });
  if (pub && sub) io.adapter(createAdapter(pub,sub));
  app.disable('x-powered-by');
  // Nginx is the one trusted proxy hop in compose. Direct dev does not trust X-Forwarded-For.
  if (process.env.TRUST_PROXY === '1') app.set('trust proxy',1);
  app.use(helmet({contentSecurityPolicy:{directives:{
    defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'","'unsafe-inline'"],
    connectSrc:["'self'",'http:','https:','ws:','wss:'],imgSrc:["'self'",'data:'],
    upgradeInsecureRequests:null,
  }},strictTransportSecurity:process.env.NODE_ENV==='production' ? undefined : false}));
  app.use(cors({origin:(origin,done)=>allowed(origin) ? done(null,true) : done(new HttpError(403,'Этот адрес клиента не разрешён сервером'))}));
  app.use(express.json({limit:'32kb'}));
  function limiter(prefix,limit,windowMs,keyGenerator) {
    return rateLimit({windowMs,limit,standardHeaders:'draft-7',legacyHeaders:false,
      ...(keyGenerator ? {keyGenerator} : {}),
      ...(redis ? {store:new RedisStore({sendCommand:(...args)=>redis.sendCommand(args),prefix:`relay:rate:${prefix}:`})} : {}),
      handler:(_req,res)=>res.status(429).json({error:'Слишком много запросов. Попробуйте через несколько секунд.'}) });
  }
  const authLimiter=limiter('auth',40,60000);
  const sendLimiter=limiter('send',config.messageRateLimit,config.messageRateWindow,req=>req.user.id);
  const readLimiter=limiter('api',config.apiRateLimit,60000);
  app.use('/api',readLimiter);
  const auth = async (req,_res,next) => {
    const token=req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '';
    const session=await getSession(db,token);
    if (!session) throw new HttpError(401,'Сессия истекла. Войдите снова.');
    req.user=session; next();
  };
  const member = async req => {
    const channelId=idOf(req.params.id);
    if (!await isMember(db,channelId,req.user.id)) throw new HttpError(403,'Нет доступа к каналу');
    return channelId;
  };
  async function joined(userId,channelId) {
    io.in(`user:${userId}`).socketsJoin(`channel:${channelId}`);
    io.to(`user:${userId}`).emit('channels.changed');
    io.to(`channel:${channelId}`).emit('channel.members',{channelId});
  }

  app.get('/api/health',async (_req,res)=>{
    await db.query('SELECT 1');
    if (redis) await redis.ping();
    res.json({status:'ok',database:config.dbDriver,realtime:redis ? 'redis' : 'single-process',search:search.enabled ? 'elasticsearch+postgres' : 'postgres',version:'1.0.0'});
  });
  app.get('/api/metrics',(_req,res)=>res.json({...metrics,connections:io.engine.clientsCount,uptimeSeconds:Math.floor((Date.now()-metrics.startedAt)/1000)}));
  app.post('/api/auth/register',authLimiter,async (req,res)=>{
    const values=credentials.extend({displayName:profile.shape.displayName}).parse(req.body);
    const userId=randomUUID(), passwordHash=await hashPassword(values.password);
    const row=await db.tx(async tx=>{
      const {rows}=await tx.query('INSERT INTO users(id,username,display_name,password_hash,color) VALUES($1,$2,$3,$4,$5) RETURNING *',[userId,values.username,values.displayName,passwordHash,colors[Math.floor(Math.random()*colors.length)]]);
      await tx.query('INSERT INTO memberships(channel_id,user_id) SELECT id,$1 FROM channels WHERE owner_id IS NULL AND kind=$2 ON CONFLICT DO NOTHING',[userId,'public']);
      return rows[0];
    });
    const session=await newSession(db,userId,config.sessionDays);
    res.status(201).json({...session,user:publicUser(row)});
  });
  app.post('/api/auth/login',authLimiter,async (req,res)=>{
    const values=credentials.parse(req.body);
    const {rows}=await db.query('SELECT * FROM users WHERE username=$1',[values.username]);
    // Run the KDF for a missing username too, avoiding a fast existence oracle.
    const stored=rows[0]?.password_hash || '01234567890123456789012345678901:'+ '0'.repeat(128);
    if (!await verifyPassword(values.password,stored) || !rows[0]) throw new HttpError(401,'Неверный логин или пароль');
    res.json({...await newSession(db,rows[0].id,config.sessionDays),user:publicUser(rows[0])});
  });
  app.post('/api/auth/logout',auth,async (req,res)=>{
    await db.query('DELETE FROM sessions WHERE token_hash=$1',[req.user.token_hash]);
    io.in(`session:${req.user.token_hash}`).disconnectSockets(true);
    res.status(204).end();
  });
  app.get('/api/me',auth,(req,res)=>res.json(publicUser(req.user)));
  app.patch('/api/me',auth,async (req,res)=>{
    const values=profile.parse(req.body);
    const {rows}=await db.query('UPDATE users SET display_name=$1,bio=$2 WHERE id=$3 RETURNING *',[values.displayName,values.bio,req.user.id]);
    const user=publicUser(rows[0]); io.to('authenticated').emit('user.updated',user); res.json(user);
  });
  app.get('/api/channels',auth,async (req,res)=>res.json(await listChannels(db,req.user.id)));
  app.get('/api/channels/discover',auth,async (req,res)=>{
    const q=z.string().trim().max(64).parse(req.query.q||'');
    const {rows}=await db.query(`SELECT c.id,c.name,c.description,c.kind,(SELECT count(*)::int FROM memberships WHERE channel_id=c.id) AS "memberCount",
    EXISTS(SELECT 1 FROM memberships WHERE channel_id=c.id AND user_id=$1) AS joined
    FROM channels c WHERE c.kind='public' AND c.name ILIKE $2 ORDER BY c.created_at DESC LIMIT 100`,[req.user.id,`%${q}%`]);
    res.json(rows);
  });
  app.post('/api/channels',auth,async (req,res)=>{
    const values=z.object({name:z.string().trim().min(1).max(64),description:z.string().trim().max(240).default(''),kind:z.enum(['public','private']).default('public')}).parse(req.body);
    const channelId=randomUUID(),code=randomBytes(16).toString('hex');
    await db.tx(async tx=>{
      await tx.query('INSERT INTO channels(id,name,description,kind,owner_id,invite_code) VALUES($1,$2,$3,$4,$5,$6)',[channelId,values.name,values.description,values.kind,req.user.id,code]);
      await tx.query('INSERT INTO memberships(channel_id,user_id) VALUES($1,$2)',[channelId,req.user.id]);
    });
    await joined(req.user.id,channelId);
    res.status(201).json((await listChannels(db,req.user.id)).find(x=>x.id===channelId));
  });
  app.post('/api/channels/join-invite',auth,async (req,res)=>{
    const code=z.string().regex(/^[a-f0-9]{32}$/).parse(req.body.code);
    const {rows}=await db.query('SELECT id FROM channels WHERE invite_code=$1',[code]);
    if (!rows[0]) throw new HttpError(404,'Приглашение не найдено');
    await db.query('INSERT INTO memberships(channel_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[rows[0].id,req.user.id]);
    await joined(req.user.id,rows[0].id);
    res.json((await listChannels(db,req.user.id)).find(x=>x.id===rows[0].id));
  });
  app.post('/api/channels/:id/join',auth,async (req,res)=>{
    const channelId=idOf(req.params.id);
    const {rows}=await db.query('SELECT kind FROM channels WHERE id=$1',[channelId]);
    if (!rows[0]) throw new HttpError(404,'Канал не найден');
    if (rows[0].kind!=='public') throw new HttpError(403,'Для приватного канала нужно приглашение');
    await db.query('INSERT INTO memberships(channel_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[channelId,req.user.id]);
    await joined(req.user.id,channelId);
    res.json((await listChannels(db,req.user.id)).find(x=>x.id===channelId));
  });
  app.get('/api/channels/:id/invite',auth,async (req,res)=>{
    const channelId=await member(req);
    const {rows}=await db.query('SELECT invite_code,owner_id FROM channels WHERE id=$1',[channelId]);
    if (rows[0].owner_id && rows[0].owner_id!==req.user.id) throw new HttpError(403,'Приглашение доступно владельцу канала');
    res.json({code:rows[0].invite_code});
  });
  app.post('/api/channels/:id/leave',auth,async (req,res)=>{
    const channelId=await member(req);
    const {rows}=await db.query('SELECT owner_id FROM channels WHERE id=$1',[channelId]);
    if (rows[0].owner_id===req.user.id) throw new HttpError(409,'Владелец не может покинуть свой канал');
    await db.query('DELETE FROM memberships WHERE channel_id=$1 AND user_id=$2',[channelId,req.user.id]);
    io.in(`user:${req.user.id}`).socketsLeave(`channel:${channelId}`);
    io.to(`user:${req.user.id}`).emit('channels.changed');
    io.to(`channel:${channelId}`).emit('channel.members',{channelId});
    res.status(204).end();
  });
  app.post('/api/channels/:id/read',auth,async (req,res)=>{
    const channelId=await member(req),id=cursor.parse(req.body.messageId);
    await db.query(`UPDATE memberships SET last_read_id=GREATEST(last_read_id,LEAST($1::bigint,COALESCE((SELECT max(id) FROM messages WHERE channel_id=$2),0))) WHERE channel_id=$2 AND user_id=$3`,[id,channelId,req.user.id]);
    io.to(`user:${req.user.id}`).emit('channel.read',{channelId}); res.status(204).end();
  });
  app.get('/api/channels/:id/messages',auth,async (req,res)=>{
    const channelId=await member(req);
    const values=z.object({limit:z.coerce.number().int().min(1).max(100).default(50),before:cursor.optional(),after:cursor.optional()}).parse(req.query);
    if (values.before && values.after) throw new HttpError(400,'Укажите before или after');
    const args=[channelId]; let filter='';
    if (values.before) { args.push(values.before); filter=`AND m.id<$${args.length}`; }
    if (values.after) { args.push(values.after); filter=`AND m.id>$${args.length}`; }
    args.push(values.limit+1);
    const {rows}=await db.query(`SELECT ${messageColumns} FROM messages m ${messageJoins} WHERE m.channel_id=$1 ${filter} ORDER BY m.id ${values.after ? 'ASC' : 'DESC'} LIMIT $${args.length}`,args);
    const hasMore=rows.length>values.limit, page=rows.slice(0,values.limit);
    if (!values.after) page.reverse();
    res.json({messages:page.map(publicMessage),hasMore});
  });
  app.post('/api/channels/:id/messages',auth,sendLimiter,async (req,res)=>{
    const channelId=await member(req);
    const values=z.object({body:z.string().trim().min(1).max(4000),clientId:uuid,replyToId:cursor.nullish()}).parse(req.body);
    if (values.replyToId) {
      const {rows}=await db.query('SELECT 1 FROM messages WHERE id=$1 AND channel_id=$2',[values.replyToId,channelId]);
      if (!rows[0]) throw new HttpError(400,'Сообщение для ответа не найдено в этом канале');
    }
    const {rows}=await db.query(`INSERT INTO messages(channel_id,author_id,client_id,body,reply_to_id) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(channel_id,author_id,client_id) DO NOTHING RETURNING id::text`,[channelId,req.user.id,values.clientId,values.body,values.replyToId||null]);
    const fresh=Boolean(rows[0]);
    const id=rows[0]?.id || (await db.query('SELECT id::text FROM messages WHERE channel_id=$1 AND author_id=$2 AND client_id=$3',[channelId,req.user.id,values.clientId])).rows[0].id;
    const message=await getMessage(db,id);
    if (fresh) { metrics.sent++; io.to(`channel:${channelId}`).emit('message.created',message); search.queue(message); }
    else metrics.duplicates++;
    res.status(fresh ? 201 : 200).json(message);
  });
  app.patch('/api/messages/:id',auth,sendLimiter,async (req,res)=>{
    const id=messageId(req.params.id),values=z.object({body:z.string().trim().min(1).max(4000)}).parse(req.body);
    const {rows}=await db.query('SELECT channel_id,author_id,deleted_at FROM messages WHERE id=$1',[id]);
    if (!rows[0] || !await isMember(db,rows[0].channel_id,req.user.id)) throw new HttpError(404,'Сообщение не найдено');
    if (rows[0].author_id!==req.user.id) throw new HttpError(403,'Можно менять только свои сообщения');
    if (rows[0].deleted_at) throw new HttpError(409,'Сообщение удалено');
    await db.query('UPDATE messages SET body=$1,edited_at=now() WHERE id=$2 AND deleted_at IS NULL',[values.body,id]);
    const message=await getMessage(db,id); search.queue(message); io.to(`channel:${message.channelId}`).emit('message.updated',message); res.json(message);
  });
  app.delete('/api/messages/:id',auth,async (req,res)=>{
    const id=messageId(req.params.id);
    const {rows}=await db.query('SELECT channel_id,author_id FROM messages WHERE id=$1',[id]);
    if (!rows[0] || !await isMember(db,rows[0].channel_id,req.user.id)) throw new HttpError(404,'Сообщение не найдено');
    if (rows[0].author_id!==req.user.id) throw new HttpError(403,'Можно удалять только свои сообщения');
    await db.query('UPDATE messages SET deleted_at=COALESCE(deleted_at,now()) WHERE id=$1',[id]);
    const message=await getMessage(db,id); search.queue(message); io.to(`channel:${message.channelId}`).emit('message.updated',message); res.status(204).end();
  });
  app.get('/api/search',auth,async (req,res)=>{
    const q=z.string().trim().min(2).max(160).parse(req.query.q);
    const channelId=req.query.channelId ? idOf(req.query.channelId) : null;
    if (channelId && !await isMember(db,channelId,req.user.id)) throw new HttpError(403,'Нет доступа к каналу');
    const channels=(await db.query('SELECT channel_id FROM memberships WHERE user_id=$1',[req.user.id])).rows.map(x=>x.channel_id).filter(x=>!channelId || x===channelId);
    if (!channels.length) return res.json({messages:[],engine:'postgres'});
    const ids=await search.search(q,channels);
    let args,filter;
    if (ids) { args=[req.user.id,channels,ids]; filter='m.id=ANY($3::bigint[])'; }
    else { args=[req.user.id,channels,`%${q.replace(/[\\%_]/g,'\\$&')}%`]; filter="m.body ILIKE $3 ESCAPE '\\'"; }
    const {rows}=await db.query(`SELECT ${messageColumns} FROM messages m ${messageJoins}
      JOIN memberships ms ON ms.channel_id=m.channel_id AND ms.user_id=$1
      WHERE m.channel_id=ANY($2::uuid[]) AND m.deleted_at IS NULL AND ${filter} ORDER BY m.id DESC LIMIT 100`,args);
    res.json({messages:rows.map(publicMessage),engine:ids ? 'elasticsearch' : 'postgres'});
  });

  io.use(async (socket,next)=>{
    try {
      const session=await getSession(db,socket.handshake.auth?.token);
      if (!session) return next(new Error('UNAUTHORIZED'));
      socket.data.user=publicUser(session);socket.data.tokenHash=session.token_hash;socket.data.expiresAt=new Date(session.expires_at).getTime();next();
    } catch { next(new Error('Сервер временно недоступен')); }
  });
  io.on('connection',async socket=>{
    try {
      socket.join(['authenticated',`user:${socket.data.user.id}`,`session:${socket.data.tokenHash}`]);
      const {rows}=await db.query('SELECT channel_id FROM memberships WHERE user_id=$1',[socket.data.user.id]);
      await socket.join(rows.map(x=>`channel:${x.channel_id}`));
      socket.emit('ready');
      let lastTyping=0;
      socket.on('typing',async payload=>{
        if (Date.now()-lastTyping<700 || socket.data.expiresAt<=Date.now()) return;
        lastTyping=Date.now();
        const parsed=z.object({channelId:uuid,typing:z.boolean()}).safeParse(payload);
        if (!parsed.success) return;
        try {
          if (await isMember(db,parsed.data.channelId,socket.data.user.id)) socket.to(`channel:${parsed.data.channelId}`).emit('typing',{...parsed.data,user:socket.data.user});
        } catch { /* Transient DB errors must not become unhandled socket callbacks. */ }
      });
    } catch { socket.disconnect(true); }
  });
  const cleanup=setInterval(()=>{
    for (const socket of io.sockets.sockets.values()) if (socket.data.expiresAt<=Date.now()) socket.disconnect(true);
    db.query('DELETE FROM sessions WHERE expires_at<=now()').catch(()=>{});
  },60000);cleanup.unref();

  app.use('/api',(_req,res)=>res.status(404).json({error:'API-метод не найден'}));
  if (existsSync(path.join(config.webDir,'index.html'))) {
    app.use(express.static(config.webDir,{index:false,maxAge:3600000}));
    app.get('/{*path}',(_req,res)=>res.sendFile(path.join(config.webDir,'index.html')));
  } else app.get('/',(_req,res)=>res.json({message:'API работает. Интерфейс: npm run dev или npm run build.'}));
  app.use((error,_req,res,_next)=>{
    if (error instanceof z.ZodError) return res.status(400).json({error:error.issues[0]?.message || 'Некорректные данные'});
    if (error.code==='23505') return res.status(409).json({error:'Этот логин уже занят'});
    if (error.type==='entity.too.large') return res.status(413).json({error:'Слишком большой запрос'});
    if (error instanceof SyntaxError && error.status===400) return res.status(400).json({error:'Некорректный JSON'});
    if (error.status) return res.status(error.status).json({error:error.message});
    console.error(error);res.status(500).json({error:'Ошибка сервера. Попробуйте ещё раз.'});
  });
  return {app,http,io,db,metrics,config,async listen(port=config.port,host='0.0.0.0') {
    await new Promise((resolve,reject)=>{http.once('error',reject);http.listen(port,host,resolve);});
    return `http://127.0.0.1:${http.address().port}`;
  },async close() {
    clearInterval(cleanup);search.close();
    await new Promise(resolve=>io.close(resolve));
    await Promise.all([pub?.quit(),sub?.quit(),redis?.quit()]);
    await db.close();
  }};
}
