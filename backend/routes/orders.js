import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  createOrder,
  confirmPayment,
  revealTicket,
  getOrder,
  getOrderTickets,
  OrderError,
} from '../services/orderService.js';
import { watchSignature } from '../services/solanaVerify.js';
import { broadcastOrderUpdate } from '../services/wsHub.js';
import { getClaimStatus, getTicketsForWallet } from '../services/claimService.js';

const router = Router();

// Simple per-IP throttling on order creation and confirmation to blunt
// scripted abuse / ticket-hoarding attempts.
const createLimiter = rateLimit({ windowMs: 60_000, max: 20 });
const confirmLimiter = rateLimit({ windowMs: 60_000, max: 30 });

function clientMeta(req) {
  return { ip: req.ip, userAgent: req.get('user-agent') || null };
}

router.post('/orders', createLimiter, (req, res) => {
  try {
    const order = createOrder({ wallet: req.body?.wallet, quantity: req.body?.quantity ?? 1 });
    res.status(201).json(order);
  } catch (err) {
    if (err instanceof OrderError) {
      return res.status(err.httpStatus).json({ error: err.code, message: err.message });
    }
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

router.get('/orders/:orderId', (req, res) => {
  const order = getOrder(req.params.orderId);
  if (!order) return res.status(404).json({ error: 'ORDER_NOT_FOUND' });
  res.json(order);
});

router.get('/orders/:orderId/tickets', (req, res) => {
  const order = getOrder(req.params.orderId);
  if (!order) return res.status(404).json({ error: 'ORDER_NOT_FOUND' });
  const tickets = getOrderTickets(req.params.orderId).map((t) => ({
    uuid: t.uuid,
    status: t.status,
    prizeLabel: t.status === 'REVEALED' ? t.prize_label : null,
    prizeLamports: t.status === 'REVEALED' ? t.prize_lamports : null,
  }));
  res.json({ tickets });
});

// Called by the frontend right after Phantom returns a transaction signature.
// Now waits for on-chain confirmation before processing payment.
router.post('/orders/:orderId/confirm', confirmLimiter, async (req, res) => {
  const { orderId } = req.params;
  const { signature, wallet } = req.body ?? {};
  const { ip, userAgent } = clientMeta(req);

  try {
    // 1. ESPERA A REDE CONFIRMAR PRIMEIRO
    await new Promise((resolve, reject) => {
      watchSignature(signature, {
        onConfirmed: resolve,
        onTimeout: () => reject(new Error('TIMEOUT'))
      });
    });

    // 2. Agora sim verifica o pagamento
    const { order, tickets, alreadyPaid } = await confirmPayment({ orderId, signature, wallet, ip, userAgent });
    broadcastOrderUpdate(orderId, { status: 'PAID', txSignature: order.tx_signature, grantedQty: order.granted_qty });
    
    return res.json({
      status: 'PAID',
      alreadyPaid,
      order,
      tickets: tickets.map((t) => t.uuid),
    });
  } catch (err) {
    if (err instanceof OrderError) {
      broadcastOrderUpdate(orderId, { status: 'REJECTED', reason: err.code });
      return res.status(err.httpStatus).json({ error: err.code, message: err.message });
    }
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// Optional: register a live watch so the client gets a push the instant the
// cluster confirms, instead of relying purely on the confirm endpoint's poll.
router.post('/orders/:orderId/watch', (req, res) => {
  const { signature } = req.body ?? {};
  if (!signature) return res.status(400).json({ error: 'MISSING_SIGNATURE' });

  watchSignature(signature, {
    onConfirmed: () => broadcastOrderUpdate(req.params.orderId, { status: 'CONFIRMED_ONCHAIN' }),
    onTimeout: (err) => broadcastOrderUpdate(req.params.orderId, { status: 'WATCH_TIMEOUT', reason: err.message }),
  });

  res.status(202).json({ watching: true });
});

router.post('/tickets/:ticketUuid/reveal', (req, res) => {
  try {
    const ticket = revealTicket({ ticketUuid: req.params.ticketUuid, wallet: req.body?.wallet });
    res.json({
      uuid: ticket.uuid,
      prizeLabel: ticket.prize_label,
      prizeLamports: ticket.prize_lamports,
      hash: ticket.hash,
      // Additive field only — doesn't change anything about how the reveal
      // or prize itself works, just tells the frontend whether a manual
      // payout is now pending so it can show the right screen immediately.
      claimStatus: getClaimStatus(ticket.uuid),
    });
  } catch (err) {
    if (err instanceof OrderError) {
      return res.status(err.httpStatus).json({ error: err.code, message: err.message });
    }
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// "Meus Bilhetes" — read-only history for the connected wallet, including
// each ticket's manual-claim status. Nothing here can be written by the
// frontend; claim_status only ever changes via the admin-token-gated routes.
router.get('/tickets/mine', (req, res) => {
  const wallet = req.query.wallet;
  if (!wallet || typeof wallet !== 'string') {
    return res.status(400).json({ error: 'INVALID_WALLET', message: 'wallet query param is required.' });
  }
  res.json({ tickets: getTicketsForWallet(wallet) });
});

export default router;
