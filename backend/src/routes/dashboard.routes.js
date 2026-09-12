import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import {
  parseMonth, monthKey, shiftMonth, projectMonthEnd,
  variation, budgetStatus, upcomingPayments
} from '../services/finance.service.js';

const router = Router();
router.use(requireAuth);

const sumar = (lista, campo = 'amount') => lista.reduce((s, x) => s + Number(x[campo]), 0);

function porCategoria(gastos) {
  const acc = {};
  for (const e of gastos) acc[e.category] = (acc[e.category] || 0) + Number(e.amount);
  return acc;
}

// Resumen de un mes (por defecto el actual): todo lo que necesitan los gráficos.
router.get('/summary', async (req, res, next) => {
  try {
    const { month } = z.object({
      month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Usa el formato AAAA-MM').optional()
    }).parse(req.query);

    const now = new Date();
    const mes = parseMonth(month ?? monthKey(now));
    const anterior = parseMonth(shiftMonth(mes.key, -1));
    const esMesActual = mes.key === monthKey(now);

    const [incomes, fixed, expenses, gastosAnteriores, budgets] = await Promise.all([
      prisma.income.findMany({
        where: {
          userId: req.userId,
          OR: [
            // Los recurrentes cuentan en todos los meses, también en los pasados.
            { recurring: true },
            { recurring: false, date: { gte: mes.start, lte: mes.end } }
          ]
        },
        orderBy: { date: 'asc' }
      }),
      prisma.fixedExpense.findMany({ where: { userId: req.userId } }),
      prisma.expense.findMany({
        where: { userId: req.userId, date: { gte: mes.start, lte: mes.end } },
        orderBy: { date: 'asc' }
      }),
      prisma.expense.findMany({
        where: { userId: req.userId, date: { gte: anterior.start, lte: anterior.end } }
      }),
      prisma.budget.findMany({ where: { userId: req.userId } })
    ]);

    const totalIncome = sumar(incomes);
    const totalFixed = sumar(fixed);
    const totalVariable = sumar(expenses);
    const totalSpent = totalFixed + totalVariable;
    const available = totalIncome - totalSpent;
    const byCategory = porCategoria(expenses);

    // Gasto acumulado por día para la curva del mes vs línea de ingreso
    const dailyCumulative = Array(mes.daysInMonth).fill(0);
    for (const e of expenses) {
      dailyCumulative[new Date(e.date).getDate() - 1] += Number(e.amount);
    }
    let acc = totalFixed; // los gastos fijos parten comprometidos desde el día 1
    const cumulative = dailyCumulative.map(d => (acc += d));

    // Comparación con el mes anterior. En el mes en curso se compara contra el
    // mismo tramo del anterior (del 1 a hoy): contra el mes completo, a mitad
    // de mes siempre parecería que se gastó mucho menos.
    const corte = esMesActual ? Math.min(now.getDate(), anterior.daysInMonth) : anterior.daysInMonth;
    const previosComparables = gastosAnteriores.filter(e => new Date(e.date).getDate() <= corte);
    const previousVariable = sumar(previosComparables);

    const presupuestos = budgets
      .map(b => ({
        id: b.id,
        category: b.category,
        ...budgetStatus(byCategory[b.category] || 0, Number(b.amount))
      }))
      .sort((a, b) => b.pct - a.pct);

    // "Últimos movimientos" del mes, para clientes que aún no usan /movements.
    const movements = [
      ...expenses.map(e => ({
        id: e.id, type: 'expense', description: e.description, amount: Number(e.amount),
        category: e.category, source: e.source, externalId: e.externalId, date: e.date
      })),
      ...incomes.filter(i => !i.recurring).map(i => ({
        id: i.id, type: 'income', description: i.label, amount: Number(i.amount),
        category: 'ingreso', source: i.externalId ? 'email' : 'manual',
        externalId: i.externalId, date: i.date
      }))
    ].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 10);

    res.json({
      month: mes.key,
      isCurrentMonth: esMesActual,
      previousMonth: anterior.key,
      // No se navega hacia meses que todavía no ocurren.
      nextMonth: mes.key < monthKey(now) ? shiftMonth(mes.key, 1) : null,
      totalIncome,
      totalFixed,
      totalVariable,
      totalSpent,
      available,
      overspent: available < 0,
      byCategory,
      cumulative,
      incomeLine: totalIncome,
      comparison: {
        samePeriod: esMesActual,
        previousVariable,
        variationPct: variation(totalVariable, previousVariable),
        previousByCategory: porCategoria(previosComparables)
      },
      projection: esMesActual
        ? projectMonthEnd({
            income: totalIncome,
            fixed: totalFixed,
            variable: totalVariable,
            dayOfMonth: now.getDate(),
            daysInMonth: mes.daysInMonth
          })
        : null,
      budgets: presupuestos,
      upcomingPayments: esMesActual ? upcomingPayments(fixed, now, 7) : [],
      lastExpenses: expenses.slice(-10).reverse(),
      lastMovements: movements
    });
  } catch (e) { next(e); }
});

export default router;
