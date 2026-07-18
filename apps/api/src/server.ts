import { buildApp } from './app';
import { startNotificationScheduler } from './modules/notifications/scheduler';
import { validateEnv } from './common/env';

async function start() {
  validateEnv(process.env, console);

  const app = await buildApp();

  // Background daily-digest timer (no-op under test/reset envs). Registered
  // before listen(): Fastify forbids adding hooks once the instance is listening.
  const scheduler = startNotificationScheduler(app);
  app.addHook('onClose', async () => {
    if (scheduler) clearInterval(scheduler);
  });

  try {
    const port = Number(process.env['PORT']) || 3001;
    const address = await app.listen({ port, host: '0.0.0.0' });
    console.log(`ColdChain API server listening at ${address}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
