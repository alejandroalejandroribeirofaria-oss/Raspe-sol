import { Prisma } from '@prisma/client';
import { HttpError } from './httpError.js';

export function isUniqueConstraintError(error) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export function mapPurchasePrismaError(error) {
  if (isUniqueConstraintError(error)) {
    throw new HttpError(409, 'Transaction already used.');
  }
  throw error;
}

export function serializableTransactionOptions(extra = {}) {
  const isSqlite = String(process.env.DATABASE_URL || '').startsWith('file:');
  return {
    ...extra,
    ...(isSqlite ? {} : { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  };
}

