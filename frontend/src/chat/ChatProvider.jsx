import { createContext, useContext, useState } from 'react'
import { useWallet } from '../wallet/WalletProvider'

const ChatContext = createContext(null)

export const useChat = () => {
  const ctx = useContext(ChatContext)
  if (!ctx) throw new Error('useChat must be used within ChatProvider')
  return ctx
}

export function ChatProvider({ children }) { // <- ESSE EXPORT AQUI
  const wallet = useWallet()
  
  const [isOpen, setIsOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)

  const value = {
    isOpen,
    setIsOpen,
    unreadCount,
    setUnreadCount,
    walletAddress: wallet.address,
    connected: wallet.connected
  }

  return (
    <ChatContext.Provider value={value}>
      {children}
    </ChatContext.Provider>
  )
}
