import { Router } from 'express';
import { instanceManager } from '../../client/instance-manager';
import { requireApiKey } from '../middleware/auth';
import { assertValidInstanceId } from '../../utils/validation';

const router = Router();

// GET /api/chats -- list groups and newsletters
router.get('/', requireApiKey, async (req, res) => {
  const { instanceId } = req.query;

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

    const chats = await instance.listChats();
    res.json({ chats });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

export default router;
