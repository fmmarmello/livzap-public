import { Router } from 'express';
const router = Router();

router.get('/', (_req, res) => {
  res.json({
    name: 'LivZap',
    version: '0.1.0',
    status: 'running',
    timestamp: new Date().toISOString(),
  });
});

export default router;
