const {app,BrowserWindow,protocol,net,session}=require('electron');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const fs=require('node:fs');

// A stable origin preserves the session across restarts; only packaged assets are loaded.
// Classroom HTTP by IP is supported. Public deployments should use an HTTPS server.
protocol.registerSchemesAsPrivileged([{scheme:'relay',privileges:{standard:true,supportFetchAPI:true,corsEnabled:true}}]);
let window;
function createWindow(){
  window=new BrowserWindow({width:1260,height:830,minWidth:800,minHeight:600,title:'Relay Chat',backgroundColor:'#13243c',
    webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,preload:path.join(__dirname,'preload.cjs'),webSecurity:true}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith('relay://app/'))event.preventDefault();});
  window.loadURL('relay://app/index.html');
  window.setMenuBarVisibility(false);
}
app.whenReady().then(()=>{
  const web=fs.existsSync(path.join(__dirname,'web','index.html'))?path.join(__dirname,'web'):path.resolve(__dirname,'../web/dist');
  if(!fs.existsSync(path.join(web,'index.html')))throw new Error('Сначала выполните npm run build');
  session.defaultSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  protocol.handle('relay',request=>{
    const url=new URL(request.url);
    if(url.hostname!=='app')return new Response('Not found',{status:404});
    let relative;
    try{relative=decodeURIComponent(url.pathname).replace(/^\/+/, '')||'index.html';}catch{return new Response('Bad request',{status:400});}
    const target=path.resolve(web,relative);
    if(target!==web&&!target.startsWith(web+path.sep))return new Response('Forbidden',{status:403});
    if(!fs.existsSync(target)||!fs.statSync(target).isFile())return new Response('Not found',{status:404});
    return net.fetch(pathToFileURL(target).toString());
  });
  createWindow();
  app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});
});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
