import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { I18nProvider } from './i18n/I18nProvider.jsx'
import { WalletProvider } from './wallet/WalletProvider.jsx' // 1. IMPORTA

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <I18nProvider>
      <WalletProvider>  {/* 2. ENVOLVE O APP */}
        <App />
      </WalletProvider>
    </I18nProvider>
  </React.StrictMode>,
)
