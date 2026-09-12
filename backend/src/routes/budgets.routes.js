import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

/**
 * Presupuestos: tope mensual de gasto variable por categoría. Cuánto va
 * gastado contra cada tope lo calcula el resumen del mes, que ya tiene los
 * gastos a mano.
 */

router.get('/', async (req, res, next) => {
  try {
    res.json(await prisma.budget.findMany({
      where: { userId: req.userId },
      orderBy: { category: 'asc' }
    }));
  } catch (e) { next(e); }
});

// Uno por categoría: definir el de una categoría que ya tiene lo reemplaza.
router.post('/', async (req, res, next) => {
  try {
    const { category, amount } = z.object({
      category: z.string().min(1),
      amount: z.number().positive()
    }).parse(req.body);

    res.status(201).json(await prisma.budget.upsert({
      where: { userId_category: { userId: req.userId, category } },
      create: { userId: req.userId, category, amount },
      update: { amount }
    }));
  } catch (e) { next(e); }
});

// Solo el monto: cambiar la categoría podría chocar con otro presupuesto
// existente; para eso se borra y se crea de nuevo.
router.patch('/:id', async (req, res, next) => {
  try {
    const { amount } = z.object({ amount: z.number().positive() }).parse(req.body);
    const { count } = await prisma.budget.updateMany({
      where: { id: req.params.id, userId: req.userId },
      data: { amount }
    });
    if (!count) return res.status(404).json({ error: 'Presupuesto no encontrado' });
    res.json(await prisma.budget.findUnique({ where: { id: req.params.id } }));
  } catch (e) { next(e); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const { count } = await prisma.budget.deleteMany({
      where: { id: req.params.id, userId: req.userId }
    });
    if (!count) return res.status(404).json({ error: 'Presupuesto no encontrado' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
