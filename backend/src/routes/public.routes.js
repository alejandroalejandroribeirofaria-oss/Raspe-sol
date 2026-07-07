import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { TICKET_PRICE_LAMPORTS } from '../constants.js';
import { getBatchStats } from '../services/batch.service.js';
import {
  getLeaderboard,
  getWalletTickets,
  purchaseTicket,
  scratchTicket
} from '../services/ticket.service.js';
import { assertPublicKey } from '../services/solana.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { HttpError } from '../utils/httpError.js';
import { serializeBigInt } from '../utils/serialize.js';

export const publicRouter = Router();

const purchaseSchema = z.object({
  wallet: z.string().min(32),
  signature: z.string().min(64),
  quantity: z.coerce.number().int().positive().optional(),
  cluster: z.enum(['devnet', 'mainnet-beta']).optional()
});

const scratchSchema = z.object({
  wallet: z.string().min(32)
});

publicRouter.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'raspe-sol-api' });
});

publicRouter.get('/config', (_req, res) => {
  res.json({
      ticketPriceLamports: TICKET_PRICE_LAMPORTS.toString(),
      treasuryWallet: env.TREASURY_WALLET,
      cluster: env.SOLANA_CLUSTER,
      commitment: env.SOLANA_COMMITMENT,
      requireChainConfirmation: env.REQUIRE_CHAIN_CONFIRMATION,
      maxTicketsPerPurchase: env.MAX_TICKETS_PER_PURCHASE,
      allowOverpayment: env.ALLOW_OVERPAYMENT,
      ignoreRemainder: env.IGNORE_REMAINDER
  });
});

publicRouter.get('/stats', asyncHandler(async (_req, res) => {
  res.json(serializeBigInt(await getBatchStats()));
}));

publicRouter.get('/leaderboard', asyncHandler(async (_req, res) => {
  res.json(serializeBigInt(await getLeaderboard()));
}));

publicRouter.get('/tickets', asyncHandler(async (req, res) => {
  const wallet = assertPublicKey(req.query.wallet, 'wallet');
  res.json(serializeBigInt(await getWalletTickets(wallet)));
}));

const purchaseHandler = asyncHandler(async (req, res) => {
  const parsed = purchaseSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'Invalid purchase payload', parsed.error.flatten());

  const ticket = await purchaseTicket({
    ...parsed.data,
    ip: req.ip,
    userAgent: req.get('user-agent')
  });

  res.status(201).json(serializeBigInt(ticket));
});

publicRouter.post('/purchase', purchaseHandler);
publicRouter.post('/tickets/purchase', purchaseHandler);

publicRouter.post('/tickets/:id/scratch', asyncHandler(async (req, res) => {
  const parsed = scratchSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'Invalid scratch payload', parsed.error.flatten());

  const wallet = assertPublicKey(parsed.data.wallet, 'wallet');
  const ticket = await scratchTicket({
    ticketId: req.params.id,
    wallet,
    ip: req.ip
  });

  res.json(serializeBigInt(ticket));
}));

