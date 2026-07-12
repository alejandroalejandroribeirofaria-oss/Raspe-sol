import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { config, PRIZES } from './config.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS tickets (
  uuid            TEXT PRIMARY KEY,
  batch           TEXT NOT NULL,
  prize_lamports  INTEGER NOT NULL DEFAULT 0,
  prize_label     TEXT NOT NULL,
  seed            TEXT NOT NULL,
  hash            TEXT NOT NULL,
  owner_wallet    TEXT,
  order_id        TEXT,
  status          TEXT NOT NULL DEFAULT 'AVAILABLE', -- AVAILABLE | RESERVED | SOLD | REVEALED
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  revealed_at     TEXT,
  -- Manual prize claim workflow (see services/claimService.js). Nothing
  -- here ever moves SOL automatically — this is bookkeeping only, updated
  -- exclusively by the backend, never by anything the frontend sends.
  claim_status    TEXT NOT NULL DEFAULT 'NONE', -- NONE | PENDING | PAID
  claimed_at      TEXT,
  claim_paid_at   TEXT,
  claim_paid_by   TEXT
);

-- One row per purchase attempt. "quantity" is what the buyer *requested*;
-- the actual number of tickets granted is only known after the payment is
-- verified on-chain and is stored on the linked transaction record.
CREATE TABLE IF NOT EXISTS orders (
  order_id          TEXT PRIMARY KEY,
  wallet            TEXT NOT NULL,
  requested_qty     INTEGER NOT NULL,
  expected_lamports INTEGER NOT NULL,
  granted_qty       INTEGER,
  status            TEXT NOT NULL DEFAULT 'PENDING', -- PENDING | PAID | EXPIRED | REJECTED
  reject_reason     TEXT,
  tx_signature      TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at        TEXT NOT NULL,
  paid_at           TEXT
);

-- Every accepted payment, keyed uniquely by signature. This UNIQUE
-- constraint — not application logic — is the real guarantee that a
-- signature can never be used twice, even under concurrent requests.
CREATE TABLE IF NOT EXISTS processed_transactions (
  tx_signature    TEXT PRIMARY KEY,
  wallet          TEXT NOT NULL,
  amount_lamports INTEGER NOT NULL,
  slot            INTEGER,
  block_time      INTEGER,
  cluster         TEXT,
  order_id        TEXT REFERENCES orders(order_id),
  ticket_count    INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  event         TEXT NOT NULL,
  order_id      TEXT,
  wallet        TEXT,
  ip            TEXT,
  user_agent    TEXT,
  detail        TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_order ON tickets(order_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

-- Tracks every ticket lot ever created. "ativo" means still sellable (not
-- yet exhausted); the newest lot is the "primary" one shown in the admin
-- dashboard, but an older lot keeps selling — concurrently, if still
-- ativo — until its own stock hits zero.
CREATE TABLE IF NOT EXISTS ticket_lots (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  lote                    INTEGER NOT NULL UNIQUE,
  lot_id                  TEXT,
  batch_key               TEXT NOT NULL UNIQUE,
  quantidade_inicial      INTEGER NOT NULL,
  quantidade_disponivel   INTEGER NOT NULL,
  lot_seed                TEXT,
  ativo                   INTEGER NOT NULL DEFAULT 1,
  criado_em               TEXT NOT NULL DEFAULT (datetime('now')),
  encerrado_em            TEXT
);
-- A separate (not inline) unique index, because SQLite's ALTER TABLE ADD
-- COLUMN — used below to migrate databases created before lot_id existed —
-- doesn't allow adding a column with an inline UNIQUE constraint.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_lots_lot_id ON ticket_lots(lot_id);

CREATE INDEX IF NOT EXISTS idx_lots_ativo ON ticket_lots(ativo);

-- Chat is intentionally ephemeral: every row carries its own expires_at and
-- a periodic sweep (chatService.sweepExpiredMessages) hard-deletes rows and
-- their image files once expired. There is no archive table and no
-- "soft delete" — this is what keeps storage flat no matter how long the
-- server has been running.
CREATE TABLE IF NOT EXISTS chat_messages (
  id              TEXT PRIMARY KEY,
  wallet          TEXT NOT NULL,
  message         TEXT,
  image_path      TEXT,
  reply_to        TEXT REFERENCES chat_messages(id),
  reported_count  INTEGER NOT NULL DEFAULT 0,
  hidden          INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_expires ON chat_messages(expires_at);
CREATE INDEX IF NOT EXISTS idx_chat_messages_hidden ON chat_messages(hidden);

-- One report per (message, wallet) — the PRIMARY KEY is what actually
-- prevents a single wallet from reporting the same message repeatedly to
-- force it into hiding.
CREATE TABLE IF NOT EXISTS chat_reports (
  message_id  TEXT NOT NULL,
  wallet      TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (message_id, wallet)
);

-- One row per (message, wallet, emoji) — same wallet can react with several
-- different emoji, but not stack the same one twice; sending it again toggles it off.
CREATE TABLE IF NOT EXISTS chat_reactions (
  message_id  TEXT NOT NULL,
  wallet      TEXT NOT NULL,
  emoji       TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (message_id, wallet, emoji)
);

-- Temporary moderation blocks (admin "block wallet" action). Rows past
-- blocked_until are simply ignored, not swept — the table stays tiny.
CREATE TABLE IF NOT EXISTS chat_blocked_wallets (
  wallet        TEXT PRIMARY KEY,
  blocked_until TEXT NOT NULL,
  reason        TEXT
);
`);

// --- Migration for databases created before the manual-claim columns
// existed. CREATE TABLE IF NOT EXISTS above is a no-op on an existing
// tickets table, so any column added after the table's first release has
// to be backfilled explicitly like this — idempotent, safe to run every boot.
const existingTicketColumns = new Set(db.prepare(`PRAGMA table_info(tickets)`).all().map((c) => c.name));
const claimColumnDefs = {
  claim_status: `TEXT NOT NULL DEFAULT 'NONE'`,
  claimed_at: `TEXT`,
  claim_paid_at: `TEXT`,
  claim_paid_by: `TEXT`,
};
for (const [column, definition] of Object.entries(claimColumnDefs)) {
  if (!existingTicketColumns.has(column)) {
    db.exec(`ALTER TABLE tickets ADD COLUMN ${column} ${definition}`);
  }
}
db.exec(`CREATE INDEX IF NOT EXISTS idx_tickets_claim_status ON tickets(claim_status)`);

// --- Same idea for ticket_lots: databases created before lot_id/lot_seed
// existed get them backfilled here, safe to run every boot.
const existingLotColumns = new Set(db.prepare(`PRAGMA table_info(ticket_lots)`).all().map((c) => c.name));
const lotColumnDefs = { lot_id: `TEXT`, lot_seed: `TEXT` };
for (const [column, definition] of Object.entries(lotColumnDefs)) {
  if (!existingLotColumns.has(column)) {
    db.exec(`ALTER TABLE ticket_lots ADD COLUMN ${column} ${definition}`);
  }
}
// Backfill lot_id for any pre-existing lots that don't have one yet, so the
// unique index below never sees a clash between two intentionally-blank values.
for (const row of db.prepare(`SELECT lote FROM ticket_lots WHERE lot_id IS NULL`).all()) {
  db.prepare(`UPDATE ticket_lots SET lot_id = ? WHERE lote = ?`).run(crypto.randomUUID(), row.lote);
}

export function logAudit(event, { orderId = null, wallet = null, ip = null, userAgent = null, detail = null } = {}) {
  db.prepare(
    `INSERT INTO audit_log (event, order_id, wallet, ip, user_agent, detail) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(event, orderId, wallet, ip, userAgent, detail ? JSON.stringify(detail) : null);
}

// --- Ticket batch seeding -------------------------------------------------
// Each lot gets EXACTLY the prize counts defined in config.PRIZES (e.g. 30
// tickets at 0.02 SOL, 1 at 1 SOL, 1 at 2 SOL, 1 at 5 SOL) — not a
// probability. We build one slot per prize, pad every remaining slot with
// zero, and shuffle the whole thing with crypto-secure randomness. Because
// there is only ever one slot for a 5 SOL prize to begin with, it is
// mechanically impossible for a lot to end up with two of them (same logic
// covers the single 2 SOL and single 1 SOL guarantees). Every ticket's
// outcome is fixed and hash-committed the moment it's generated — never
// decided at reveal time.
function buildPrizeSlots(totalCount, lotSeed) {
  const winningSlots = [];
  for (const prize of PRIZES) {
    for (let i = 0; i < prize.count; i++) {
      winningSlots.push({ label: prize.label, lamports: Math.round(prize.sol * 1e9) });
    }
  }

  shuffleInPlace(winningSlots, lotSeed);
  // Only relevant for tiny/test lots smaller than the prize pool itself —
  // in production LOT_SIZE (20,000) always comfortably exceeds it.
  const slots = winningSlots.slice(0, Math.min(winningSlots.length, totalCount));
  while (slots.length < totalCount) slots.push({ label: '0', lamports: 0 });

  shuffleInPlace(slots, lotSeed); // shuffle again so winners aren't clustered up front
  return slots;
}

// Fisher-Yates using Node's CSPRNG — the lotSeed is stored alongside the lot
// for audit/transparency but isn't itself the randomness source (crypto's
// own RNG is), so nothing about the shuffle is predictable from the seed alone.
function shuffleInPlace(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

export function generateTickets(batchKey, count, lotSeed = crypto.randomBytes(16).toString('hex')) {
  const slots = buildPrizeSlots(count, lotSeed);

  const insert = db.prepare(`
    INSERT INTO tickets (uuid, batch, prize_lamports, prize_label, seed, hash, status)
    VALUES (?, ?, ?, ?, ?, ?, 'AVAILABLE')
  `);

  const insertMany = db.transaction((n) => {
    for (let i = 0; i < n; i++) {
      const uuid = crypto.randomUUID();
      const prize = slots[i];
      const seed = crypto.randomBytes(16).toString('hex');
      const hash = crypto
        .createHash('sha256')
        .update(`${batchKey}:${uuid}:${prize.label}:${lotSeed}:${seed}`)
        .digest('hex');
      insert.run(uuid, batchKey, prize.lamports, prize.label, seed, hash);
    }
  });
  insertMany(count);
  return count;
}

