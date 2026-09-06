import { prisma } from '../lib/prisma.js';
import { emitExpenseCreated, emitIncomeCreated, emitPendingCreated } from '../server.js';
import { categorize } from './fintoc.service.js';
import { parseBankEmail } from './email-parser.service.js';

/**
 * Los correos bancarios no tocan el saldo por sí solos: se dejan en una
 * bandeja de pendientes y el usuario decide si entran o no. Así un cobro que
 * no reconoce, un traspaso entre cuentas propias o un correo mal interpretado
 * no distorsionan el mes.
 *
 * Lo usan las dos vías de ingesta (lectura de Gmail y webhook de reenvío).
 */

/**
 * Deja un movimiento propuesto a partir de un correo.
 * @returns {Promise<{queued:boolean, reason?:string, type?:string, amount?:number}>}
 */
export async function queueEmailMovement(userId, mail, externalId) {
  const parsed = parseBankEmail(mail);
  if (!parsed) return { queued: false, reason: 'no mueve dinero' };

  // Si ya se propuso (aunque el usuario lo haya rechazado) no se insiste.
  if (externalId) {
    const visto = await prisma.pendingMovement.findUnique({ where: { externalId } });
    if (visto) return { queued: false, reason: 'ya revisado' };
  }

  const pending = await prisma.pendingMovement.create({
    data: {
      userId,
      externalId,
      type: parsed.type,
      description: parsed.merchant,
      amount: parsed.amount,
      category: parsed.type === 'income' ? 'ingreso' : categorize(parsed.merchant),
      bank: parsed.bank,
      date: parsed.date
    }
  });

  emitPendingCreated(userId, pending);
  return { queued: true, type: parsed.type, amount: parsed.amount };
}

/**
 * Confirma un pendiente: recién ahí se crea el gasto o el ingreso y se mueve
 * el saldo. `overrides` permite corregir categoría o monto antes de aceptar.
 */
export async function approvePending(userId, pendingId, overrides = {}) {
  const pending = await prisma.pendingMovement.findFirst({
    where: { id: pendingId, userId, status: 'pending' }
  });
  if (!pending) return null;

  const amount = overrides.amount ?? Number(pending.amount);
  const description = overrides.description ?? pending.description;
  const category = overrides.category ?? pending.category;

  if (pending.type === 'income') {
    const income = await prisma.income.create({
      data: {
        userId,
        label: description,
        amount,
        recurring: false, // ingreso puntual del mes, no un sueldo fijo
        externalId: pending.externalId,
        date: pending.date
      }
    });
    await prisma.pendingMovement.update({
      where: { id: pending.id }, data: { status: 'approved' }
    });
    emitIncomeCreated(userId, income);
    return { type: 'income', movement: income };
  }

  const expense = await prisma.expense.create({
    data: {
      userId,
      description,
      amount,
      category,
      source: 'email',
      externalId: pending.externalId,
      date: pending.date
    }
  });
  await prisma.pendingMovement.update({
    where: { id: pending.id }, data: { status: 'approved' }
  });
  emitExpenseCreated(userId, expense);
  return { type: 'expense', movement: expense };
}

/** Descarta un pendiente. Queda marcado para no volver a proponerlo. */
export async function rejectPending(userId, pendingId) {
  const { count } = await prisma.pendingMovement.updateMany({
    where: { id: pendingId, userId, status: 'pending' },
    data: { status: 'rejected' }
  });
  return count > 0;
}
