# Security Policy

## Supported versions

Security fixes target the latest code on the default branch until versioned releases are established.

## Reporting a vulnerability

Please do not open a public issue for a vulnerability. Use GitHub private vulnerability reporting when enabled, or open a minimal issue asking for a private contact path without including exploit details.

Include:

- Affected version or commit.
- Impact and affected endpoint or component.
- Reproduction steps or proof of concept.
- Any known mitigations.

## Secret handling

Never publish `.env` files, API keys, webhook secrets, WhatsApp session folders, QR codes, logs, media, or runtime data. If a secret is committed or shared, rotate it immediately and remove it from Git history before making the repository public.
