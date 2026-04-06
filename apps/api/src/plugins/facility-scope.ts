import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { PrismaClient } from '@coldchain/db';

const prisma = new PrismaClient();

async function facilityScope(app: FastifyInstance) {
  // Make prisma available on the app instance
  app.decorate('prisma', prisma);

  // Set facility_id in PG session for RLS on every request
  app.addHook('onRequest', async (request) => {
    const facilityId = request.headers['x-facility-id'] as string | undefined;
    if (facilityId) {
      await prisma.$executeRawUnsafe(
        `SET LOCAL app.facility_id = '${facilityId}'`,
      );
    }
  });

  // Graceful shutdown
  app.addHook('onClose', async () => {
    await prisma.$disconnect();
  });
}

export default fp(facilityScope);

// Type augmentation
declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}
