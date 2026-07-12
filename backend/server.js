import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'http';
import { config, TICKET_PRICE_LAMPORTS, assertProductionReady } from './config.js';
import { logAudit } from './db.js';
import { sweepExpiredOrders } from './services/orderService.js';
import { ensureInitialLot, getPrimaryLot } from './services/lotService.js';
import { connection } from './services/solanaVerify.js';
import { sweepExpiredMessages } from './services/chatService.js';
import { getOnlineCount } from './services/presenceService.js';
import ordersRouter from './routes/orders.js';
import adminRouter from './routes/admin.js';
import chatRouter from './routes/chat.js';
import { initWsHub } from './services/wsHub.js';
import { initChatHub, broadcastExpired } from './services/chatHub.js';

assertProductionReady(); // throws and refuses to boot if NODE_ENV=production with unsafe settings

function maskRpcUrl(url) {
  // Paid RPC providers embed an API key in the path or query string —
  // never let that leak into logs.
  try {
    const u = new URL(url);
    if (u.pathname.length > 1) u.pathname = '/***';
    if ([...u.searchParams.keys()].length > 0) u.search = '?***';
    return u.toString();
  } catch {
    return '***';
  }
}

const app = express();
app.set('trust proxy', 1); // needed so req.ip is the real client IP behind Render/other proxies
app.use(express.json());
app.use(cors({ origin: config.corsOrigins }));

// Render (and most uptime monitors) expect a plain 200 here — kept
// intentionally free of any DB/RPC calls so it can't false-negative on a
// transient dependency hiccup.
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', cluster: config.cluster, commitment: config.commitment, chatOnline: getOnlineCount() });
});

app.get('/api/config', (_req, res) => {
  res.json({
    ticketPriceLamports: TICKET_PRICE_LAMPORTS,
    ticketPriceSol: config.ticketPriceSol,
    treasuryWallet: config.treasuryWallet,
    maxTicketsPerPurchase: config.maxTicketsPerPurchase,
    allowOverpayment: config.allowOverpayment,
    chat: {
      maxMessageLength: config.chatMaxMessageLength,
      maxImageBytes: config.chatMaxImageBytes,
      messageTtlMinutes: config.chatMessageTtlMinutes,
    },
  });
});

app.use('/api', ordersRouter);
app.use('/api/admin', adminRouter);
app.use('/api/chat', chatRouter);
// Chat images are served as plain static files — nothing sensitive lives
// here (filenames are random UUIDs, no directory listing), and files are
// physically deleted by the expiration sweep, not just unlinked from the DB.
app.use('/uploads/chat', express.static(config.chatUploadDir, { maxAge: '1h' }));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'INTERNAL_ERROR' });
});

// Bring up lot #1 on a fresh database; a no-op on restart, since lots
// persist in the same SQLite file as everything else.
const seedResult = ensureInitialLot();
console.log(`[raspesol] env=${config.nodeEnv} cluster=${config.cluster} commitment=${config.commitment}`);
console.log(`[raspesol] rpc=${maskRpcUrl(config.rpcUrl)}`);
console.log(`[raspesol] treasury=${config.treasuryWallet}`);
console.log(`[raspesol] ticket price=${config.ticketPriceSol} SOL (${TICKET_PRICE_LAMPORTS} lamports)`);
console.log(`[raspesol] initial lot:`, seedResult.created ? seedResult.lot : '(existing lots restored)');
console.log(`[raspesol] primary lot is now #${getPrimaryLot()?.lote}`);
console.log(`[raspesol] chat message TTL=${config.chatMessageTtlMinutes}min, max length=${config.chatMaxMessageLength}`);

// Confirms the RPC is actually reachable at boot rather than discovering it
// on the first real purchase attempt.
connection
  .getVersion()
  .then((v) => console.log(`[raspesol] RPC reachable, solana-core ${v['solana-core']}`))
  .catch((err) => console.error(`[raspesol] WARNING: could not reach Solana RPC at boot: ${err.message}`));

const server = http.createServer(app);
initWsHub(server);
initChatHub(server);

// Sweep expired PENDING orders every 30s so tickets don't stay locked forever.
setInterval(() => {
  const n = sweepExpiredOrders();
  if (n > 0) logAudit('EXPIRY_SWEEP', { detail: { released: n } });
}, 30_000);

// Sweep expired chat messages (and their image files) every 15s — frequent
// enough that nothing visibly lingers past its 1-hour TTL, cheap enough to
// run forever. Every connected client is told which IDs just vanished so
// they can prune locally instead of re-fetching history.
setInterval(() => {
  const removedIds = sweepExpiredMessages();
  if (removedIds.length > 0) broadcastExpired(removedIds);
}, 15_000);

server.listen(config.port, () => {
  console.log(`[raspesol] backend listening on :${config.port}`);
});

