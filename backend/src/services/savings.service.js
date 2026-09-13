/**
 * Ahorros registrados como gasto de categoría "ahorro": salen del saldo como
 * cualquier gasto y además se suman a una meta. Todo cambio en ese gasto
 * (monto, categoría, meta, borrado) tiene que reflejarse en la meta; si no,
 * lo ahorrado se desfasa de lo que dice el historial.
 */

class ErrorAhorro extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.status = 400; // el manejador de errores respeta err.status
  }
}

/** Lo que un gasto aporta a una meta, o null si no aporta nada. */
export function aporteDe(gasto) {
  if (!gasto || gasto.category !== 'ahorro' || !gasto.goalId) return null;
  return { goalId: gasto.goalId, monto: Number(gasto.amount) };
}

/**
 * Movimientos a aplicar en las metas para pasar del aporte anterior al nuevo.
 * Si es la misma meta se aplica solo la diferencia: descontar el monto viejo y
 * sumar el nuevo por separado podría chocar con la validación de saldo de la
 * meta aunque el resultado final fuera válido.
 */
export function planAporte(antes, despues) {
  if (antes && despues && antes.goalId === despues.goalId) {
    const delta = despues.monto - antes.monto;
    return delta ? [{ goalId: antes.goalId, delta }] : [];
  }
  return [
    ...(antes ? [{ goalId: antes.goalId, delta: -antes.monto }] : []),
    ...(despues ? [{ goalId: despues.goalId, delta: despues.monto }] : [])
  ];
}

/** Aplica el plan dentro de una transacción de Prisma. */
export async function aplicarAporte(tx, userId, antes, despues) {
  for (const { goalId, delta } of planAporte(antes, despues)) {
    // Descontar solo si la meta tiene con qué: la condición va en el mismo
    // UPDATE, igual que en los retiros, para que no quede en negativo.
    const { count } = await tx.savingsGoal.updateMany({
      where: { id: goalId, userId, ...(delta < 0 ? { saved: { gte: -delta } } : {}) },
      data: { saved: { increment: delta } }
    });
    if (!count) {
      throw new ErrorAhorro(delta < 0
        ? 'No se puede quitar este ahorro: la meta ya tiene retiros por más de lo que quedaría.'
        : 'La meta de ahorro no existe.');
    }
  }
}

export { ErrorAhorro };
