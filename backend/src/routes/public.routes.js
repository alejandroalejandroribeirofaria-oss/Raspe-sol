import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { prisma } from '../config/prisma.js';
import { TICKET_PRICE_LAMPORTS } from '../constants.js';
import { getBatchStats, ensureOpenBatch } from '../services/batch.service.js';
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
import axios from 'axios';

export const publicRouter = Router(); // <- TEM QUE VIR PRIMEIRO

const purchaseSchema = z.object({
  wallet: z.string().min(32),
  signature: z.string().min(64),
  quantity: z.coerce.number().int().positive().optional(),
  cluster: z.enum(['devnet', 'mainnet-beta']).optional()
});

const scratchSchema = z.object({
  wallet: z.string().min(32)
});

const createBatchSchema = z.object({
  number: z.coerce.number().int().positive()
});

// NOVA ROTA PRECO
publicRouter.get('/preco', asyncHandler(async (_req, res) => {
  const { data } = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=brl,usd');
  res.json({ 
    solBRL: data.solana.brl,
    solUSD: data.solana.usd,
    fonte: "CoinGecko"
  }); // <- fechei aqui
}));

// ROTAS QUE FALTAVAM
publicRouter.get('/batches', asyncHandler(async (_req, res) => {
  const batches = await prisma.batch.findMany({ 
    orderBy: { number: 'desc' },
    include: { _count: { select: { tickets: true } } } // <- adicionei 1 } 
  });
  res.json(serializeBigInt(batches));
}));

publicRouter.post('/batches', asyncHandler(async (req, res) => {
  const parsed = createBatchSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'Invalid batch payload', parsed.error.flatten());

  const batch = await prisma.batch.create({
    data: { number: parsed.data.number, status: 'OPEN' }
  });
  res.status(201).json(serializeBigInt(batch));
}));

publicRouter.post('/batches/ensure-open', asyncHandler(async (_req, res) => {
  const batch = await ensureOpenBatch();
  res.json(serializeBigInt(batch));
}));

// SUAS ROTAS ANTIGAS
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
