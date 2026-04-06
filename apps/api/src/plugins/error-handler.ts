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

export default fp(errorHandler);
