import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import helmet from 'helmet';

dotenv.config();

import healthRouter from './api/routes/health';
import instancesRouter from './api/routes/instances';
import messagesRouter from './api/routes/messages';
import chatsRouter from './api/routes/chats';
import webhookRouter from './api/routes/webhook';
import discoverRouter from './api/routes/discover';
import mediaRouter from './api/routes/media';
import adminRouter from './api/routes/admin';
import { logger } from './utils/logger';
import { webhookService } from './services/webhook.service';
import { instanceManager } from './client/instance-manager';
import { settingsService } from './services/settings.service';
import { assertStrongApiKey } from './utils/validation';
import { globalRateLimit } from './api/middleware/rate-limit';

const app = express();

function configureWebhookFromSettings(): void {
  const settings = settingsService.get();
  const webhookUrl = settings.webhook.url;
  if (!webhookUrl) {
    webhookService.configure(null);
    logger.info('Webhook disabled');
    return;
  }

  webhookService.configure({
    url: settings.webhook.url,
    events: settings.webhook.events as any[],
    secret: settings.webhook.secret || undefined,
    timeoutMs: settings.webhook.timeoutMs,
    maxRetries: settings.webhook.maxRetries,
  });
  logger.info({ url: webhookUrl }, 'Webhook configured');
}

function validateStartupSecurity(): void {
  const settings = settingsService.get();
  const nodeEnv = process.env.NODE_ENV || 'development';
  const enforceStrong = nodeEnv === 'production' && settings.security.securityMode !== 'relaxed';

  if (enforceStrong) {
    assertStrongApiKey(settings.security.apiKey);
  }
}

async function start(): Promise<void> {
  await settingsService.initialize();
  validateStartupSecurity();
  configureWebhookFromSettings();

  settingsService.subscribe(() => {
    configureWebhookFromSettings();
  });

  const settings = settingsService.get();
  const PORT = parseInt(process.env.PORT || '3000', 10);
  const HOST = process.env.HOST || '0.0.0.0';

  app.set('trust proxy', 1);
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(globalRateLimit);
  app.use(
    cors((req, callback) => {
      const origin = req.header('Origin');
      const allowed = settingsService.get().security.allowedOrigins;
      const currentOrigin = `${req.protocol}://${req.get('host')}`;

      if (!origin || origin === currentOrigin || (allowed.length > 0 && allowed.includes(origin))) {
        callback(null, { origin: true, credentials: true });
        return;
      }

      callback(new Error('CORS origin denied'));
    }),
  );
  app.use(express.json({ limit: settings.security.maxBodySize }));
  app.use(express.urlencoded({ extended: true, limit: settings.security.maxBodySize }));

  // Routes
  app.use('/api/health', healthRouter);
  app.use('/api/instances', instancesRouter);
  app.use('/api/messages', messagesRouter);
  app.use('/api/chats', chatsRouter);
  app.use('/api/webhook', webhookRouter);
  app.use('/api/discover', discoverRouter);
  app.use('/api/media', mediaRouter);
  app.use('/api/admin', adminRouter);
  app.use('/admin', adminRouter);

  // Root
  app.get('/', (_req, res) => {
    res.json({ name: 'LivZap', version: '0.1.0', status: 'running' });
  });

  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err.message === 'CORS origin denied') {
      res.status(403).json({ error: 'CORS origin denied' });
      return;
    }
    logger.error({ err }, 'Unhandled API error');
    res.status(500).json({ error: 'Internal server error' });
  });

  app.listen(PORT, HOST, () => {
    logger.info({ host: HOST, port: PORT }, 'LivZap server started');
    logger.info({ url: `http://localhost:${PORT}/api/health` }, 'Health check URL');
  });
}

void start().catch((err) => {
  logger.error({ err }, 'Failed to start LivZap server');
  process.exit(1);
});

async function shutdown(): Promise<void> {
  logger.info('Shutting down...');
  await instanceManager.shutdownAll();
  process.exit(0);
}

process.on('SIGTERM', () => {
  void shutdown();
});

process.on('SIGINT', () => {
  void shutdown();
});

export default app;
