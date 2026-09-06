import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// Resumen del mes actual: todo lo que necesitan los gráficos
router.get('/summary', async (req, res, next) => {
  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const [incomes, fixed, expenses] = await Promise.all([
      prisma.income.findMany({
        where: {
          userId: req.userId,
          OR: [
            { recurring: true }, // sueldo y otros ingresos fijos del onboarding
            { recurring: false, date: { gte: monthStart, lte: monthEnd } } // abonos del mes
          ]
        },
        orderBy: { date: 'asc' }
      }),
      prisma.fixedExpense.findMany({ where: { userId: req.userId } }),
      prisma.expense.findMany({
        where: { userId: req.userId, date: { gte: monthStart, lte: monthEnd } },
        orderBy: { date: 'asc' }
      })
    ]);

    const totalIncome = incomes.reduce((s, i) => s + Number(i.amount), 0);
    const totalFixed = fixed.reduce((s, f) => s + Number(f.amount), 0);
    const totalVariable = expenses.reduce((s, e) => s + Number(e.amount), 0);
    const totalSpent = totalFixed + totalVariable;
    const available = totalIncome - totalSpent;

    // Gasto por categoría (variables) para el gráfico de torta
    const byCategory = {};
    for (const e of expenses) {
      byCategory[e.category] = (byCategory[e.category] || 0) + Number(e.amount);
    }

    // Gasto acumulado por día para la curva del mes vs línea de ingreso
    const daysInMonth = monthEnd.getDate();
    const dailyCumulative = Array(daysInMonth).fill(0);
    for (const e of expenses) {
      dailyCumulative[new Date(e.date).getDate() - 1] += Number(e.amount);
    }
    let acc = totalFixed; // los gastos fijos parten comprometidos desde el día 1
    const cumulative = dailyCumulative.map(d => (acc += d));

    // "Últimos movimientos": gastos y abonos del mes mezclados por fecha.
    const movements = [
      ...expenses.map(e => ({
        id: e.id,
        type: 'expense',
        description: e.description,
        amount: Number(e.amount),
        category: e.category,
        source: e.source,
        date: e.date
      })),
      ...incomes
        .filter(i => !i.recurring)
        .map(i => ({
          id: i.id,
          type: 'income',
          description: i.label,
          amount: Number(i.amount),
          category: 'ingreso',
          source: i.externalId?.startsWith('email:') ? 'email' : 'manual',
          date: i.date
        }))
    ].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 10);

    res.json({
      month: now.toISOString().slice(0, 7),
      totalIncome,
      totalFixed,
      totalVariable,
      totalSpent,
      available,
      overspent: available < 0,
      byCategory,
      cumulative,          // gasto acumulado día a día
      incomeLine: totalIncome, // referencia horizontal en el gráfico
      lastExpenses: expenses.slice(-10).reverse(),
      lastMovements: movements
    });
  } catch (e) { next(e); }
});

export default router;
