import type { FastifyReply } from 'fastify';
import { AppError } from './errors';

export function sendSuccess<T>(reply: FastifyReply, data: T, meta?: { page: number; per_page: number; total: number }) {
  const response: { success: true; data: T; meta?: typeof meta } = { success: true, data };
  if (meta) response.meta = meta;
  return reply.send(response);
}

export function sendError(reply: FastifyReply, error: AppError) {
  const response: { success: false; error: { code: string; message: string; field?: string } } = {
    success: false,
    error: {
      code: error.code,
      message: error.message,
    },
  };
  if (error.field) response.error.field = error.field;
  return reply.status(error.statusCode).send(response);
}
