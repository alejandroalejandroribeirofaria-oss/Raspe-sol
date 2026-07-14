import { WebSocketServer } from 'ws';
import {
  sendMessage,
  toggleReaction,
  reportMessage,
  getActiveMessages,
  getReactionsFor,
  ChatError,
} from './chatService.js';
import {
  registerConnection,
  unregisterConnection,
  touchLastSeen,
  getOnlineCount,
  getSocketsForWallet,
} from './presenceService.js';

const clients = new Set(); // every open chat socket, regardless of wallet

function send(ws, type, payload) {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify({ type, ...payload }));
}

function broadcast(type, payload, { exclude } = {}) {
  const message = JSON.stringify({ type, ...payload });
  for (const ws of clients) {
    if (ws === exclude) continue;
    if (ws.readyState === ws.OPEN) ws.send(message);
  }
}

function serializeMessage(row, reactionsByMessage) {
  return {
    id: row.id,
    wallet: row.wallet,
    message: row.message,
    imagePath: row.image_path,
    replyTo: row.reply_to,
    createdAt: row.created_at,
    reactions: reactionsByMessage[row.id] || [],
  };
}

export function initChatHub(server) {
  const wss = new WebSocketServer({ server, path: '/ws/chat' });

  wss.on('connection', (ws, req) => {
    let wallet = null;
    try {
      const url = new URL(req.url, 'http://internal');
      wallet = url.searchParams.get('wallet');
    } catch {
      // malformed URL — treated as anonymous below
    }

    if (!wallet) {
      send(ws, 'chat:error', { code: 'WALLET_REQUIRED', message: 'Connect a wallet before joining chat.' });
      ws.close();
      return;
    }

    ws._wallet = wallet;
    clients.add(ws);
    const wentOnline = registerConnection(wallet, ws);

    const activeMessages = getActiveMessages();
    const reactionsByMessage = getReactionsFor(activeMessages.map((m) => m.id));

    send(ws, 'chat:init', {
      messages: activeMessages.map((m) => serializeMessage(m, reactionsByMessage)),
      onlineCount: getOnlineCount(),
    });

    if (wentOnline) {
      broadcast('chat:join', { wallet, onlineCount: getOnlineCount() }, { exclude: ws });
    }
    broadcast('chat:presence', { onlineCount: getOnlineCount() });

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return; // ignore malformed frames
      }

      touchLastSeen(wallet);

      try {
        switch (msg.type) {
          case 'chat:send': {
            const saved = sendMessage({
              wallet,
              message: msg.message,
              imagePath: msg.imagePath,
              replyTo: msg.replyTo || null,
            });
            broadcast('chat:new', { message: serializeMessage(saved, {}) });
            break;
          }
          case 'chat:typing': {
            broadcast('chat:typing', { wallet }, { exclude: ws });
            break;
          }
          case 'chat:react': {
            if (!msg.messageId || !msg.emoji) break;
            const result = toggleReaction({ messageId: msg.messageId, wallet, emoji: msg.emoji });
            broadcast('chat:reaction', result);
            break;
          }
          case 'chat:report': {
            if (!msg.messageId) break;
            const result = reportMessage({ messageId: msg.messageId, wallet });
            if (result.hidden) broadcast('chat:hidden', { messageId: result.messageId });
            else send(ws, 'chat:reported', result);
            break;
          }
          default:
          // unknown message type — ignore rather than error, keeps the
          // protocol forward-compatible with future client versions
        }
      } catch (err) {
        if (err instanceof ChatError) {
          send(ws, 'chat:error', { code: err.code, message: err.message });
        } else {
          console.error('[chat ws]', err);
          send(ws, 'chat:error', { code: 'INTERNAL_ERROR', message: 'Something went wrong.' });
        }
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      const wentOffline = unregisterConnection(wallet, ws);
      if (wentOffline) {
        broadcast('chat:leave', { wallet, onlineCount: getOnlineCount() });
      } else {
        broadcast('chat:presence', { onlineCount: getOnlineCount() });
      }
    });
  });

  return wss;
}

/** Used by the admin "expel user" action — closes every open socket for a wallet. */
export function kickWallet(wallet, reason = 'Removed by an administrator.') {
  const sockets = getSocketsForWallet(wallet);
  for (const ws of sockets) {
    send(ws, 'chat:kicked', { reason });
    ws.close();
  }
  return sockets.length;
}

/** Used by the expiration sweep to tell every connected client which messages just vanished. */
export function broadcastExpired(messageIds) {
  if (messageIds.length === 0) return;
  broadcast('chat:expired', { messageIds });
}

