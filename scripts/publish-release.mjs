import {readdir,readFile,writeFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {basename,join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

const root=resolve(process.env.RELEASE_ASSET_DIR||'release/assets');
const repo=process.env.GITHUB_REPOSITORY;
const target=process.env.GITHUB_SHA;
const version=JSON.parse(await readFile('package.json','utf8')).version;
const tag=process.env.GITHUB_REF_TYPE==='tag'?process.env.GITHUB_REF_NAME:`v${version}`;
const dryRun=process.argv.includes('--dry-run');
if(!/^[\w.-]+\/[\w.-]+$/.test(repo||'')||!/^[a-f0-9]{40}$/.test(target||'')||!/^v\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(tag||''))throw new Error('Invalid release repository, commit or version');

async function walk(dir){
  const paths=[];
  for(const item of await readdir(dir,{withFileTypes:true})){
    const path=join(dir,item.name);
    if(item.isDirectory())paths.push(...await walk(path));
    else if(item.isFile()&&/\.(apk|exe|appimage|deb|dmg|zip)$/i.test(item.name))paths.push(path);
  }
  return paths;
}
const files=(await walk(root)).sort((a,b)=>basename(a).localeCompare(basename(b)));
if(!files.length)throw new Error('No application files to publish');
if(new Set(files.map(path=>basename(path))).size!==files.length)throw new Error('Release asset names must be unique');
const digests=new Map();
for(const path of files){
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(path))hash.update(chunk);
  digests.set(basename(path),hash.digest('hex'));
}
const checksumPath=join(root,'Relay-Chat-SHA256SUMS.txt');
await writeFile(checksumPath,files.map(path=>`${digests.get(basename(path))}  ${basename(path)}`).join('\n')+'\n');
digests.set(basename(checksumPath),createHash('sha256').update(await readFile(checksumPath)).digest('hex'));
files.push(checksumPath);
if(dryRun){console.log(JSON.stringify({repo,target,tag,assets:files.map(path=>({name:basename(path),sha256:digests.get(basename(path))}))},null,2));process.exit(0);}

function gh(args,allowFailure=false){
  const result=spawnSync('gh',args,{encoding:'utf8'});
  if(result.error)throw result.error;
  if(result.status!==0&&!allowFailure)throw new Error(result.stderr||`GitHub CLI failed: ${result.status}`);
  return result;
}
const lookup=gh(['api',`repos/${repo}/releases/tags/${encodeURIComponent(tag)}`],true);
let release;
if(lookup.status===0){
  release=JSON.parse(lookup.stdout);
  if(release.target_commitish!==target||release.draft)throw new Error('An existing release belongs to another commit or is a draft');
}else{
  if(!lookup.stderr.includes('HTTP 404'))throw new Error(lookup.stderr);
  gh(['release','create',tag,'--repo',repo,'--target',target,'--title',`Relay Chat ${tag.slice(1)}`,'--notes-file','docs/RELEASE.md']);
  release={assets:[]};
}
const missing=[];
for(const path of files){
  const existing=release.assets.find(asset=>asset.name===basename(path));
  if(!existing)missing.push(path);
  else if(existing.digest&&existing.digest!==`sha256:${digests.get(basename(path))}`)throw new Error(`Existing asset differs: ${existing.name}`);
}
if(missing.length)gh(['release','upload',tag,'--repo',repo,...missing]);
const published=JSON.parse(gh(['api',`repos/${repo}/releases/tags/${encodeURIComponent(tag)}`]).stdout);
for(const path of files){
  const asset=published.assets.find(value=>value.name===basename(path));
  if(!asset||asset.state!=='uploaded'||(asset.digest&&asset.digest!==`sha256:${digests.get(basename(path))}`))throw new Error(`Asset was not uploaded correctly: ${basename(path)}`);
}
console.log(`Published ${published.html_url} with ${files.length} verified assets`);
