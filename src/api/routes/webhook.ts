import { Router } from 'express';
import { webhookService } from '../../services/webhook.service';
import { requireApiKey } from '../middleware/auth';

const router = Router();

// POST /api/webhook/test -- test webhook delivery
router.post('/test', requireApiKey, async (_req, res) => {
  await webhookService.dispatch('test', 'message', { body: 'Hello from LivZap webhook test!' });
  res.json({ success: true, message: 'Test webhook dispatched' });
});

export default router;
