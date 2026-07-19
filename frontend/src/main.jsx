import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './styles/index.css'
import '@solana/wallet-adapter-react-ui/styles.css'

import { I18nProvider } from './i18n/I18nProvider.jsx'
import { WalletProvider } from './wallet/WalletProvider.jsx'
import { ChatProvider } from './chat/ChatProvider.jsx'
import ChatToggleButton from './chat/ChatToggleButton.jsx' // <- FALTAVA ISSO

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <I18nProvider>
      <WalletProvider>
        <ChatProvider>
          <App />
          <ChatToggleButton /> {/* <- FALTAVA ISSO TAMBÉM */}
        </ChatProvider>
      </WalletProvider>
    </I18nProvider>
  </React.StrictMode>
)
