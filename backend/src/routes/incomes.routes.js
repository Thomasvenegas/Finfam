import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

/**
 * Ingresos del usuario. Hay dos clases y la diferencia importa para el saldo:
 *   recurring: true  -> sueldo, arriendo. Cuenta todos los meses.
 *   recurring: false -> bono, devolución, un abono aprobado desde el correo.
 *                       Cuenta solo en el mes de su fecha.
 *
 * Hasta ahora solo los creaba el onboarding o la aprobación de un correo, así
 * que un ingreso mal registrado no había forma de corregirlo.
 */

const ingreso = z.object({
  label: z.string().min(1),
  amount: z.number().positive(),
  recurring: z.boolean().default(true),
  date: z.string().datetime().optional()
});

/** Lo mismo que suma el resumen del mes, para que la lista cuadre con el total. */
function delMesActual(userId) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  return {
    userId,
    OR: [
      { recurring: true },
      { recurring: false, date: { gte: monthStart, lte: monthEnd } }
    ]
  };
}

router.get('/', async (req, res, next) => {
  try {
    res.json(await prisma.income.findMany({
      where: delMesActual(req.userId),
      orderBy: [{ recurring: 'desc' }, { date: 'desc' }]
    }));
  } catch (e) { next(e); }
});

router.post('/', async (req, res, next) => {
  try {
    const body = ingreso.parse(req.body);
    res.status(201).json(await prisma.income.create({
      data: {
        userId: req.userId,
        label: body.label,
        amount: body.amount,
        recurring: body.recurring,
        date: body.date ? new Date(body.date) : undefined
      }
    }));
  } catch (e) { next(e); }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const body = ingreso.partial().parse(req.body);
    const data = { ...body };
    if (body.date) data.date = new Date(body.date);

    // updateMany filtra por usuario y devuelve 0 en vez de lanzar si el id
    // no es suyo. Nunca se toca externalId: ata el ingreso a su correo.
    const { count } = await prisma.income.updateMany({
      where: { id: req.params.id, userId: req.userId },
      data
    });
    if (!count) return res.status(404).json({ error: 'Ingreso no encontrado' });

    res.json(await prisma.income.findUnique({ where: { id: req.params.id } }));
  } catch (e) { next(e); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const { count } = await prisma.income.deleteMany({
      where: { id: req.params.id, userId: req.userId }
    });
    if (!count) return res.status(404).json({ error: 'Ingreso no encontrado' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
