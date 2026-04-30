import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import {
  buildSignedResourceQuery,
  requireApiKey,
  requireApiKeyOrSignedResource,
} from '../middleware/auth';

const router = Router();
const mediaDir = path.join(process.cwd(), 'temp', 'media');

function isSafeFilename(filename: string): boolean {
  if (!filename || filename.length > 255) return false;
  if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) return false;
  return /^[A-Za-z0-9._-]+$/.test(filename);
}

router.get('/signed-url/:filename', requireApiKey, (req, res) => {
  const filename = String(req.params.filename || '');
  if (!isSafeFilename(filename)) {
    res.status(400).json({ error: 'Invalid filename' });
    return;
  }
  const filePath = path.join(mediaDir, filename);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'Media not found' });
    return;
  }

  const resource = `media:${filename}`;
  const signed = buildSignedResourceQuery(resource);
  const url = `/api/media/${encodeURIComponent(filename)}?exp=${signed.exp}&sig=${signed.sig}`;
  res.json({ url, expiresAt: new Date(signed.exp).toISOString() });
});

router.get(
  '/:filename',
  requireApiKeyOrSignedResource((req) => `media:${String(req.params.filename || '')}`),
  (req, res) => {
    const filename = String(req.params.filename || '');
    if (!isSafeFilename(filename)) {
      res.status(400).json({ error: 'Invalid filename' });
      return;
    }

    const filePath = path.join(mediaDir, filename);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Media not found' });
      return;
    }

    res.sendFile(filePath);
  },
);

export default router;

