import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { isBlindRole, redactBagCounts } from '../common/blind-count';

/**
 * The gate guard counts bags blind: strip stock quantities from every JSON response they are
 * sent (common/blind-count.ts). Runs on all routes, the guard's own POST replies included.
 * Register it after authPlugin (it reads request.user) and in the test app too.
 */
async function blindRedactionPlugin(app: FastifyInstance) {
  app.addHook('preSerialization', async (request, _reply, payload) =>
    isBlindRole(request.user?.role) ? redactBagCounts(payload) : payload,
  );
}

export default fp(blindRedactionPlugin);
