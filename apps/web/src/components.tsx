import { useEffect, useRef, type ReactNode } from 'react';
import { X, MessageCircle, Server } from 'lucide-react';
import type { User } from './types';

export function Brand({compact=false}:{compact?:boolean}){return <div className="brand"><span className="brand-icon"><MessageCircle size={26} strokeWidth={2.2}/></span>{!compact&&<span>relay<span className="brand-dot">.</span></span>}</div>;}
export function Avatar({user,size=''}:{user:Pick<User,'displayName'|'color'>;size?:string}){return <span className={`avatar ${size}`} style={{background:user.color}}>{user.displayName.trim().split(/\s+/).slice(0,2).map(s=>s[0]).join('').toUpperCase()}</span>;}
export function Modal({title,children,onClose}:{title:string;children:ReactNode;onClose:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{dialog.current?.showModal();return ()=>dialog.current?.close();},[]);
  return <dialog ref={dialog} className="modal" onCancel={onClose} onClick={e=>{if(e.target===dialog.current)onClose();}}><div className="modal-header"><h2>{title}</h2><button className="icon-button" aria-label="Закрыть" onClick={onClose}><X size={20}/></button></div>{children}</dialog>;
}
export function ServerField({value,onChange,native}:{value:string;onChange:(value:string)=>void;native:boolean}){
  return <details className="server-settings" open={native||Boolean(value)}><summary><Server size={16}/>Адрес сервера</summary><label className="field"><span>Сервер для подключения</span><input type="url" value={value} onChange={e=>onChange(e.target.value)} placeholder={native?'http://192.168.1.10:8080':'Текущий сайт (по умолчанию)'} autoComplete="url"/></label><p className="field-help">На телефоне и компьютере укажите один и тот же адрес.</p></details>;
}
