# Contributing

Thanks for helping improve LivZap.

## Local setup

```bash
npm install
cp .env.example .env
npm run dev
```

Set a strong local `API_KEY` before testing protected endpoints. Do not commit `.env`, WhatsApp session folders, logs, data files, or generated build output.

## Development checks

Run these before opening a pull request:

```bash
npm run typecheck
npm run build
npm test
```

## Pull requests

- Keep changes scoped to one behavior or concern.
- Include documentation updates for public API, configuration, Docker, or operational changes.
- Avoid committing secrets, phone numbers, exported WhatsApp sessions, customer data, screenshots with QR codes, or production webhook URLs.
- Explain any behavior that depends on WhatsApp Web internals, because those integrations can change without notice.

## Responsible use

LivZap is intended for consent-based automation and operational integrations. Do not use it for spam, unsolicited messaging, credential collection, evasion, or activity that violates applicable law or platform terms.
