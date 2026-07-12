import { Router } from 'express';
import { config } from '../config.js';
import {
  getPrimaryLot,
  getSellableLots,
  getLotHistory,
  totalAvailableTickets,
  getLotOverview,
  getGlobalStats,
} from '../services/lotService.js';
import { getChatStats, clearAllMessages, blockWallet } from '../services/chatService.js';
import { getOnlineCount, getOnlineWallets } from '../services/presenceService.js';
import { kickWallet } from '../services/chatHub.js';
import { listClaims, markClaimPaid, ClaimError } from '../services/claimService.js';

const router = Router();

function requireAdmin(req, res, next) {
  if (!config.adminToken) {
    return res.status(503).json({ error: 'ADMIN_NOT_CONFIGURED', message: 'Set ADMIN_TOKEN to enable the admin API.' });
  }
  if (req.get('x-admin-token') !== config.adminToken) {
    return res.status(401).json({ error: 'UNAUTHORIZED' });
  }
  next();
}

router.use(requireAdmin);

router.get('/dashboard', (_req, res) => {
  const primary = getPrimaryLot();
  const history = getLotHistory();
  const sellable = getSellableLots();

  res.json({
    currentLot: primary && {
      lote: primary.lote,
      quantidadeInicial: primary.quantidade_inicial,
      quantidadeDisponivel: primary.quantidade_disponivel,
      vendidos: primary.quantidade_inicial - primary.quantidade_disponivel,
      ativo: !!primary.ativo,
      criadoEm: primary.criado_em,
      encerradoEm: primary.encerrado_em,
    },
    totalTicketsDisponiveisAgora: totalAvailableTickets(),
    lotesVendendoSimultaneamente: sellable.map((l) => l.lote),
    proximoLote: primary ? primary.lote + 1 : 1,
    historico: history.map((l) => ({
      lote: l.lote,
      quantidadeInicial: l.quantidade_inicial,
      quantidadeDisponivel: l.quantidade_disponivel,
      vendidos: l.quantidade_inicial - l.quantidade_disponivel,
      ativo: !!l.ativo,
      criadoEm: l.criado_em,
      encerradoEm: l.encerrado_em,
    })),
    // Additive — existing fields above are untouched, this just adds the
    // all-time totals shown on the main dashboard.
    stats: getGlobalStats(),
  });
});

// --- Lotes (detailed lot economics for the admin "Lotes" page) -----------

router.get('/lots', (_req, res) => {
  const primary = getPrimaryLot();
  const history = getLotHistory();
  const finished = history.filter((l) => !l.ativo);

  res.json({
    activeLot: getLotOverview(primary),
    lotesFinalizados: finished.map(getLotOverview),
  });
});

// --- Chat moderation ---------------------------------------------------

router.get('/chat', (_req, res) => {
  res.json({
    onlineCount: getOnlineCount(),
    onlineWallets: getOnlineWallets(),
    ...getChatStats(),
  });
});

router.post('/chat/clear', (_req, res) => {
  const removed = clearAllMessages();
  res.json({ removed });
});

router.post('/chat/kick', (req, res) => {
  const { wallet } = req.body ?? {};
  if (!wallet) return res.status(400).json({ error: 'INVALID_WALLET' });
  const closed = kickWallet(wallet);
  res.json({ wallet, connectionsClosed: closed });
});

router.post('/chat/block', (req, res) => {
  const { wallet, minutes, reason } = req.body ?? {};
  if (!wallet) return res.status(400).json({ error: 'INVALID_WALLET' });
  const mins = Number(minutes) > 0 ? Number(minutes) : 60;
  blockWallet(wallet, mins, reason || null);
  kickWallet(wallet, 'You have been temporarily blocked from chat by an administrator.');
  res.json({ wallet, blockedForMinutes: mins });
});

// --- Prize claims (manual payout) ---------------------------------------
// This never moves any SOL — the admin pays the winner manually, from their
// own wallet, entirely outside this system. These routes only organize the
// queue and record who marked what as paid, when, and from which IP.

router.get('/claims', (req, res) => {
  const status = ['PENDING', 'PAID'].includes(req.query.status) ? req.query.status : undefined;
  res.json({ claims: listClaims({ status }) });
});

router.post('/claims/:ticketUuid/mark-paid', (req, res) => {
  try {
    const claim = markClaimPaid({
      ticketUuid: req.params.ticketUuid,
      admin: req.body?.admin,
      ip: req.ip,
    });
    res.json({ claim });
  } catch (err) {
    if (err instanceof ClaimError) {
      return res.status(err.httpStatus).json({ error: err.code, message: err.message });
    }
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

export default router;

