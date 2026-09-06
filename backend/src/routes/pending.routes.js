import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { approvePending, rejectPending } from '../services/movement.service.js';

const router = Router();
router.use(requireAuth);

// Movimientos detectados en correos que esperan confirmación
router.get('/', async (req, res, next) => {
  try {
    const pending = await prisma.pendingMovement.findMany({
      where: { userId: req.userId, status: 'pending' },
      orderBy: { date: 'desc' }
    });
    res.json(pending);
  } catch (e) { next(e); }
});

// Confirmar: recién aquí se mueve el saldo
router.post('/:id/approve', async (req, res, next) => {
  try {
    const overrides = z.object({
      description: z.string().min(1).optional(),
      amount: z.number().positive().optional(),
      category: z.string().optional()
    }).parse(req.body ?? {});

    const result = await approvePending(req.userId, req.params.id, overrides);
    if (!result) return res.status(404).json({ error: 'Movimiento no encontrado' });
    res.status(201).json(result);
  } catch (e) { next(e); }
});

// Descartar: no vuelve a proponerse aunque el correo se lea de nuevo
router.post('/:id/reject', async (req, res, next) => {
  try {
    const ok = await rejectPending(req.userId, req.params.id);
    if (!ok) return res.status(404).json({ error: 'Movimiento no encontrado' });
    res.json({ rejected: true });
  } catch (e) { next(e); }
});

export default router;
