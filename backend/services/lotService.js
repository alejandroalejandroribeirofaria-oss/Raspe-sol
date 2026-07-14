import crypto from 'crypto';
import { db, generateTickets, logAudit } from '../db.js';
import { config, PRIZES, TICKET_PRICE_LAMPORTS } from '../config.js';

/**
 * Ensures at least one lot exists. Called once at boot — if the DB is
 * fresh, lot #1 is created with `lotSize` tickets; if lots already exist
 * (server restarted), nothing happens, so state survives restarts exactly
 * as it was.
 */
export function ensureInitialLot() {
  const count = db.prepare(`SELECT COUNT(*) AS c FROM ticket_lots`).get().c;
  if (count > 0) return { created: false };
  const lot = createLot(config.lotSize);
  return { created: true, lot };
}

function createLot(size) {
  const nextLote = (db.prepare(`SELECT MAX(lote) AS m FROM ticket_lots`).get().m || 0) + 1;
  const batchKey = `lot-${nextLote}`;
  const lotId = crypto.randomUUID();
  const lotSeed = crypto.randomBytes(16).toString('hex');

  const insertLot = db.transaction(() => {
    db.prepare(
      `INSERT INTO ticket_lots (lote, lot_id, batch_key, quantidade_inicial, quantidade_disponivel, lot_seed, ativo)
       VALUES (?, ?, ?, ?, ?, ?, 1)`
    ).run(nextLote, lotId, batchKey, size, size, lotSeed);
    generateTickets(batchKey, size, lotSeed);
  });
  insertLot();

  logAudit('LOT_CREATED', { detail: { lote: nextLote, lotId, batchKey, size } });
  return getLotByNumber(nextLote);
}

export function getLotByNumber(lote) {
  return db.prepare(`SELECT * FROM ticket_lots WHERE lote = ?`).get(lote);
}

/** The most recently created lot — shown as "Lote Atual" in the admin dashboard. */
export function getPrimaryLot() {
  return db.prepare(`SELECT * FROM ticket_lots ORDER BY lote DESC LIMIT 1`).get();
}

/** Every lot still selling, oldest first — old stock is depleted before new stock. */
export function getSellableLots() {
  return db
    .prepare(`SELECT * FROM ticket_lots WHERE ativo = 1 AND quantidade_disponivel > 0 ORDER BY lote ASC`)
    .all();
}

export function totalAvailableTickets() {
  return db.prepare(`SELECT COALESCE(SUM(quantidade_disponivel), 0) AS c FROM ticket_lots WHERE ativo = 1`).get().c;
}

export function getLotHistory() {
  return db.prepare(`SELECT * FROM ticket_lots ORDER BY lote DESC`).all();
}

/**
 * Claims `count` tickets across whichever lots are currently sellable,
 * oldest lot first, spilling into the next lot if one runs out mid-request.
 * MUST be called from inside the caller's db.transaction (orderService
 * wraps the whole purchase in one) so ticket claiming and lot bookkeeping
 * commit or roll back together — there is no window where a ticket is SOLD
 * but its lot's counter wasn't decremented, or vice versa.
 */
export function claimTicketsAcrossLots({ count, wallet, orderId }) {
  const claimed = [];
  let remaining = count;

  const lots = getSellableLots();
  const markSold = db.prepare(`UPDATE tickets SET status = 'SOLD', owner_wallet = ?, order_id = ? WHERE uuid = ?`);

  for (const lot of lots) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, lot.quantidade_disponivel);
    const rows = db
      .prepare(`SELECT uuid FROM tickets WHERE batch = ? AND status = 'AVAILABLE' ORDER BY RANDOM() LIMIT ?`)
      .all(lot.batch_key, take);
    if (rows.length === 0) continue;

    for (const row of rows) markSold.run(wallet, orderId, row.uuid);
    claimed.push(...rows.map((r) => r.uuid));
    remaining -= rows.length;

    const newAvailable = lot.quantidade_disponivel - rows.length;
    db.prepare(`UPDATE ticket_lots SET quantidade_disponivel = ? WHERE lote = ?`).run(newAvailable, lot.lote);

    settleLotThresholds({ ...lot, quantidade_disponivel: newAvailable });
  }

  return claimed;
}

/**
 * After a claim, decides whether this lot needs to be closed (empty) and/or
 * whether the next lot needs to be spun up (low watermark reached). Both
 * checks run every time a lot is touched, so the rollover requires no cron
 * job or manual step — it's a direct consequence of tickets being sold.
 */
function settleLotThresholds(lot) {
  if (lot.quantidade_disponivel <= 0) {
    db.prepare(`UPDATE ticket_lots SET ativo = 0, encerrado_em = datetime('now') WHERE lote = ?`).run(lot.lote);
    logAudit('LOT_CLOSED', { detail: { lote: lot.lote } });
  }

  const isPrimary = getPrimaryLot()?.lote === lot.lote;
  const nextAlreadyExists = !!getLotByNumber(lot.lote + 1);
  if (isPrimary && !nextAlreadyExists && lot.quantidade_disponivel <= config.lotLowWatermark) {
    createLot(config.lotSize);
  }
}

/**
 * How many still-AVAILABLE (unsold) tickets remain in this lot for each
 * prize tier — i.e. "how many big wins are still sitting in the box."
 * Categories with zero remaining are still included, at count 0.
 */
export function getPrizeInventoryForLot(batchKey) {
  const rows = db
    .prepare(
      `SELECT prize_label, COUNT(*) AS remaining
       FROM tickets
       WHERE batch = ? AND status = 'AVAILABLE' AND prize_lamports > 0
       GROUP BY prize_label`
    )
    .all(batchKey);
  const byLabel = Object.fromEntries(rows.map((r) => [r.prize_label, r.remaining]));
  return PRIZES.map((p) => ({ label: p.label, sol: p.sol, remaining: byLabel[p.label] || 0 }));
}

/** The fixed prize pool baked into every lot at creation — constant, no DB query needed. */
export function getPrizePoolSol() {
  return PRIZES.reduce((sum, p) => sum + p.sol * p.count, 0);
}

/** Rich per-lot view for the admin "Lotes" page: sales, revenue estimate, prize inventory. */
export function getLotOverview(lot) {
  if (!lot) return null;
  const sold = lot.quantidade_inicial - lot.quantidade_disponivel;
  return {
    lote: lot.lote,
    lotId: lot.lot_id,
    batchKey: lot.batch_key,
    quantidadeInicial: lot.quantidade_inicial,
    quantidadeDisponivel: lot.quantidade_disponivel,
    vendidos: sold,
    percentualVendido: lot.quantidade_inicial > 0 ? Math.round((sold / lot.quantidade_inicial) * 1000) / 10 : 0,
    receitaEstimadaSol: (sold * TICKET_PRICE_LAMPORTS) / 1e9,
    valorTotalDistribuidoSol: getPrizePoolSol(),
    ativo: !!lot.ativo,
    status: lot.ativo ? 'ACTIVE' : 'FINISHED',
    criadoEm: lot.criado_em,
    encerradoEm: lot.encerrado_em,
    premiosRestantes: getPrizeInventoryForLot(lot.batch_key),
  };
}

/** Global, all-lots-ever stats for the main admin dashboard. */
export function getGlobalStats() {
  const lotesCriados = db.prepare(`SELECT COUNT(*) AS c FROM ticket_lots`).get().c;
  const lotesFinalizados = db.prepare(`SELECT COUNT(*) AS c FROM ticket_lots WHERE ativo = 0`).get().c;
  const ticketsVendidos = db.prepare(`SELECT COUNT(*) AS c FROM tickets WHERE status IN ('SOLD', 'REVEALED')`).get().c;
  const ticketsRestantes = totalAvailableTickets();
  // True accumulated revenue, from actual on-chain-verified payments — not
  // an estimate, unlike the per-lot figure (which can't be attributed
  // precisely to one lot when a single order spans two lots).
  const totalArrecadadoLamports = db.prepare(`SELECT COALESCE(SUM(amount_lamports), 0) AS s FROM processed_transactions`).get().s;
  const totalPagoEmPremiosLamports = db
    .prepare(`SELECT COALESCE(SUM(prize_lamports), 0) AS s FROM tickets WHERE claim_status = 'PAID'`)
    .get().s;

  return {
    lotesCriados,
    lotesFinalizados,
    ticketsVendidos,
    ticketsRestantes,
    totalArrecadadoSol: totalArrecadadoLamports / 1e9,
    totalPagoEmPremiosSol: totalPagoEmPremiosLamports / 1e9,
  };
}

