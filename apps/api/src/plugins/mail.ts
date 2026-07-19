import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { MailService, type TransportFactory, type FetchImpl } from '../modules/mail/mail.service';

// Decorates the app with a shared MailService so controllers/services send
// email through one place. Tests pass a fake transportFactory (SMTP sends)
// and/or fetchImpl (API-provider sends) to capture outgoing mail.
interface MailPluginOptions {
  transportFactory?: TransportFactory;
  fetchImpl?: FetchImpl;
}

async function mailPlugin(app: FastifyInstance, opts: MailPluginOptions) {
  app.decorate('mailService', new MailService(opts.transportFactory, opts.fetchImpl));
}

export default fp(mailPlugin);

declare module 'fastify' {
  interface FastifyInstance {
    mailService: MailService;
  }
}
