import { serializeBigInt } from '../utils/serialize.js';

export function notFound(_req, _res, next) {
  const error = new Error('Route not found');
  error.status = 404;
  next(error);
}

export function errorHandler(error, _req, res, _next) {
  const status = error.status || 500;
  const payload = {
    error: {
      message: status === 500 ? 'Internal server error' : error.message,
      details: error.details
    }
  };

  if (status === 500) {
    console.error(error);
  }

  res.status(status).json(serializeBigInt(payload));
}

