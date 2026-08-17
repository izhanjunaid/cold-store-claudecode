import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { PrismaClient } from '@coldchain/db';
import { requestContext } from '../common/request-context';

/**
 * Request-scoped database context.
 *
 * Two features of the schema depend on PostgreSQL session settings being present
 * on the connection that runs a statement:
 *
 *   * **Row-level security.** `facilities`, `users`, `refresh_tokens`, `audit_log`
 *     and `otp_codes` carry policies of the form
 *     `USING (facility_id = current_setting('app.facility_id', true)::uuid)`.
 *   * **Audit attribution.** `audit_trigger_fn` reads `app.user_id`, falling back
 *     to the zero uuid when it is unset.
 *
 * Until now those settings were stamped only inside *interactive* transactions.
 * Every plain `findUnique`/`create` therefore ran with neither set, which broke
 * both features at once and stayed invisible for months because:
 *
 *   * the integration suite connects as the database OWNER, and a table owner
 *     bypasses RLS entirely (the policies are ENABLE, not FORCE); and
 *   * the app only became a non-owner with the F-2a least-privilege role, so the
 *     first genuinely restricted deployment was also the first to fail — it could
 *     not read `users` at all, making login impossible on a fresh install.
 *
 * The audit side had already been caught once and half-fixed: see the note in
 * `common/request-context.ts` about finding F-2b. That fix covered interactive
 * transactions only, which is why two thirds of existing audit rows are still
 * attributed to nobody.
 *
 * The extension below closes it properly. Every model operation that carries a
 * request context runs as a two-statement **sequential** transaction: set the
 * settings, then the query. Sequential `$transaction([...])` guarantees both run
 * on one connection, and `set_config(..., true)` is transaction-local — so the
 * value is discarded at commit and can never leak to the next request that
 * borrows that pooled connection. Leaking it would be a cross-facility data
 * disclosure, i.e. worse than the bug being fixed, so the transaction-local form
 * is not optional.
 */

const base = new PrismaClient();

/**
 * Interactive transactions stamp the settings once, for the whole transaction,
 * and mark the context so the per-operation extension does not try to open a
 * second transaction inside this one. Sequential (array-form) transactions pass
 * through untouched — no financial mutation path uses them.
 */
const origTransaction = base.$transaction.bind(base);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(base as any).$transaction = (arg: any, opts?: any) => {
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
    if (!ctx) return arg(tx);
    ctx.depth = (ctx.depth ?? 0) + 1;
    try {
      return await arg(tx);
    } finally {
      ctx.depth -= 1;
    }
  }, opts);
};

const prisma = base.$extends({
  query: {
    $allModels: {
      async $allOperations({ args, query }) {
        const ctx = requestContext.getStore();

        // No request context: startup, scheduled jobs, and the unauthenticated
        // bootstrap read that resolves *which* facility this box is. Those run
        // unscoped by design — RLS still applies to them, which is why the
        // bootstrap goes through the SECURITY DEFINER `sole_facility_id()`
        // (migration 0018) rather than reading `facilities` directly.
        //
        // Already inside an interactive transaction: the settings are stamped
        // there for the whole transaction, and opening another one here would
        // fail.
        if (!ctx?.facilityId || (ctx.depth ?? 0) > 0) {
          return query(args);
        }

        const [, result] = await base.$transaction([
          base.$executeRaw`SELECT set_config('app.facility_id', ${ctx.facilityId}, true),
                                  set_config('app.user_id', ${ctx.userId ?? ''}, true)`,
          query(args),
        ]);
        return result;
      },
    },
  },
});

async function facilityScope(app: FastifyInstance) {
  // The EXTENDED client is what the app uses; nothing should reach `base`
  // directly, or it will run unscoped.
  app.decorate('prisma', prisma as unknown as PrismaClient);

  // Enter the request-scoped context. Callback-style hook so the AsyncLocalStorage
  // store propagates to every downstream hook and handler. The store is mutated in
  // place later — by the auth plugin once a JWT is verified, and by the login route
  // once it has resolved a facility for a caller that could not name one.
  app.addHook('onRequest', (request, _reply, done) => {
    const facilityId = request.headers['x-facility-id'] as string | undefined;
    requestContext.run({ facilityId }, done);
  });

  app.addHook('onClose', async () => {
    await base.$disconnect();
  });
}

export default fp(facilityScope);

// Type augmentation
declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}
