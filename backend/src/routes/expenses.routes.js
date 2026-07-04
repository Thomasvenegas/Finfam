import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { emitExpenseCreated } from '../server.js';

const router = Router();
router.use(requireAuth);

// Lista de gastos del mes (o rango)
router.get('/', async (req, res, next) => {
  try {
    const now = new Date();
    const from = req.query.from ? new Date(req.query.from) : new Date(now.getFullYear(), now.getMonth(), 1);
    const to = req.query.to ? new Date(req.query.to) : now;
    const expenses = await prisma.expense.findMany({
      where: { userId: req.userId, date: { gte: from, lte: to } },
      orderBy: { date: 'desc' },
      include: { card: { select: { bank: true, last4: true } } }
    });
    res.json(expenses);
  } catch (e) { next(e); }
});

// Gasto manual — al crearse, el socket avisa al dashboard y el saldo baja al instante
router.post('/', async (req, res, next) => {
  try {
    const body = z.object({
      description: z.string().min(1),
      amount: z.number().positive(),
      category: z.string().default('otros'),
      cardId: z.string().optional(),
      date: z.string().datetime().optional()
    }).parse(req.body);

    const expense = await prisma.expense.create({
      data: {
        userId: req.userId,
        description: body.description,
        amount: body.amount,
        category: body.category,
        cardId: body.cardId,
        date: body.date ? new Date(body.date) : undefined,
        source: 'manual'
      }
    });
    emitExpenseCreated(req.userId, expense);
    res.status(201).json(expense);
  } catch (e) { next(e); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await prisma.expense.delete({
      where: { id: req.params.id, userId: req.userId }
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
