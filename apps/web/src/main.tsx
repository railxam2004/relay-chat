import React from 'react';
import { createRoot } from 'react-dom/client';
import { IonApp, setupIonicReact } from '@ionic/react';
import '@ionic/react/css/core.css';
import App from './App';
import './styles.css';

setupIonicReact();
createRoot(document.getElementById('root')!).render(<React.StrictMode><IonApp><App/></IonApp></React.StrictMode>);
