import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

/**
 * Gastos fijos del mes (dividendo, colegio, cuentas). Hasta ahora solo se
 * podían definir en el onboarding y quedaban congelados; se descuentan del
 * saldo todos los meses, así que tienen que poder corregirse.
 */

const gastoFijo = z.object({
  label: z.string().min(1),
  amount: z.number().positive(),
  category: z.string().min(1).default('otros'),
  dueDay: z.number().int().min(1).max(31).nullable().optional()
});

router.get('/', async (req, res, next) => {
  try {
    res.json(await prisma.fixedExpense.findMany({
      where: { userId: req.userId },
      orderBy: [{ dueDay: 'asc' }, { label: 'asc' }]
    }));
  } catch (e) { next(e); }
});

router.post('/', async (req, res, next) => {
  try {
    const body = gastoFijo.parse(req.body);
    res.status(201).json(await prisma.fixedExpense.create({
      data: { userId: req.userId, ...body }
    }));
  } catch (e) { next(e); }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const body = gastoFijo.partial().parse(req.body);
    const { count } = await prisma.fixedExpense.updateMany({
      where: { id: req.params.id, userId: req.userId },
      data: body
    });
    if (!count) return res.status(404).json({ error: 'Gasto fijo no encontrado' });
    res.json(await prisma.fixedExpense.findUnique({ where: { id: req.params.id } }));
  } catch (e) { next(e); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const { count } = await prisma.fixedExpense.deleteMany({
      where: { id: req.params.id, userId: req.userId }
    });
    if (!count) return res.status(404).json({ error: 'Gasto fijo no encontrado' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
