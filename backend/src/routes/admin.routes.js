import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../middleware/adminAuth.js';
import {
  createAutomaticBatch,
  createManualBatch,
  dashboardStats,
  exportReport,
  markPrizePaid,
  searchTickets
} from '../services/admin.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { HttpError } from '../utils/httpError.js';
import { serializeBigInt } from '../utils/serialize.js';

export const adminRouter = Router();

adminRouter.use(requireAdmin);

// ======================= SCHEMAS =======================
const searchSchema = z.object({
  uuid: z.string().uuid().optional(),
  wallet: z.string().min(32).optional(),
  batch: z.coerce.number().int().positive().optional()
});

const createBatchSchema = z.object({
  type: z.enum(['manual', 'auto']).default('auto')
});

// ======================= ROTAS =======================

adminRouter.get('/stats', asyncHandler(async (_req, res) => {
  res.json(serializeBigInt(await dashboardStats()));
}));

/**
 * Cria um novo batch (manual ou automático)
 * POST /admin/create-batch
 * Body: { "type": "manual" | "auto" } → opcional (padrão: auto)
 */
adminRouter.post('/create-batch', asyncHandler(async (req, res) => {
  const parsed = createBatchSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(400, 'Tipo de batch inválido', parsed.error.flatten());
  }

  const { type } = parsed.data;
  const batchData = { ip: req.ip };

  const batch = type === 'manual'
    ? await createManualBatch(batchData)
    : await createAutomaticBatch(batchData);

  res.status(201).json(serializeBigInt(batch));
}));

adminRouter.get('/tickets/search', asyncHandler(async (req, res) => {
  const parsed = searchSchema.safeParse(req.query);
  if (!parsed.success) {
    throw new HttpError(400, 'Invalid search query', parsed.error.flatten());
  }
  res.json(serializeBigInt(await searchTickets(parsed.data)));
}));

adminRouter.post('/tickets/:uuid/pay', asyncHandler(async (req, res) => {
  res.json(serializeBigInt(await markPrizePaid({ 
    uuid: req.params.uuid, 
    ip: req.ip 
  })));
}));

adminRouter.get('/report.csv', asyncHandler(async (_req, res) => {
  const csv = await exportReport();
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="raspe-sol-report.csv"');
  res.send(csv);
}));
