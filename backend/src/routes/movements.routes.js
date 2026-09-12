import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { toCsv } from '../services/finance.service.js';

const router = Router();
router.use(requireAuth);

/**
 * Historial de movimientos: gastos y abonos puntuales mezclados por fecha, del
 * más reciente al más antiguo, con filtros y exportación.
 *
 * Los ingresos recurrentes (el sueldo) quedan fuera a propósito: no son un
 * movimiento ocurrido en una fecha sino la base mensual del saldo, y
 * repetirlos haría parecer que llegó plata que no llegó.
 */

const fechaValida = z.string().refine(v => !Number.isNaN(Date.parse(v)), 'Fecha inválida');
const filtros = z.object({
  q: z.string().trim().max(80).optional(),
  category: z.string().min(1).optional(),
  type: z.enum(['expense', 'income']).optional(),
  from: fechaValida.optional(),
  to: fechaValida.optional()
});

const paraLista = {
  expense: e => ({
    id: e.id,
    type: 'expense',
    description: e.description,
    amount: Number(e.amount),
    category: e.category,
    source: e.source,
    externalId: e.externalId, // permite abrir el correo de origen
    date: e.date
  }),
  income: i => ({
    id: i.id,
    type: 'income',
    description: i.label,
    amount: Number(i.amount),
    category: 'ingreso',
    source: i.externalId ? 'email' : 'manual',
    externalId: i.externalId,
    date: i.date
  })
};

/**
 * Traduce los filtros a un where por tabla. null significa "esta tabla no
 * aporta nada" (p. ej. filtrar por supermercado excluye todos los ingresos).
 */
// "2026-09-12" se toma como día local, igual que los meses del resumen.
// new Date("2026-09-12") lo leería como medianoche UTC, y mezclado con un
// setHours local el rango quedaba corrido las horas de diferencia horaria.
function diaLocal(v, finDelDia) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return new Date(v);
  return finDelDia
    ? new Date(+m[1], +m[2] - 1, +m[3], 23, 59, 59, 999)
    : new Date(+m[1], +m[2] - 1, +m[3]);
}

function construirWhere(userId, f) {
  const fecha = {};
  if (f.from) fecha.gte = diaLocal(f.from, false);
  if (f.to) fecha.lte = diaLocal(f.to, true); // "hasta" incluye el día completo
  const conFecha = Object.keys(fecha).length ? { date: fecha } : {};
  const texto = campo => (f.q ? { [campo]: { contains: f.q, mode: 'insensitive' } } : {});

  const incluyeGastos = f.type !== 'income' && f.category !== 'ingreso';
  const incluyeAbonos = f.type !== 'expense' && (!f.category || f.category === 'ingreso');

  return {
    gastos: incluyeGastos
      ? { userId, ...conFecha, ...(f.category ? { category: f.category } : {}), ...texto('description') }
      : null,
    abonos: incluyeAbonos
      ? { userId, recurring: false, ...conFecha, ...texto('label') }
      : null
  };
}

async function leer(where, tope) {
  const [gastos, abonos] = await Promise.all([
    where.gastos ? prisma.expense.findMany({ where: where.gastos, orderBy: { date: 'desc' }, take: tope }) : [],
    where.abonos ? prisma.income.findMany({ where: where.abonos, orderBy: { date: 'desc' }, take: tope }) : []
  ]);
  const mezclados = [...gastos.map(paraLista.expense), ...abonos.map(paraLista.income)]
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  return { gastos, abonos, mezclados };
}

router.get('/', async (req, res, next) => {
  try {
    const { limit, offset, ...f } = filtros.extend({
      limit: z.coerce.number().int().min(1).max(100).default(20),
      offset: z.coerce.number().int().min(0).default(0)
    }).parse(req.query);

    // Se piden offset+limit de cada tabla: cualquier elemento de la página
    // pedida está necesariamente entre los más recientes de su propia tabla,
    // así que mezclar esos dos bloques basta para armarla bien.
    const tope = offset + limit;
    const { gastos, abonos, mezclados } = await leer(construirWhere(req.userId, f), tope);

    res.json({
      items: mezclados.slice(offset, tope),
      // Quedan más si la mezcla ya excede esta página, o si alguno de los dos
      // bloques vino lleno y por lo tanto puede tener cola sin leer.
      hayMas: mezclados.length > tope || gastos.length === tope || abonos.length === tope
    });
  } catch (e) { next(e); }
});

// Mismos filtros que el historial, pero todo junto y en CSV para Excel.
router.get('/export', async (req, res, next) => {
  try {
    const f = filtros.parse(req.query);
    const MAX = 5000; // tope de seguridad; un hogar no llega a esto en años
    const { mezclados } = await leer(construirWhere(req.userId, f), MAX);

    // CLP casi nunca trae decimales; si los trae, con coma como en Chile.
    const monto = n => (Number.isInteger(n) ? n : String(n).replace('.', ','));

    const csv = toCsv(mezclados, [
      { titulo: 'Fecha', valor: m => new Date(m.date).toISOString().slice(0, 10) },
      { titulo: 'Tipo', valor: m => (m.type === 'income' ? 'Ingreso' : 'Gasto') },
      { titulo: 'Descripción', valor: m => m.description },
      { titulo: 'Categoría', valor: m => m.category },
      { titulo: 'Monto', valor: m => monto(m.amount) },
      { titulo: 'Origen', valor: m => m.source }
    ]);

    const hoy = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="finfam-movimientos-${hoy}.csv"`);
    res.send(csv);
  } catch (e) { next(e); }
});

export default router;
