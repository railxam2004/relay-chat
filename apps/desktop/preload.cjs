const {contextBridge}=require('electron');
// No filesystem, shell or arbitrary IPC bridge is exposed to message content.
contextBridge.exposeInMainWorld('relayDesktop',Object.freeze({platform:process.platform,version:'1.0.0'}));
