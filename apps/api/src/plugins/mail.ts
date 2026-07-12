import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { MailService, type TransportFactory } from '../modules/mail/mail.service';

// Decorates the app with a shared MailService so controllers/services send
// email through one place. Tests pass a fake transportFactory to capture sends.
interface MailPluginOptions {
  transportFactory?: TransportFactory;
}

async function mailPlugin(app: FastifyInstance, opts: MailPluginOptions) {
  app.decorate('mailService', new MailService(opts.transportFactory));
}

export default fp(mailPlugin);

declare module 'fastify' {
  interface FastifyInstance {
    mailService: MailService;
  }
}
