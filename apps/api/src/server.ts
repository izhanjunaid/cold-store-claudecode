import { buildApp } from './app';

async function start() {
  const app = await buildApp();

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
