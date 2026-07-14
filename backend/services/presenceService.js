// wallet -> { connectedAt: number, lastSeen: number, sockets: Set<WebSocket> }
// Kept entirely in memory: presence is inherently ephemeral and would be
// pure write overhead in SQLite if persisted on every connect/heartbeat —
// exactly the kind of thing that would violate "stays lightweight after
// months of uptime." A restart simply means everyone reconnects and
// re-registers, which happens within seconds anyway.
const presence = new Map();

export function registerConnection(wallet, ws) {
  const now = Date.now();
  const entry = presence.get(wallet) ?? { connectedAt: now, lastSeen: now, sockets: new Set() };
  entry.lastSeen = now;
  entry.sockets.add(ws);
  presence.set(wallet, entry);
  return entry.sockets.size === 1; // true if this is the wallet's first connection (came online)
}

/** Returns true if the wallet has no more open sockets (went fully offline). */
export function unregisterConnection(wallet, ws) {
  const entry = presence.get(wallet);
  if (!entry) return true;
  entry.sockets.delete(ws);
  if (entry.sockets.size === 0) {
    presence.delete(wallet);
    return true;
  }
  return false;
}

export function touchLastSeen(wallet) {
  const entry = presence.get(wallet);
  if (entry) entry.lastSeen = Date.now();
}

export function getOnlineCount() {
  return presence.size;
}

export function getOnlineWallets() {
  return [...presence.entries()].map(([wallet, e]) => ({
    wallet,
    connectedAt: e.connectedAt,
    lastSeen: e.lastSeen,
    connections: e.sockets.size,
  }));
}

export function getSocketsForWallet(wallet) {
  return [...(presence.get(wallet)?.sockets ?? [])];
}

