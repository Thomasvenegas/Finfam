import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// Recibe todo el wizard de una vez y deja al usuario listo para el dashboard
router.post('/', async (req, res, next) => {
  try {
    const body = z.object({
      householdType: z.enum(['individual', 'familia']),
      childrenCount: z.number().int().min(0).max(20),
      monthlySalary: z.number().positive(),
      extraIncomes: z.array(z.object({
        label: z.string(),
        amount: z.number().positive()
      })).default([]),
      fixedExpenses: z.array(z.object({
        label: z.string(),
        amount: z.number().positive(),
        category: z.string().default('otros'),
        dueDay: z.number().int().min(1).max(31).optional()
      })).default([])
    }).parse(req.body);

    await prisma.$transaction([
      prisma.profile.upsert({
        where: { userId: req.userId },
        create: {
          userId: req.userId,
          monthlySalary: body.monthlySalary,
          childrenCount: body.childrenCount,
          householdType: body.householdType
        },
        update: {
          monthlySalary: body.monthlySalary,
          childrenCount: body.childrenCount,
          householdType: body.householdType
        }
      }),
      prisma.income.deleteMany({ where: { userId: req.userId, recurring: true } }),
      prisma.income.createMany({
        data: [
          { userId: req.userId, label: 'Sueldo', amount: body.monthlySalary, recurring: true },
          ...body.extraIncomes.map(i => ({ userId: req.userId, ...i, recurring: true }))
        ]
      }),
      prisma.fixedExpense.deleteMany({ where: { userId: req.userId } }),
      prisma.fixedExpense.createMany({
        data: body.fixedExpenses.map(f => ({ userId: req.userId, ...f }))
      }),
      prisma.user.update({ where: { id: req.userId }, data: { onboarded: true } })
    ]);

    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
