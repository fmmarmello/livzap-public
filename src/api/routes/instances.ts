import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { instanceManager } from '../../client/instance-manager';
import {
  buildSignedResourceQuery,
  requireApiKey,
  requireApiKeyOrSignedResource,
} from '../middleware/auth';
import { assertValidInstanceId, parseBool, parseIntWithBounds } from '../../utils/validation';
import { settingsService } from '../../services/settings.service';

const router = Router();

// GET /api/instances -- list all
router.get('/', requireApiKey, (_req, res) => {
  res.json({ instances: instanceManager.listInstances() });
});

// POST /api/instances -- create new instance
router.post('/', requireApiKey, (req, res) => {
  const { id, headless, protocolTimeoutMs, authTimeoutMs, autoReconnect } = req.body || {};

  if (!id) {
    res.status(400).json({ error: 'instanceId required' });
    return;
  }

  try {
    const instanceId = assertValidInstanceId(String(id));
    const defaults = settingsService.get().instanceDefaults;
    const instance = instanceManager.createInstance({
      id: instanceId,
      headless: parseBool(headless, defaults.headless),
      protocolTimeoutMs: parseIntWithBounds(
        protocolTimeoutMs,
        defaults.protocolTimeoutMs,
        10000,
        600000,
      ),
      authTimeoutMs: parseIntWithBounds(authTimeoutMs, defaults.authTimeoutMs, 10000, 600000),
      autoReconnect: parseBool(autoReconnect, defaults.autoReconnect),
    });

    instance.initialize();

    res.status(201).json({
      success: true,
      instance: { id: instance.id, status: instance.status },
    });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// DELETE /api/instances/:id -- remove instance
router.delete('/:id', requireApiKey, async (req, res) => {
  let instanceId: string;
  try {
    instanceId = assertValidInstanceId(req.params.id as string);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
    return;
  }

  const removed = await instanceManager.removeInstance(instanceId);
  if (!removed) {
    res.status(404).json({ error: 'Instance not found' });
    return;
  }
  res.json({ success: true, message: 'Instance removed' });
});

// GET /api/instances/:id/qr-url -- get short-lived signed QR URL
router.get('/:id/qr-url', requireApiKey, (req, res) => {
  let instanceId: string;
  try {
    instanceId = assertValidInstanceId(req.params.id as string);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
    return;
  }

  const qrPath = path.join(process.cwd(), 'temp', `qr-${instanceId}.png`);
  if (!fs.existsSync(qrPath)) {
    res.status(404).json({ error: 'QR code not available' });
    return;
  }

  const resource = `qr:${instanceId}`;
  const signed = buildSignedResourceQuery(resource);
  const qrUrl = `/api/instances/${encodeURIComponent(instanceId)}/qr?exp=${signed.exp}&sig=${signed.sig}`;
  res.json({ url: qrUrl, expiresAt: new Date(signed.exp).toISOString() });
});

// GET /api/instances/:id/qr -- get QR code image
router.get(
  '/:id/qr',
  requireApiKeyOrSignedResource((req) => `qr:${String(req.params.id || '')}`),
  (req, res) => {
    let instanceId: string;
    try {
      instanceId = assertValidInstanceId(req.params.id as string);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
      return;
    }

    const qrPath = path.join(process.cwd(), 'temp', `qr-${instanceId}.png`);

    if (!fs.existsSync(qrPath)) {
      res.status(404).json({ error: 'QR code not available' });
      return;
    }

    res.sendFile(qrPath);
  },
);

export default router;
