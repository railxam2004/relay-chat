import { useState, type FormEvent } from 'react';
import { Capacitor } from '@capacitor/core';
import { Eye,EyeOff,LockKeyhole,Hash } from 'lucide-react';
import { api,getServer,setServer } from './api';
import type {Session} from './types';
import {Brand,ServerField} from './components';

export default function Login({onLogin,notice}:{onLogin:(session:Session)=>void;notice:string}){
  const [mode,setMode]=useState<'login'|'register'>('login');
  const [username,setUsername]=useState(''),[password,setPassword]=useState(''),[displayName,setDisplayName]=useState('');
  const [server,setServerValue]=useState(getServer()),[error,setError]=useState(''),[busy,setBusy]=useState(false),[show,setShow]=useState(false);
  const native=Capacitor.isNativePlatform()||window.location.protocol==='relay:'||window.location.protocol==='file:';
  async function submit(event:FormEvent){
    event.preventDefault();setBusy(true);setError('');
    try{
      if(native&&!server.trim())throw new Error('Укажите адрес сервера');
      setServer(server);
      const session=await api<Session>(`/auth/${mode}`,{method:'POST',body:{username,password,...(mode==='register'?{displayName}:{})}});
      onLogin(session);
    }catch(err){setError((err as Error).message);}finally{setBusy(false);}
  }
  return <main className="login-screen"><div className="login-card"><div className="login-aside"><Brand/><div className="login-visual" aria-hidden="true"><span className="visual-channel"><Hash size={24}/>Общее</span><span className="visual-bubble first">Всем привет! 👋</span><span className="visual-bubble second">Привет! На связи.</span><span className="visual-bubble third">Продолжим здесь?</span></div><div className="login-note"><LockKeyhole size={17}/><span>Ваши каналы и сообщения<br/>на всех устройствах</span></div></div><div className="login-form"><Brand/><div className="auth-tabs"><button className={mode==='login'?'selected':''} onClick={()=>{setMode('login');setError('');}}>Вход</button><button className={mode==='register'?'selected':''} onClick={()=>{setMode('register');setError('');}}>Регистрация</button></div><h1>{mode==='login'?'Рады видеть вас':'Давайте знакомиться'}</h1><p className="muted">{mode==='login'?'Войдите, чтобы продолжить разговор.':'Создайте аккаунт и присоединяйтесь к каналам.'}</p>{notice&&<div className="notice">{notice}</div>}<form onSubmit={submit}>{mode==='register'&&<label className="field"><span>Ваше имя</span><input value={displayName} onChange={e=>setDisplayName(e.target.value)} required maxLength={64} autoComplete="name" placeholder="Как к вам обращаться?"/></label>}<label className="field"><span>Логин</span><input value={username} onChange={e=>setUsername(e.target.value)} required minLength={3} maxLength={32} pattern="[a-zA-Z0-9_]{3,32}" autoComplete="username" autoCapitalize="none" placeholder="Например, rail"/><small>Латиница, цифры и подчёркивание</small></label><label className="field"><span>Пароль</span><div className="password-field"><input type={show?'text':'password'} value={password} onChange={e=>setPassword(e.target.value)} minLength={8} maxLength={128} required autoComplete={mode==='register'?'new-password':'current-password'} placeholder="Не меньше 8 символов"/><button type="button" className="icon-button" aria-label={show?'Скрыть пароль':'Показать пароль'} onClick={()=>setShow(!show)}>{show?<EyeOff size={19}/>:<Eye size={19}/>}</button></div></label><ServerField value={server} onChange={setServerValue} native={native}/>{error&&<div className="error-message" role="alert">{error}</div>}<button className="primary-button full" disabled={busy}>{busy?'Подключаемся…':mode==='login'?'Войти':'Создать аккаунт'}</button></form></div></div><p className="login-footer">Relay Chat</p></main>;
}
