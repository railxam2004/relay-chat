// PostgreSQL remains authoritative. Elasticsearch is a rebuildable search index.
// Failures never prevent a committed message from reaching the channel.
export function createSearch(config, metrics) {
  const base = config.elasticUrl?.replace(/\/$/, '');
  const index = 'relay-messages-v1';
  const pending = new Map();
  let running = false;
  async function request(endpoint, options = {}) {
    const response = await fetch(`${base}/${endpoint}`, { ...options, headers: { 'Content-Type':'application/json', ...options.headers }, signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`Elasticsearch: HTTP ${response.status}`);
    return response.json();
  }
  async function init() {
    if (!base) return;
    try {
      const response = await fetch(`${base}/${index}`, { signal:AbortSignal.timeout(5000) });
      if (response.status === 404) await request(index, { method:'PUT', body:JSON.stringify({ mappings:{ properties:{ body:{type:'text'},channelId:{type:'keyword'},createdAt:{type:'date'} } } }) });
      else if (!response.ok) throw new Error(`Elasticsearch: HTTP ${response.status}`);
    } catch (error) { metrics.searchErrors++; console.warn('Поиск использует PostgreSQL:', error.message); }
  }
  async function flush() {
    if (!base || running || !pending.size) return;
    running = true;
    try {
      for (const [id,item] of [...pending].slice(0,200)) {
        if (item.deletedAt) {
          const response = await fetch(`${base}/${index}/_doc/${id}`, { method:'DELETE', signal:AbortSignal.timeout(5000) });
          if (!response.ok && response.status!==404) throw new Error(`Elasticsearch: HTTP ${response.status}`);
        } else await request(`${index}/_doc/${id}`, { method:'PUT',body:JSON.stringify({body:item.body,channelId:item.channelId,createdAt:item.createdAt}) });
        if (pending.get(id) === item) pending.delete(id);
      }
    } catch { metrics.searchErrors++; }
    finally { running = false; }
  }
  const timer = base ? setInterval(flush, 1500) : null;
  timer?.unref();
  return {
    init,
    queue(message) { if (base) { if (pending.size>20000) { metrics.searchErrors++; return; } pending.set(message.id,message); } },
    async search(query,channelIds) {
      if (!base || pending.size) return null;
      try {
        const result = await request(`${index}/_search`,{method:'POST',body:JSON.stringify({ size:100, query:{bool:{must:[{match_phrase_prefix:{body:query}}],filter:[{terms:{channelId:channelIds}}]}},sort:[{createdAt:'desc'}] })});
        // An empty/stale index can occur after downtime. SQL is the fallback.
        return result.hits.hits.length ? result.hits.hits.map(x=>x._id) : null;
      } catch { metrics.searchErrors++; return null; }
    },
    close() { if (timer) clearInterval(timer); },
    enabled: Boolean(base),
  };
}
