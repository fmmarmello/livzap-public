import { Router } from 'express';
import { instanceManager } from '../../client/instance-manager';
import { discoverService } from '../../services/discover.service';
import { requireApiKey } from '../middleware/auth';
import { assertValidInstanceId, parseIntWithBounds } from '../../utils/validation';

const router = Router();

// GET /api/discover/recent -- recent messages within a time window
router.get('/recent', requireApiKey, (req, res) => {
  const { instanceId, windowMs, limit, type } = req.query;

  if (!instanceId) {
    res.status(400).json({ error: 'instanceId query param required' });
    return;
  }

  try {
    const safeInstanceId = assertValidInstanceId(instanceId as string);
    const instance = instanceManager.getInstance(safeInstanceId);
    if (!instance) {
      res.status(404).json({ error: 'Instance not found' });
      return;
    }

    const resolvedType =
      type === 'contact' || type === 'group' || type === 'newsletter' ? type : 'all';

    const messages = discoverService.getRecentMessages(
      safeInstanceId,
      parseIntWithBounds(windowMs, 60000, 1000, 86400000),
      parseIntWithBounds(limit, 50, 1, 500),
      resolvedType,
    );

    res.json({ messages, count: messages.length });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// GET /api/discover/unread -- latest message per chat (unread grouped)
router.get('/unread', requireApiKey, (req, res) => {
  const { instanceId, windowMs, limit } = req.query;

  if (!instanceId) {
    res.status(400).json({ error: 'instanceId query param required' });
    return;
  }

  try {
    const safeInstanceId = assertValidInstanceId(instanceId as string);
    const instance = instanceManager.getInstance(safeInstanceId);
    if (!instance) {
      res.status(404).json({ error: 'Instance not found' });
      return;
    }

    const chats = discoverService.getUnreadPerChat(
      safeInstanceId,
      parseIntWithBounds(windowMs, 3600000, 1000, 86400000),
      parseIntWithBounds(limit, 20, 1, 200),
    );

    res.json({ chats, count: chats.length });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

export default router;
