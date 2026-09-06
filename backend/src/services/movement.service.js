import { prisma } from '../lib/prisma.js';
import { emitExpenseCreated, emitIncomeCreated } from '../server.js';
import { categorize } from './fintoc.service.js';
import { parseBankEmail } from './email-parser.service.js';

/**
 * Convierte un correo bancario en un movimiento del usuario.
 *
 * Lo usan las dos vías de ingesta (el webhook de reenvío y la lectura directa
 * de Gmail), así que la clasificación y la deduplicación viven en un solo lugar.
 *
 * @param {string} userId
 * @param {{from:string, subject:string, text:string, receivedAt?:string}} mail
 * @param {string} [externalId] id estable del correo, para no duplicar
 * @returns {Promise<{created:'expense'|'income'|null, reason?:string, amount?:number}>}
 */
export async function recordEmailMovement(userId, mail, externalId) {
  const parsed = parseBankEmail(mail);
  if (!parsed) return { created: null, reason: 'no mueve dinero' };

  if (parsed.type === 'income') {
    if (externalId) {
      const dup = await prisma.income.findUnique({ where: { externalId } });
      if (dup) return { created: null, reason: 'duplicado' };
    }
    const income = await prisma.income.create({
      data: {
        userId,
        label: parsed.merchant,
        amount: parsed.amount,
        recurring: false, // ingreso puntual del mes, no un sueldo fijo
        externalId,
        date: parsed.date
      }
    });
    emitIncomeCreated(userId, income);
    return { created: 'income', amount: parsed.amount, bank: parsed.bank };
  }

  if (externalId) {
    const dup = await prisma.expense.findUnique({ where: { externalId } });
    if (dup) return { created: null, reason: 'duplicado' };
  }
  const expense = await prisma.expense.create({
    data: {
      userId,
      description: parsed.merchant,
      amount: parsed.amount,
      category: categorize(parsed.merchant),
      source: 'email',
      externalId,
      date: parsed.date
    }
  });
  emitExpenseCreated(userId, expense);
  return { created: 'expense', amount: parsed.amount, bank: parsed.bank };
}
