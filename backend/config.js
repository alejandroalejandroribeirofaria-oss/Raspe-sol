import { PublicKey } from '@solana/web3.js';

function bool(val, fallback) {
  if (val === undefined) return fallback;
  return val === 'true' || val === '1';
}

const PUBLIC_MAINNET_RPC = 'https://api.mainnet-beta.solana.com';

// ---------------------------------------------------------------------------
// Central lot & prize configuration. This is the one place to change ticket
// price, lot size, the auto-creation threshold, or the prize mix — every
// other module (db.js's ticket generator, lotService.js, orderService.js)
// reads these instead of hardcoding its own copy.
//
// All three are env-overridable, but the defaults reflect the current
// production numbers: 20,000 tickets per lot, a new lot auto-created once
// 1,000 remain, 0.01 SOL per ticket.
// ---------------------------------------------------------------------------
export const LOT_SIZE = Number(process.env.LOT_SIZE || '20000');
export const AUTO_CREATE_THRESHOLD = Number(
  process.env.AUTO_CREATE_THRESHOLD || process.env.LOT_LOW_WATERMARK || '1000'
);
export const TICKET_PRICE_SOL = Number(process.env.TICKET_PRICE_SOL || '0.01');

// Exact prize counts per lot — not probabilities. db.js's ticket generator
// builds a slot for each of these, shuffles the whole lot, and fills every
// remaining slot with a zero prize. That's what guarantees a lot can never
// contain, say, two 5 SOL tickets: there is only ever one 5 SOL slot to
// begin with.
export const PRIZES = [
  { label: '0.02 SOL', sol: 0.02, count: 30 },
  { label: '1 SOL', sol: 1, count: 1 },
  { label: '2 SOL', sol: 2, count: 1 },
  { label: '5 SOL', sol: 5, count: 1 },
];

export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',

  treasuryWallet: process.env.TREASURY_WALLET,
  rpcUrl: process.env.SOLANA_RPC_URL || PUBLIC_MAINNET_RPC,
  cluster: process.env.SOLANA_CLUSTER || 'mainnet-beta',
  // 'confirmed' is fine for dev iteration; production payments must use
  // 'finalized' so a cluster re-org can never invalidate a payment that
  // already granted tickets — enforced below in assertProductionReady().
  commitment: process.env.SOLANA_COMMITMENT || 'confirmed',

  ticketPriceSol: TICKET_PRICE_SOL,
  orderExpiryMinutes: Number(process.env.ORDER_EXPIRY_MINUTES || '5'),

  // Reject any payment whose blockTime is older than this — stops stale or
  // replayed signatures from old wallets/screenshots being submitted later.
  maxTransactionAgeSeconds: Number(process.env.MAX_TRANSACTION_AGE_SECONDS || '900'),

  maxTicketsPerPurchase: Number(process.env.MAX_TICKETS_PER_PURCHASE || '1000'),
  allowOverpayment: bool(process.env.ALLOW_OVERPAYMENT, true),
  ignoreRemainder: bool(process.env.IGNORE_REMAINDER, true),

  requireChainConfirmation: bool(process.env.REQUIRE_CHAIN_CONFIRMATION, true),

  // Ticket lot lifecycle: when the active lot drops to lotLowWatermark
  // tickets remaining, a new lot of lotSize tickets is created automatically.
  lotSize: LOT_SIZE,
  lotLowWatermark: AUTO_CREATE_THRESHOLD,

  adminToken: process.env.ADMIN_TOKEN || null,

  // --- Chat -----------------------------------------------------------
  chatMessageTtlMinutes: Number(process.env.CHAT_MESSAGE_TTL_MINUTES || '60'),
  chatMaxMessageLength: Number(process.env.CHAT_MAX_MESSAGE_LENGTH || '200'),
  chatMinMessageIntervalMs: Number(process.env.CHAT_MIN_MESSAGE_INTERVAL_MS || '1000'),
  chatMaxImagesPerMinute: Number(process.env.CHAT_MAX_IMAGES_PER_MINUTE || '3'),
  chatMaxImageBytes: Number(process.env.CHAT_MAX_IMAGE_BYTES || 5 * 1024 * 1024),
  chatReportThreshold: Number(process.env.CHAT_REPORT_THRESHOLD || '5'),
  chatHistoryLimit: Number(process.env.CHAT_HISTORY_LIMIT || '200'),
  chatUploadDir: process.env.CHAT_UPLOAD_DIR || './uploads/chat',
  chatBannedWords: (process.env.CHAT_BANNED_WORDS || '')
    .split(',')
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean),

  port: Number(process.env.PORT || '4000'),
  corsOrigins: (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map((s) => s.trim()),
  dbPath: process.env.DB_PATH || './data/raspesol.db',
};

export const TICKET_PRICE_LAMPORTS = Math.round(config.ticketPriceSol * 1e9);

// --- Fail fast on a malformed or missing treasury wallet --------------------
// A typo here would silently verify payments against the wrong account (or
// crash deep inside @solana/web3.js with a confusing stack trace) — check it
// up front with a clear message instead.
if (!config.treasuryWallet) {
  throw new Error('TREASURY_WALLET env var is required — refusing to start without it.');
}
try {
  new PublicKey(config.treasuryWallet);
} catch {
  throw new Error(`TREASURY_WALLET "${config.treasuryWallet}" is not a valid Solana address.`);
}

/**
 * Hard requirements before this process is allowed to accept real payments.
 * Called from server.js at boot. Throws (refuses to start) rather than
 * silently running with unsafe settings when NODE_ENV=production.
 */
export function assertProductionReady() {
  if (!config.isProduction) return;

  const problems = [];
  if (config.cluster !== 'mainnet-beta') {
    problems.push(`SOLANA_CLUSTER is "${config.cluster}", expected "mainnet-beta" in production.`);
  }
  if (config.commitment !== 'finalized') {
    problems.push(`SOLANA_COMMITMENT is "${config.commitment}", must be "finalized" in production.`);
  }
  if (!config.requireChainConfirmation) {
    problems.push('REQUIRE_CHAIN_CONFIRMATION must be true in production.');
  }
  if (!config.adminToken) {
    problems.push('ADMIN_TOKEN is not set — the admin dashboard would be unreachable (safe, but likely unintended).');
  }

  if (problems.length > 0) {
    throw new Error(`Refusing to start in production with unsafe configuration:\n- ${problems.join('\n- ')}`);
  }

  if (config.rpcUrl === PUBLIC_MAINNET_RPC) {
    console.warn(
      '[raspesol] WARNING: using the public Solana mainnet RPC in production. ' +
        'It rate-limits aggressively and is not meant for production payment verification — ' +
        'switch SOLANA_RPC_URL to a paid provider (Helius, QuickNode, Triton) before real traffic arrives.'
    );
  }
}

