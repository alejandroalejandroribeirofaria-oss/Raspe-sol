import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './styles/index.css' 
import '@solana/wallet-adapter-react-ui/styles.css' // <- PRECISA DISSO PRA MODAL DA WALLET FUNCIONAR

import { I18nProvider } from './i18n/I18nProvider.jsx'
import { WalletProvider } from './wallet/WalletProvider.jsx'
import { ChatProvider } from './chat/ChatProvider.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <I18nProvider>
      <WalletProvider> {/* 1º: Wallet tem que vir primeiro */}
        <ChatProvider> {/* 2º: Chat usa o Wallet */}
          <App />
        </ChatProvider>
      </WalletProvider>
    </I18nProvider>
  </React.StrictMode>,
)
