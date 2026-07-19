import './styles/index.css' // <-- COLOCA ESSA PRIMEIRA LINHA
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { I18nProvider } from './i18n/I18nProvider.jsx'
import { WalletProvider } from './wallet/WalletProvider.jsx'
import { ChatProvider } from './chat/ChatProvider.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <I18nProvider>
      <WalletProvider>
        <ChatProvider>
          <App />
        </ChatProvider>
      </WalletProvider>
    </I18nProvider>
  </React.StrictMode>,
)
