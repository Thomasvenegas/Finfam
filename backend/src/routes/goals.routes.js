import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

/**
 * Metas de ahorro. Lo ahorrado se mueve con aportes y retiros; no toca el
 * saldo disponible del mes, porque la plata sigue en la cuenta.
 */

const fecha = z.string().refine(v => !Number.isNaN(Date.parse(v)), 'Fecha inválida');
const meta = z.object({
  name: z.string().min(1),
  target: z.number().positive(),
  deadline: fecha.nullable().optional()
});

const conProgreso = g => {
  const target = Number(g.target);
  const saved = Number(g.saved);
  return { ...g, target, saved, pct: Math.min(100, Math.round((saved / target) * 100)) };
};

router.get('/', async (req, res, next) => {
  try {
    const metas = await prisma.savingsGoal.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: 'asc' }
    });
    res.json(metas.map(conProgreso));
  } catch (e) { next(e); }
});

router.post('/', async (req, res, next) => {
  try {
    const body = meta.parse(req.body);
    const creada = await prisma.savingsGoal.create({
      data: {
        userId: req.userId,
        name: body.name,
        target: body.target,
        deadline: body.deadline ? new Date(body.deadline) : null
      }
    });
    res.status(201).json(conProgreso(creada));
  } catch (e) { next(e); }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const body = meta.partial().parse(req.body);
    const data = { ...body };
    if ('deadline' in body) data.deadline = body.deadline ? new Date(body.deadline) : null;

    const { count } = await prisma.savingsGoal.updateMany({
      where: { id: req.params.id, userId: req.userId },
      data
    });
    if (!count) return res.status(404).json({ error: 'Meta no encontrada' });
    res.json(conProgreso(await prisma.savingsGoal.findUnique({ where: { id: req.params.id } })));
  } catch (e) { next(e); }
});

// Aporte (monto positivo) o retiro (negativo).
router.post('/:id/aporte', async (req, res, next) => {
  try {
    const { amount } = z.object({
      amount: z.number().refine(n => n !== 0, 'El monto no puede ser cero')
    }).parse(req.body);

    // Un retiro solo procede si hay con qué: la condición va en el mismo
    // UPDATE, así dos retiros simultáneos no dejan el ahorro en negativo.
    const { count } = await prisma.savingsGoal.updateMany({
      where: {
        id: req.params.id,
        userId: req.userId,
        ...(amount < 0 ? { saved: { gte: -amount } } : {})
      },
      data: { saved: { increment: amount } }
    });

    if (!count) {
      const existe = await prisma.savingsGoal.findFirst({
        where: { id: req.params.id, userId: req.userId }
      });
      if (!existe) return res.status(404).json({ error: 'Meta no encontrada' });
      return res.status(400).json({ error: 'No puedes retirar más de lo que llevas ahorrado' });
    }

    res.json(conProgreso(await prisma.savingsGoal.findUnique({ where: { id: req.params.id } })));
  } catch (e) { next(e); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const { count } = await prisma.savingsGoal.deleteMany({
      where: { id: req.params.id, userId: req.userId }
    });
    if (!count) return res.status(404).json({ error: 'Meta no encontrada' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
