import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { AppError } from '../common/errors';

async function errorHandler(app: FastifyInstance) {
  app.setErrorHandler((error: Error & { validation?: unknown; statusCode?: number }, _request, reply) => {
    // Zod validation errors
    if (error.validation) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: error.message,
        },
      });
    }

    // App errors
    if (error instanceof AppError) {
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

    // Rate limit errors
    if (error.statusCode === 429) {
      return reply.status(429).send({
        success: false,
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests. Please slow down.',
        },
      });
    }

    // Framework errors that already carry a client (4xx) status — e.g. malformed
    // or empty JSON body (FST_ERR_CTP_EMPTY_JSON_BODY), unsupported media type.
    // Honour their status instead of masking a 4xx as a 500.
    if (typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500) {
      return reply.status(error.statusCode).send({
        success: false,
        error: {
          code: (error as { code?: string }).code || 'BAD_REQUEST',
          message: error.message,
        },
      });
    }

    // A database CHECK the code did not anticipate (e.g. lots_current_balance_nonnegative):
    // the request conflicts with the data, not a server fault. Prisma surfaces it
    // either as a known request error carrying the SQLSTATE or as raw text.
    if (isCheckViolation(error)) {
      app.log.warn(error);
      return reply.status(409).send({
        success: false,
        error: {
          code: 'CONSTRAINT_VIOLATION',
          message: 'This change would break a data rule (for example, a lot balance below zero) and was refused.',
        },
      });
    }

    // Unknown errors
    app.log.error(error);
    return reply.status(500).send({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Unexpected server error',
      },
    });
  });
}

function isCheckViolation(error: unknown): boolean {
  const e = error as { code?: string; meta?: { code?: string }; message?: string };
  if (e?.meta?.code === '23514') return true;
  return typeof e?.message === 'string' && /\b23514\b|violates check constraint/.test(e.message);
}

export default fp(errorHandler);
