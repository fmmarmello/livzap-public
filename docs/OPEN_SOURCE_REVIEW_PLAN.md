# Open Source Review Plan

This checklist tracks the work required before switching this repository from private to public.

## Applied in the current tree

- Added public project metadata to `package.json`: repository, bugs, homepage, keywords, Node engine, package files, and public scoped publish config.
- Added `LICENSE`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, and CI workflow scaffolding.
- Tightened `.gitignore` and added `.dockerignore` so local secrets, WhatsApp sessions, logs, data, and generated artifacts stay out of Git and Docker build contexts.
- Reworked the Dockerfile to build from source in a clean clone instead of requiring a prebuilt local `dist/` directory.
- Removed the private implementation plan from the public tree because it contained internal provenance and migration notes.
- Removed the unused `multer` dependency to avoid carrying a deprecated upload stack into the public package.

## Must complete before making GitHub public

1. Rotate local secrets.
   - The local `.env` file has non-empty `WEBHOOK_URL` and `API_KEY` values.
   - Keep `.env` private and rotate any value that may have been shared outside this machine.

2. Do not expose the existing private history as-is.
   - Earlier commits contain private/internal implementation notes and weak placeholder security defaults.
   - Recommended path: create a fresh public repository from the sanitized current tree, or rewrite history while the repository is still private and review the rewritten result before changing visibility.

3. Confirm code ownership and licensing.
   - Verify every copied or adapted module is owned by the same person or organization that will publish LivZap.
   - Keep third-party dependencies under their existing licenses and do not vendor dependency source into this repository.

4. Run a full secret scan against the rewritten or fresh history.
   - Use GitHub secret scanning after publication.
   - Prefer a local scanner such as Gitleaks or TruffleHog before publication if available.

5. Review platform and product positioning.
   - LivZap uses `whatsapp-web.js`, which depends on WhatsApp Web internals and may break when WhatsApp changes.
   - Document that the project is independent, unofficial, and intended for responsible, consent-based automation.

6. Verify release quality.
   - `npm ci`
   - `npm run typecheck`
   - `npm run build`
   - `docker compose build`
   - Manual smoke test of `/api/health` and one instance QR flow.

## Recommended public release sequence

1. Commit the sanitized current tree privately.
2. Create a clean export of the working tree without `.git`, `.env`, sessions, logs, data, `node_modules`, or `dist`.
3. Initialize a fresh public GitHub repository from that export, or rewrite private history and force-push only after review.
4. Enable GitHub settings: branch protection, Dependabot alerts, secret scanning, private vulnerability reporting, and Discussions if you want community support.
5. Publish the first release tag only after CI passes from a clean clone.
