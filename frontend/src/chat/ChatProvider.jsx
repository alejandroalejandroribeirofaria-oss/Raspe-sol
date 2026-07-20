import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useWallet } from '../wallet/WalletProvider';
import { chatWsUrl, uploadChatImage } from './chatApi.js';

const ChatContext = createContext(null);

export const useChat = () => {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used within ChatProvider');
  return ctx;
};

const TYPING_TIMEOUT_MS = 4000;
const RECONNECT_DELAY_MS = 2000;

export function ChatProvider({ children }) {
  const { address, connected } = useWallet();

  const [panelOpen, setPanelOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [messages, setMessages] = useState([]);
  const [onlineCount, setOnlineCount] = useState(0);
  const [typingWallets, setTypingWallets] = useState([]);
  const [connectionStatus, setConnectionStatus] = useState<'closed' | 'connecting' | 'open'>('closed');
  const [lastError, setLastError] = useState(null);

  const wsRef = useRef(null);
  const typingTimersRef = useRef(new Map());
  const reconnectTimerRef = useRef(null);
  const panelOpenRef = useRef(panelOpen);
  const cancelledRef = useRef(false);

  // Mantém referência atualizada do panelOpen
  panelOpenRef.current = panelOpen;

  const clearError = useCallback(() => setLastError(null), []);

  const closePanel = useCallback(() => setPanelOpen(false), []);

  const togglePanel = useCallback(() => {
    setPanelOpen((open) => {
      const next = !open;
      if (next) setUnreadCount(0);
      return next;
    });
  }, []);

  const clearTypingTimer = useCallback((wallet) => {
    const timers = typingTimersRef.current;
    const existing = timers.get(wallet);
    if (existing) {
      clearTimeout(existing);
      timers.delete(wallet);
    }
  }, []);

  const markTyping = useCallback(
    (wallet) => {
      setTypingWallets((prev) => (prev.includes(wallet) ? prev : [...prev, wallet]));
      clearTypingTimer(wallet);

      const timeoutId = setTimeout(() => {
        setTypingWallets((prev) => prev.filter((w) => w !== wallet));
        typingTimersRef.current.delete(wallet);
      }, TYPING_TIMEOUT_MS);

      typingTimersRef.current.set(wallet, timeoutId);
    },
    [clearTypingTimer]
  );

  // ==================== WEBSOCKET ====================

  const connect = useCallback(() => {
    if (!connected || !address || cancelledRef.current) return;

    // Fecha conexão anterior se existir
    if (wsRef.current) {
      wsRef.current.close();
    }

    setConnectionStatus('connecting');
    const ws = new WebSocket(chatWsUrl(address));
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('CHAT WS CONECTADO');
      if (!cancelledRef.current) {
        setConnectionStatus('open');
      }
    };

    ws.onmessage = (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }

      switch (data.type) {
        case 'chat:init':
          setMessages(data.messages.map((m) => ({ kind: 'message', ...m })));
          setOnlineCount(data.onlineCount);
          break;

        case 'chat:new':
          setMessages((prev) => [...prev, { kind: 'message', ...data.message }]);
          if (!panelOpenRef.current && data.message.wallet !== address) {
            setUnreadCount((c) => c + 1);
          }
          break;

        case 'chat:join':
        case 'chat:leave':
        case 'chat:presence':
          setOnlineCount(data.onlineCount);
          if (data.type !== 'chat:presence') {
            setMessages((prev) => [
              ...prev,
              {
                kind: 'system',
                type: data.type === 'chat:join' ? 'join' : 'leave',
                id: `\( {data.type}- \){data.wallet}-${Date.now()}`,
                wallet: data.wallet,
              },
            ]);
          }
          break;

        case 'chat:typing':
          if (data.wallet !== address) markTyping(data.wallet);
          break;

        case 'chat:reaction':
          setMessages((prev) =>
            prev.map((m) =>
              m.kind === 'message' && m.id === data.messageId
                ? { ...m, reactions: data.reactions }
                : m
            )
          );
          break;

        case 'chat:hidden':
          setMessages((prev) => prev.filter((m) => !(m.kind === 'message' && m.id === data.messageId)));
          break;

        case 'chat:reported':
          setMessages((prev) =>
            prev.map((m) =>
              m.kind === 'message' && m.id === data.messageId ? { ...m, reportedByMe: true } : m
            )
          );
          break;

        case 'chat:expired':
          setMessages((prev) => prev.filter((m) => !(m.kind === 'message' && data.messageIds.includes(m.id))));
          break;

        case 'chat:kicked':
          setLastError({ code: 'KICKED', message: data.reason });
          ws.close();
          break;

        case 'chat:error':
          setLastError({ code: data.code, message: data.message });
          break;

        default:
          console.warn('Mensagem WS desconhecida:', data.type);
      }
    };

    ws.onclose = () => {
      if (cancelledRef.current) return;
      setConnectionStatus('closed');

      // Tentativa de reconexão automática
      reconnectTimerRef.current = setTimeout(() => {
        if (!cancelledRef.current) connect();
      }, RECONNECT_DELAY_MS);
    };

    ws.onerror = () => {
      console.error('CHAT WS ERROR');
      ws.close();
    };
  }, [connected, address, markTyping]);

  // Envio de mensagens (padrão solicitado)
  const send = useCallback((payload) => {
    const ws = wsRef.current;

    console.log('WS STATUS:', ws?.readyState);

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setLastError({
        code: 'NOT_CONNECTED',
        message: 'Not connected to chat.',
      });
      return;
    }

    ws.send(JSON.stringify(payload));
  }, []);

  // Ações públicas
  const sendMessage = useCallback(
    (text, opts = {}) => {
      send({ type: 'chat:send', message: text, imagePath: opts.imagePath, replyTo: opts.replyTo });
    },
    [send]
  );

  const sendTyping = useCallback(() => {
    send({ type: 'chat:typing' });
  }, [send]);

  const react = useCallback(
    (messageId, emoji) => {
      send({ type: 'chat:react', messageId, emoji });
    },
    [send]
  );

  const report = useCallback(
    (messageId) => {
      send({ type: 'chat:report', messageId });
    },
    [send]
  );

  const uploadImage = useCallback(
    async (file) => {
      if (!address) throw new Error('Connect a wallet before sending images.');
      return uploadChatImage(file, address);
    },
    [address]
  );

  // Conecta/desconecta quando o wallet muda
  useEffect(() => {
    cancelledRef.current = false;

    if (connected && address) {
      connect();
    } else {
      setConnectionStatus('closed');
      setMessages([]);
      setTypingWallets([]);
      setUnreadCount(0);
    }

    return () => {
      cancelledRef.current = true;
      clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
      wsRef.current = null;

      // Limpa timers de typing
      for (const timeoutId of typingTimersRef.current.values()) {
        clearTimeout(timeoutId);
      }
      typingTimersRef.current.clear();
    };
  }, [connected, address, connect]);

  const value = {
    panelOpen,
    unreadCount,
    togglePanel,
    closePanel,
    messages,
    onlineCount,
    typingWallets,
    connectionStatus,
    lastError,
    clearError,
    sendMessage,
    sendTyping,
    react,
    report,
    uploadImage,
    walletAddress: address,
    connected,
    // Expõe send se precisar usar em casos avançados
    send,
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export default ChatProvider;
