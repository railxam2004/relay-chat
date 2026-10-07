import { createApplication } from './app.js';

const server=await createApplication();
await server.listen();
console.log(`Relay Chat: http://localhost:${server.config.port} (${server.config.dbDriver})`);
let stopping=false;
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,async()=>{
  if (stopping) return;stopping=true;
  await server.close();process.exit(0);
});
