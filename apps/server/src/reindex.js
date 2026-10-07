import { getConfig } from './config.js';
import { createDb } from './db.js';

const config=getConfig();
if (!config.elasticUrl) throw new Error('Укажите ELASTICSEARCH_URL');
const db=await createDb(config);
let after='0',total=0;
try {
  for (;;) {
    const {rows}=await db.query('SELECT id::text,channel_id,body,created_at,deleted_at FROM messages WHERE id>$1 ORDER BY id LIMIT 500',[after]);
    if (!rows.length) break;
    const body=rows.map(r=>r.deleted_at
      ? JSON.stringify({delete:{_index:'relay-messages-v1',_id:r.id}})+'\n'
      : JSON.stringify({index:{_index:'relay-messages-v1',_id:r.id}})+'\n'+JSON.stringify({channelId:r.channel_id,body:r.body,createdAt:r.created_at})+'\n').join('');
    const response=await fetch(`${config.elasticUrl}/_bulk`,{method:'POST',headers:{'Content-Type':'application/x-ndjson'},body,signal:AbortSignal.timeout(30000)});
    const result=await response.json();
    if (!response.ok || result.items.some(item=>{const v=Object.values(item)[0];return v.status>=400 && !(v.status===404 && item.delete);})) throw new Error('Индексирование завершилось с ошибками');
    total+=rows.length;after=rows.at(-1).id;console.log(`Обработано ${total} сообщений`);
  }
  const response=await fetch(`${config.elasticUrl}/relay-messages-v1/_refresh`,{method:'POST'});
  if (!response.ok && total) throw new Error('Не удалось обновить индекс');
} finally { await db.close(); }
