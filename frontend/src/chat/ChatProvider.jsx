import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWallet } from '../wallet/useWallet.js';
import { chatWsUrl, uploadChatImage } from './chatApi.js';
import { ChatContext } from './ChatContext.jsx';

const MAX_CLIENT_EVENTS = 300; // bounds memory for a very long-lived tab; server already caps history independently
const TYPING_TIMEOUT_MS = 3000;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15_000;

function trimEvents(events) {
  return events.length > MAX_CLIENT_EVENTS ? events.slice(events.length - MAX_CLIENT_EVENTS) : events;
}

export function ChatProvider({ children }) {
  const { address } = useWallet();
  const [events, setEvents] = useState([]); // chat messages + join/leave system notices, in arrival order
  const [onlineCount, setOnlineCount] = useState(0);
  const [typingWallets, setTypingWallets] = useState([]);
  const [connectionStatus, setConnectionStatus] = useState('idle'); // idle | connecting | open | closed
  const [lastError, setLastError] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);

  const wsRef = useRef(null);
  const reconnectAttempt = useRef(0);
  const reconnectTimer = useRef(null);
  const typingTimers = useRef(new Map());
  const intentionalClose = useRef(false);
  const panelOpenRef = useRef(panelOpen);

  const upsertMessage = useCallback((message) => {
    setEvents((prev) => {
      const idx = prev.findIndex((e) => e.kind === 'message' && e.id === message.id);
      const entry = { kind: 'message', ...message };
      if (idx === -1) return trimEvents([...prev, entry]);
      const next = [...prev];
      next[idx] = { ...next[idx], ...entry };
      return next;
    });
  }, []);

  const pushSystemEvent = useCallback((type, wallet) => {
    setEvents((prev) =>
      trimEvents([...prev, { kind: 'system', type, wallet, id: `sys-${Date.now()}-${Math.random()}`, createdAt: new Date().toISOString() }])
    );
  }, []);

  const removeMessages = useCallback((ids) => {
    const idSet = new Set(ids);
    setEvents((prev) => prev.filter((e) => !(e.kind === 'message' && idSet.has(e.id))));
  }, []);

  const clearTypingFor = useCallback((wallet) => {
    setTypingWallets((prev) => prev.filter((w) => w !== wallet));
    const t = typingTimers.current.get(wallet);
    if (t) {
      clearTimeout(t);
      typingTimers.current.delete(wallet);
    }
  }, []);

  const connect = useCallback(() => {
    if (!address) return;
    intentionalClose.current = false;
    setConnectionStatus('connecting');

    const ws = new WebSocket(chatWsUrl(address));
    wsRef.current = ws;

    ws.onopen = () => {
      reconnectAttempt.current = 0;
      setConnectionStatus('open');
    };

    ws.onmessage = (evt) => {
      let msg;
      try {
        msg = JSON.parse(evt.data);
      } catch {
        return;
      }

      switch (msg.type) {
        case 'chat:init': {
          setEvents(msg.messages.map((m) => ({ kind: 'message', ...m })));
          setOnlineCount(msg.onlineCount);
          break;
        }
        case 'chat:new': {
          upsertMessage(msg.message);
          if (msg.message.wallet !== address && !panelOpenRef.current) {
            setUnreadCount((c) => c + 1);
          }
          break;
        }
        case 'chat:reaction': {
          setEvents((prev) =>
            prev.map((e) => (e.kind === 'message' && e.id === msg.messageId ? { ...e, reactions: msg.reactions } : e))
          );
          break;
        }
        case 'chat:hidden': {
          removeMessages([msg.messageId]);
          break;
        }
        case 'chat:expired': {
          removeMessages(msg.messageIds);
          break;
        }
        case 'chat:reported': {
          setEvents((prev) => prev.map((e) => (e.kind === 'message' && e.id === msg.messageId ? { ...e, reportedByMe: true } : e)));
          break;
        }
        case 'chat:presence': {
          setOnlineCount(msg.onlineCount);
          break;
        }
        case 'chat:join': {
          setOnlineCount(msg.onlineCount);
          if (msg.wallet !== address) pushSystemEvent('join', msg.wallet);
          break;
        }
        case 'chat:leave': {
          setOnlineCount(msg.onlineCount);
          pushSystemEvent('leave', msg.wallet);
          break;
        }
        case 'chat:typing': {
          if (msg.wallet === address) break;
          setTypingWallets((prev) => (prev.includes(msg.wallet) ? prev : [...prev, msg.wallet]));
          const existing = typingTimers.current.get(msg.wallet);
          if (existing) clearTimeout(existing);
          typingTimers.current.set(
            msg.wallet,
            setTimeout(() => clearTypingFor(msg.wallet), TYPING_TIMEOUT_MS)
          );
          break;
        }
        case 'chat:error': {
          setLastError(msg);
          break;
        }
        case 'chat:kicked': {
          setLastError(msg);
          intentionalClose.current = true;
          ws.close();
          break;
        }
        default:
        // ignore unknown event types (forward-compatible)
      }
    };

    ws.onclose = () => {
      setConnectionStatus('closed');
      if (intentionalClose.current) return;
      const delay = Math.min(RECONNECT_BASE_MS * 2 ** reconnectAttempt.current, RECONNECT_MAX_MS);
      reconnectAttempt.current += 1;
      reconnectTimer.current = setTimeout(connect, delay);
    };

    ws.onerror = () => {
      // onclose fires right after — reconnect is handled there
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, upsertMessage, pushSystemEvent, removeMessages, clearTypingFor]);

  useEffect(() => {
    panelOpenRef.current = panelOpen;
    if (panelOpen) setUnreadCount(0);
  }, [panelOpen]);

  useEffect(() => {
    if (!address) {
      intentionalClose.current = true;
      wsRef.current?.close();
      wsRef.current = null;
      setEvents([]);
      setOnlineCount(0);
      setConnectionStatus('idle');
      return;
    }
    connect();
    return () => {
      intentionalClose.current = true;
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  useEffect(() => {
    return () => {
      for (const t of typingTimers.current.values()) clearTimeout(t);
    };
  }, []);

  const sendMessage = useCallback((message, { imagePath, replyTo } = {}) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setLastError({ code: 'NOT_CONNECTED', message: 'Chat is not connected.' });
      return;
    }
    ws.send(JSON.stringify({ type: 'chat:send', message, imagePath, replyTo }));
  }, []);

  const lastTypingSentAt = useRef(0);
  const sendTyping = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const now = Date.now();
    if (now - lastTypingSentAt.current < 1500) return; // client-side throttle, server just fans it out
    lastTypingSentAt.current = now;
    ws.send(JSON.stringify({ type: 'chat:typing' }));
  }, []);

  const react = useCallback((messageId, emoji) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'chat:react', messageId, emoji }));
  }, []);

  const report = useCallback((messageId) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'chat:report', messageId }));
  }, []);

  const uploadImage = useCallback(
    (file) => {
      if (!address) throw new Error('WALLET_NOT_CONNECTED');
      return uploadChatImage(file, address);
    },
    [address]
  );

  const messages = useMemo(() => events, [events]);

  const value = useMemo(
    () => ({
      messages,
      onlineCount,
      typingWallets,
      connectionStatus,
      lastError,
      clearError: () => setLastError(null),
      unreadCount,
      panelOpen,
      openPanel: () => setPanelOpen(true),
      closePanel: () => setPanelOpen(false),
      togglePanel: () => setPanelOpen((o) => !o),
      sendMessage,
      sendTyping,
      react,
      report,
      uploadImage,
    }),
    [messages, onlineCount, typingWallets, connectionStatus, lastError, unreadCount, panelOpen, sendMessage, sendTyping, react, report, uploadImage]
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

