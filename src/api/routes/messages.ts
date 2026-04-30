import { Router } from 'express';
import { instanceManager } from '../../client/instance-manager';
import { requireApiKey } from '../middleware/auth';
import {
  assertValidChatId,
  assertValidInstanceId,
  normalizeNewsletterId,
  parseBool,
  parseIntWithBounds,
} from '../../utils/validation';

const router = Router();

// POST /api/messages/send -- send message
router.post('/send', requireApiKey, async (req, res) => {
  const {
    instanceId,
    chatId,
    text,
    imageUrl,
    documentUrl,
    audioUrl,
    videoUrl,
    simulateTyping,
    delayBeforeMs,
  } = req.body || {};

  if (!instanceId || !chatId) {
    res.status(400).json({ error: 'instanceId and chatId required' });
    return;
  }

  try {
    const safeInstanceId = assertValidInstanceId(String(instanceId));
    const safeChatId = assertValidChatId(String(chatId));
    const instance = instanceManager.getInstance(safeInstanceId);
    if (!instance) {
      res.status(404).json({ error: 'Instance not found' });
      return;
    }

    const result = await instance.sendMessage({
      chatId: safeChatId,
      text: typeof text === 'string' ? text : undefined,
      imageUrl: typeof imageUrl === 'string' ? imageUrl : undefined,
      documentUrl: typeof documentUrl === 'string' ? documentUrl : undefined,
      audioUrl: typeof audioUrl === 'string' ? audioUrl : undefined,
      videoUrl: typeof videoUrl === 'string' ? videoUrl : undefined,
      simulateTyping: parseBool(simulateTyping, true),
      delayBeforeMs: parseIntWithBounds(delayBeforeMs, 0, 0, 120000),
    });

    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// POST /api/messages/newsletter/send -- send to newsletter
router.post('/newsletter/send', requireApiKey, async (req, res) => {
  const { instanceId, newsletterId, text, imageUrl } = req.body || {};

  if (!instanceId || !newsletterId || !text) {
    res.status(400).json({ error: 'instanceId, newsletterId, and text required' });
    return;
  }

  try {
    const safeInstanceId = assertValidInstanceId(String(instanceId));
    const safeNewsletterId = normalizeNewsletterId(String(newsletterId));
    const instance = instanceManager.getInstance(safeInstanceId);
    if (!instance) {
      res.status(404).json({ error: 'Instance not found' });
      return;
    }

    const result = await instance.sendToNewsletter({
      newsletterId: safeNewsletterId,
      text: String(text),
      imageUrl: typeof imageUrl === 'string' ? imageUrl : undefined,
    });

    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

export default router;
