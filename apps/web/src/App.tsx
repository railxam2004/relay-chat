import {useEffect,useState} from 'react';
import {api,ApiError,readSession,saveSession} from './api';
import type {Session,User} from './types';
import Login from './Login';
import Chat from './Chat';

export default function App(){
  const [session,setSession]=useState<Session|null>(readSession),[notice,setNotice]=useState('');
  useEffect(()=>{saveSession(session);},[session]);
  useEffect(()=>{
    if(!session)return;
    const controller=new AbortController();
    api<User>('/me',{token:session.token,signal:controller.signal}).then(user=>setSession(value=>value?{...value,user}:null)).catch(error=>{if(error instanceof ApiError&&error.status===401){setNotice(error.message);setSession(null);}});
    return ()=>controller.abort();
  },[session?.token]);
  function logout(message=''){setNotice(message);setSession(null);saveSession(null);}
  return session?<Chat session={session} onLogout={logout} onUser={user=>setSession(value=>value?{...value,user}:null)}/>:<Login onLogin={value=>{setNotice('');setSession(value);}} notice={notice}/>;
}
