import type { Session } from './types';

export class ApiError extends Error {constructor(public status:number,message:string){super(message);}}
const storageKey='relay.session.v1';
export function readSession():Session|null {
  try {const value=JSON.parse(localStorage.getItem(storageKey)||'null');return value?.token && new Date(value.expiresAt).getTime()>Date.now() ? value : null;}catch{return null;}
}
export function saveSession(session:Session|null) {if(session)localStorage.setItem(storageKey,JSON.stringify(session));else localStorage.removeItem(storageKey);}
export function normalizeServer(value:string) {
  if(!value.trim())return '';
  const url=new URL(value.trim());
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new Error('Введите адрес вида http://192.168.1.10:8080');
  if(url.pathname!=='/')throw new Error('Нужен адрес сервера без пути');
  return url.origin;
}
export function getServer(){return localStorage.getItem('relay.server')||import.meta.env.VITE_API_URL||'';}
export function setServer(value:string){const server=normalizeServer(value);if(server)localStorage.setItem('relay.server',server);else localStorage.removeItem('relay.server');return server;}
export function socketUrl(){return getServer()||window.location.origin;}
export async function api<T>(path:string,options:{method?:string;body?:unknown;token?:string;signal?:AbortSignal}={}):Promise<T>{
  try{
    const response=await fetch(`${getServer()}/api${path}`,{method:options.method||'GET',headers:{'Content-Type':'application/json',...(options.token?{Authorization:`Bearer ${options.token}`}:{})},...(options.body!==undefined?{body:JSON.stringify(options.body)}:{}),signal:options.signal||AbortSignal.timeout(15000)});
    if(response.status===204)return undefined as T;
    const data=await response.json();
    if(!response.ok)throw new ApiError(response.status,data.error||'Не удалось выполнить запрос');
    return data;
  }catch(error){
    if(error instanceof ApiError)throw error;
    if(error instanceof DOMException&&error.name==='AbortError')throw error;
    throw new ApiError(0,'Нет связи с сервером. Проверьте адрес и подключение.');
  }
}
export function nonce(){
  // randomUUID is unavailable on a plain-HTTP IP, while getRandomValues still works.
  const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
