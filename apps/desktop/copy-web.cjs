const fs=require('node:fs');
const path=require('node:path');
module.exports=async()=>{
  const source=path.resolve(__dirname,'../web/dist');
  if(!fs.existsSync(path.join(source,'index.html')))throw new Error('Сначала выполните npm run build');
  const target=path.join(__dirname,'web');
  fs.rmSync(target,{recursive:true,force:true});fs.cpSync(source,target,{recursive:true});
};
