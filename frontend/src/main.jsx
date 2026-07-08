import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';
import { WalletProvider } from './wallet/WalletContext.jsx';
import './styles/index.css';
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { translations } from './i18n.js' // <-- importa aqui

window.t = (key, lang = 'pt') => translations[lang][key] || key // <-- função global pra usar t('buy')

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)














createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <WalletProvider>
      <App />
    </WalletProvider>
  </React.StrictMode>
);

