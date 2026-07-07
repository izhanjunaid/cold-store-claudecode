import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { PrismaClient } from '@coldchain/db';
import { requestContext } from '../common/request-context';

const prisma = new PrismaClient();

// Interactive transactions stamp the acting user/facility into
// transaction-local GUCs so the DB audit triggers can attribute changes
// (audit finding F-2b). Sequential (array-form) transactions pass through
// untouched — no financial mutation path uses them.
const origTransaction = prisma.$transaction.bind(prisma);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(prisma as any).$transaction = (arg: any, opts?: any) => {
  if (typeof arg !== 'function') {
    return origTransaction(arg, opts);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return origTransaction(async (tx: any) => {
    const ctx = requestContext.getStore();
    if (ctx?.userId) {
      await tx.$executeRaw`SELECT set_config('app.user_id', ${ctx.userId}, true)`;
    }
    if (ctx?.facilityId) {
      await tx.$executeRaw`SELECT set_config('app.facility_id', ${ctx.facilityId}, true)`;
    }
    return arg(tx);
  }, opts);
};

async function facilityScope(app: FastifyInstance) {
  // Make prisma available on the app instance
  app.decorate('prisma', prisma);

  // Enter the request-scoped audit context. Callback-style hook so the
  // AsyncLocalStorage store propagates to every downstream hook/handler.
  app.addHook('onRequest', (request, _reply, done) => {
    const facilityId = request.headers['x-facility-id'] as string | undefined;
    requestContext.run({ facilityId }, done);
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
