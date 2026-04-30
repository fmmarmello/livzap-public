# LivZap

Production-grade WhatsApp gateway. Deployable server + importable library.

Built with [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js) and hardened with auto-recovery, keepalive, multi-instance support, and newsletter messaging.

LivZap is an independent, unofficial project. Use it only for consent-based automation and integrations that comply with applicable law and platform terms.

## Features

- **Multi-instance** -- Run multiple WhatsApp sessions on one server
- **Auto-recovery** -- Handles Chromium lock files, protocol errors, session expiry
- **Keepalive** -- Prevents WhatsApp Web session timeout (5-min WebSocket ping)
- **Newsletter support** -- Send messages to WhatsApp Channels (bypasses WWebJS bug)
- **Media handling** -- Download, store, and serve media from messages
- **Webhooks** -- Forward all events to any HTTP endpoint (n8n, your API, etc.)
- **Security hardening** -- Fail-closed auth, strict ID validation, signed URL access for QR/media
- **Delivery guardrails** -- Instance queue, jitter, throughput guardrails, cooldown/backoff profiles
- **Admin UI** -- Built-in `/admin` panel for runtime configuration and operations
- **REST API** -- Full HTTP API for sending messages, managing instances, listing chats
- **Library mode** -- Import as Node.js package in any project

## Quick Start

```bash
# Clone
git clone https://github.com/fmmarmello/livzap.git livzap
cd livzap

# Install
npm install

# Configure
cp .env.example .env
# Edit .env -- set API_KEY at minimum

# Run
npm run dev
```

## Docker

```bash
# API_KEY is required in production
export API_KEY="your-strong-key-with-24+-chars"
docker compose up -d
```

The Docker image builds from source, so a clean clone does not need a committed `dist/` directory.

## Authentication

Protected endpoints require `x-api-key`:

```bash
curl -H "x-api-key: $API_KEY" http://localhost:3000/api/instances
```

## API Reference

### Instances

```bash
# List all instances
GET /api/instances

# Create new instance
POST /api/instances
{ "id": "my-bot", "headless": true }

# Get QR code image
GET /api/instances/my-bot/qr

# Get signed QR URL (short-lived)
GET /api/instances/my-bot/qr-url

# Remove instance
DELETE /api/instances/my-bot
```

### Messages

```bash
# Send text message
POST /api/messages/send
{
  "instanceId": "my-bot",
  "chatId": "5521999999999@c.us",
  "text": "Hello!"
}

# Send image
POST /api/messages/send
{
  "instanceId": "my-bot",
  "chatId": "123456@g.us",
  "text": "Check this out",
  "imageUrl": "https://example.com/image.jpg"
}

# Send to newsletter
POST /api/messages/newsletter/send
{
  "instanceId": "my-bot",
  "newsletterId": "123456789012345678",
  "text": "Channel update!",
  "imageUrl": "https://example.com/banner.jpg"
}
```

### Chats

```bash
# List groups and newsletters
GET /api/chats?instanceId=my-bot
```

### Webhooks

When configured, LivZap POSTs events to your `WEBHOOK_URL`:

```json
{
  "instanceId": "my-bot",
  "event": "message",
  "timestamp": "2026-04-14T14:30:00.000Z",
  "data": {
    "id": "...",
    "from": "5521999999999@c.us",
    "fromMe": false,
    "body": "Hello bot!",
    "type": "chat",
    "timestamp": 1713105000,
    "chatName": "My Group"
  }
}
```

Webhook headers include:
- `X-LivZap-Instance`: instance ID
- `X-LivZap-Event`: event type
- `X-LivZap-Signature`: HMAC-SHA256 signature (if WEBHOOK_SECRET set)

### Admin

- `GET /admin` -- built-in admin panel
- `POST /api/admin/login` -- short-lived admin session token
- `GET/PUT /api/admin/settings` -- view/update runtime settings persisted in `DATA_DIR/settings.json`
- `GET/POST/DELETE /api/admin/instances` -- manage instances
- `POST /api/admin/send-test` -- send test message
- `GET /api/admin/events` -- recent instance and webhook events

## n8n Integration

1. Start LivZap with `WEBHOOK_URL=http://your-n8n:5678/webhook/livzap`
2. In n8n, add a **Webhook** node on `POST /webhook/livzap`
3. Parse incoming `event` and `data` fields
4. Use **HTTP Request** node to send messages back: `POST http://livzap:3000/api/messages/send`

See `examples/n8n-livzap-webhook.json` for a ready-to-import workflow.

## Library Usage

```typescript
import { InstanceManager, WebhookService } from '@livzap/core';

const manager = new InstanceManager();

// Configure webhooks
const webhooks = new WebhookService();
webhooks.configure({
  url: 'https://your-server.com/webhook',
  events: ['message', 'disconnected', 'ready'],
});

// Create instance
const bot = manager.createInstance({ id: 'my-bot' });
bot.on('event', ({ event, data }) => {
  webhooks.dispatch('my-bot', event, data);
});
bot.initialize();

// Send message
await bot.sendMessage({
  chatId: '5521999999999@c.us',
  text: 'Hello from LivZap library!',
});
```

## Patching whatsapp-web.js

LivZap depends on `whatsapp-web.js` (wwebjs) as a regular npm dependency -- we don't fork it. But wwebjs is reverse-engineered and can break when WhatsApp Web changes. When that happens, you have three options:

### Option 1: Update the package (preferred)

```bash
npm update whatsapp-web.js
npm run build
```

### Option 2: Apply a patch with patch-package

If a wwebjs bug affects you and the fix isn't released yet, use [`patch-package`](https://www.npmjs.com/package/patch-package):

```bash
# Install patch tools
npm install -D patch-package postinstall-postinstall

# Add postinstall to package.json
# "postinstall": "patch-package"
```

Then edit the buggy file in `node_modules/whatsapp-web.js/src/...`, fix it, and save the diff:

```bash
npx patch-package whatsapp-web.js
```

This creates a `patches/whatsapp-web.js+1.34.6.patch` file. Commit it to your repo -- it'll be applied automatically on every `npm install`.

### Option 3: Pin a fork

If you need permanent changes, fork wwebjs, apply your fixes, and point LivZap's `package.json` to your fork:

```json
{
  "dependencies": {
    "whatsapp-web.js": "github:your-username/whatsapp-web.js#your-branch"
  }
}
```

### Known patches

- **Newsletter send bug**: wwebjs v1.34.6 crashes on `chat.msgs.add()` for newsletter channels. LivZap already bypasses this by calling `Store.SendChannelMessage` directly via `pupPage.evaluate`. No patch needed.
- **Auto-reconnect**: wwebjs doesn't auto-reconnect after disconnect. LivZap handles this in `WhatsAppInstance` with a 5-second delay + fresh `initialize()` call.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `HOST` | `0.0.0.0` | HTTP server bind address |
| `NODE_ENV` | `development` | `development` or `production` |
| `API_KEY` | | Required API key for protected endpoints (strong key in production) |
| `SECURITY_MODE` | `strict` | `strict`, `balanced`, `relaxed` |
| `ALLOWED_ORIGINS` | | CSV allowlist for browser origins |
| `ADMIN_ENABLED` | `true` | Enable/disable built-in admin UI/API |
| `ADMIN_SESSION_TTL_MS` | `900000` | Admin session lifetime in ms |
| `SIGNED_URL_SECRET` | `API_KEY` fallback | Secret used for signed QR/media URLs |
| `WEBHOOK_URL` | | URL to forward events to |
| `WEBHOOK_EVENTS` | `message,disconnected,ready,qr` | Comma-separated event types |
| `WEBHOOK_SECRET` | | HMAC secret for webhook signatures |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Global API rate-limit window |
| `RATE_LIMIT_MAX_REQUESTS` | `120` | Global max requests per window |
| `MEDIA_SOURCE_MODE` | `https_only` | `https_only` or `https_and_local` |
| `MEDIA_ALLOWED_DOMAINS` | | Optional CSV allowlist for remote media hosts |
| `ANTIBAN_PROFILE` | `conservative` | `conservative`, `moderate`, `custom` |
| `WHATSAPP_HEADLESS` | `true` | Run Puppeteer headless |
| `WHATSAPP_PROTOCOL_TIMEOUT_MS` | `180000` | Puppeteer protocol timeout |
| `LOG_LEVEL` | `debug` (dev) / `info` (prod) | Log level |

## Contributing and Security

- Read `CONTRIBUTING.md` before opening pull requests.
- Report vulnerabilities privately as described in `SECURITY.md`.
- See `docs/OPEN_SOURCE_REVIEW_PLAN.md` before changing this private repository to public visibility.

## License

MIT
