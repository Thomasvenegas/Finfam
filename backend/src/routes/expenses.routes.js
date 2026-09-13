import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { emitExpenseCreated } from '../server.js';
import { aporteDe, aplicarAporte, ErrorAhorro } from '../services/savings.service.js';

const router = Router();
router.use(requireAuth);

/** La meta tiene que existir y ser del usuario. */
async function exigirMeta(tx, userId, goalId) {
  const meta = await tx.savingsGoal.findFirst({ where: { id: goalId, userId } });
  if (!meta) throw new ErrorAhorro('La meta de ahorro no existe.');
}

// Lista de gastos del mes (o rango)
router.get('/', async (req, res, next) => {
  try {
    const now = new Date();
    const from = req.query.from ? new Date(req.query.from) : new Date(now.getFullYear(), now.getMonth(), 1);
    const to = req.query.to ? new Date(req.query.to) : now;
    const expenses = await prisma.expense.findMany({
      where: { userId: req.userId, date: { gte: from, lte: to } },
      orderBy: { date: 'desc' },
      include: {
        card: { select: { bank: true, last4: true } },
        goal: { select: { id: true, name: true } }
      }
    });
    res.json(expenses);
  } catch (e) { next(e); }
});

// Gasto manual — al crearse, el socket avisa al dashboard y el saldo baja al
// instante. Si es un ahorro, además se suma a su meta.
router.post('/', async (req, res, next) => {
  try {
    const body = z.object({
      description: z.string().min(1),
      amount: z.number().positive(),
      category: z.string().default('otros'),
      cardId: z.string().optional(),
      goalId: z.string().optional(),
      date: z.string().datetime().optional()
    }).parse(req.body);

    const esAhorro = body.category === 'ahorro';
    if (esAhorro && !body.goalId) {
      return res.status(400).json({ error: 'Elige a qué meta de ahorro va este monto.' });
    }

    // El gasto y el aporte a la meta van juntos: o se registran los dos o ninguno.
    const expense = await prisma.$transaction(async tx => {
      if (esAhorro) await exigirMeta(tx, req.userId, body.goalId);
      const creado = await tx.expense.create({
        data: {
          userId: req.userId,
          description: body.description,
          amount: body.amount,
          category: body.category,
          cardId: body.cardId,
          goalId: esAhorro ? body.goalId : null,
          date: body.date ? new Date(body.date) : undefined,
          source: 'manual'
        }
      });
      await aplicarAporte(tx, req.userId, null, aporteDe(creado));
      return creado;
    });

    emitExpenseCreated(req.userId, expense);
    res.status(201).json(expense);
  } catch (e) { next(e); }
});

// Corregir un gasto ya registrado: la categoría que adivinamos desde el
// correo, el monto, la glosa, la fecha o la meta si es un ahorro. La meta se
// ajusta en la misma transacción para que nunca se desfase del historial.
router.patch('/:id', async (req, res, next) => {
  try {
    const body = z.object({
      description: z.string().min(1).optional(),
      amount: z.number().positive().optional(),
      category: z.string().min(1).optional(),
      goalId: z.string().nullable().optional(),
      date: z.string().datetime().optional()
    }).parse(req.body);

    const actualizado = await prisma.$transaction(async tx => {
      const antes = await tx.expense.findFirst({ where: { id: req.params.id, userId: req.userId } });
      if (!antes) return null;

      const categoria = body.category ?? antes.category;
      // Fuera de "ahorro" el gasto no aporta a ninguna meta.
      const goalId = categoria === 'ahorro'
        ? (body.goalId !== undefined ? body.goalId : antes.goalId)
        : null;
      // Pasar un gasto a "ahorro" exige elegir meta. Uno que ya era ahorro y
      // quedó sin meta (porque se borró) se puede seguir editando.
      if (categoria === 'ahorro' && !goalId && antes.category !== 'ahorro') {
        throw new ErrorAhorro('Elige a qué meta de ahorro va este monto.');
      }
      if (goalId && goalId !== antes.goalId) await exigirMeta(tx, req.userId, goalId);

      const data = { ...body, goalId };
      if (body.date) data.date = new Date(body.date);
      const despues = await tx.expense.update({ where: { id: antes.id }, data });

      await aplicarAporte(tx, req.userId, aporteDe(antes), aporteDe(despues));
      return despues;
    });

    if (!actualizado) return res.status(404).json({ error: 'Gasto no encontrado' });
    res.json(actualizado);
  } catch (e) { next(e); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const borrado = await prisma.$transaction(async tx => {
      const gasto = await tx.expense.findFirst({ where: { id: req.params.id, userId: req.userId } });
      if (!gasto) return false;
      // deleteMany: si otra petición lo borró entre medio, no se descuenta dos veces.
      const { count } = await tx.expense.deleteMany({ where: { id: gasto.id, userId: req.userId } });
      if (!count) return false;
      // Borrar un ahorro lo descuenta de su meta.
      await aplicarAporte(tx, req.userId, aporteDe(gasto), null);
      return true;
    });
    if (!borrado) return res.status(404).json({ error: 'Gasto no encontrado' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
