import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const cards = await prisma.creditCard.findMany({ where: { userId: req.userId } });
    res.json(cards);
  } catch (e) { next(e); }
});

// IMPORTANTE (PCI-DSS): jamás pedir ni almacenar el número completo o CVV.
// Solo identificamos la tarjeta para asociarle gastos y controlar el cupo.
router.post('/', async (req, res, next) => {
  try {
    const body = z.object({
      bank: z.string().min(2),
      brand: z.enum(['Visa', 'Mastercard', 'Amex', 'Otra']),
      last4: z.string().regex(/^\d{4}$/, 'Solo los últimos 4 dígitos'),
      creditLimit: z.number().positive().optional(),
      billingDay: z.number().int().min(1).max(31).optional()
    }).parse(req.body);

    const card = await prisma.creditCard.create({ data: { userId: req.userId, ...body } });
    res.status(201).json(card);
  } catch (e) { next(e); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await prisma.creditCard.delete({ where: { id: req.params.id, userId: req.userId } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
