import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

/**
 * Historial de movimientos paginado: gastos y abonos puntuales mezclados por
 * fecha, del más reciente al más antiguo.
 *
 * A diferencia del resumen del mes, aquí no hay corte por mes: la idea es
 * poder seguir bajando hacia atrás en el tiempo.
 *
 * Los ingresos recurrentes (el sueldo) quedan fuera a propósito: no son un
 * movimiento que haya ocurrido en una fecha, son la base mensual del saldo, y
 * repetirlos en el historial haría parecer que llegó plata que no llegó.
 */

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

router.get('/', async (req, res, next) => {
  try {
    const { limit, offset } = z.object({
      limit: z.coerce.number().int().min(1).max(100).default(20),
      offset: z.coerce.number().int().min(0).default(0)
    }).parse(req.query);

    // Se piden offset+limit de cada tabla: cualquier elemento de la página
    // pedida está necesariamente entre los más recientes de su propia tabla,
    // así que mezclar esos dos bloques basta para armarla bien.
    const tope = offset + limit;
    const [gastos, abonos] = await Promise.all([
      prisma.expense.findMany({
        where: { userId: req.userId },
        orderBy: { date: 'desc' },
        take: tope
      }),
      prisma.income.findMany({
        where: { userId: req.userId, recurring: false },
        orderBy: { date: 'desc' },
        take: tope
      })
    ]);

    const mezclados = [
      ...gastos.map(paraLista.expense),
      ...abonos.map(paraLista.income)
    ].sort((a, b) => new Date(b.date) - new Date(a.date));

    const pagina = mezclados.slice(offset, tope);

    res.json({
      items: pagina,
      // Quedan más si la mezcla de ambos bloques ya excede esta página, o si
      // alguno de los dos vino lleno y por lo tanto puede tener cola sin leer.
      // Mirar solo lo segundo dejaba inalcanzable el remanente de la mezcla.
      hayMas: mezclados.length > tope ||
              gastos.length === tope ||
              abonos.length === tope
    });
  } catch (e) { next(e); }
});

export default router;
