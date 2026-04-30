import pino from 'pino';
import path from 'path';
import fs from 'fs';

const isDevelopment = (process.env.NODE_ENV || 'development') === 'development';
const logDir = process.env.LOG_DIR || path.join(process.cwd(), 'logs');
const logLevel = process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info');

if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const baseConfig: pino.LoggerOptions = {
  level: logLevel,
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
};

export const logger = isDevelopment
  ? pino({
      ...baseConfig,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      },
    })
  : pino(
      baseConfig,
      pino.destination({
        dest: path.join(logDir, 'combined.log'),
        sync: false,
      }),
    );

export const whatsappLogger = logger.child({ module: 'whatsapp' });
export const apiLogger = logger.child({ module: 'api' });
export const webhookLogger = logger.child({ module: 'webhook' });
export const discoverLogger = logger.child({ module: 'discover' });
