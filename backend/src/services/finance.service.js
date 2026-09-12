/**
 * Cálculos financieros puros, sin base de datos, para poder testearlos.
 * Los usan el resumen del mes y el historial de movimientos.
 */

/** "2026-09" -> rango del mes; cualquier otra cosa -> null. */
export function parseMonth(clave) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(clave ?? ''));
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0, 23, 59, 59, 999);
  return { key: clave, year, month, start, end, daysInMonth: end.getDate() };
}

export function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** Desplaza un mes: ("2026-01", -1) -> "2025-12". */
export function shiftMonth(clave, delta) {
  const r = parseMonth(clave);
  if (!r) return null;
  return monthKey(new Date(r.year, r.month - 1 + delta, 1));
}

/**
 * Proyección lineal del gasto variable al cierre del mes. Los gastos fijos no
 * se proyectan: ya están comprometidos completos desde el día 1.
 */
export function projectMonthEnd({ income, fixed, variable, dayOfMonth, daysInMonth }) {
  const dias = Math.max(1, Math.min(dayOfMonth, daysInMonth));
  const projectedVariable = Math.round((variable / dias) * daysInMonth);
  return {
    projectedVariable,
    projectedAvailable: income - fixed - projectedVariable,
    // Con pocos días el ritmo aún no es representativo: un solo gasto grande
    // el día 1 dispara la proyección.
    preliminar: dias < 5
  };
}

/** Variación porcentual; null si no hay base con qué comparar. */
export function variation(actual, anterior) {
  if (!anterior) return null;
  return Math.round(((actual - anterior) / anterior) * 100);
}

/** Estado de un presupuesto según cuánto va gastado. */
export function budgetStatus(spent, limit) {
  const pct = limit > 0 ? Math.round((spent / limit) * 100) : 0;
  const level = pct >= 100 ? 'excedido' : pct >= 80 ? 'alerta' : 'ok';
  return { spent, limit, remaining: limit - spent, pct, level };
}

function fechaDePago(year, monthIndex, dueDay) {
  const ultimo = new Date(year, monthIndex + 1, 0).getDate();
  return new Date(year, monthIndex, Math.min(dueDay, ultimo));
}

/**
 * Gastos fijos que vencen dentro de los próximos `dias`. Si el día de pago no
 * existe en el mes (un 31 en febrero) se corre al último día.
 */
export function upcomingPayments(fixedExpenses, today, dias = 7) {
  const hoy = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return fixedExpenses
    .filter(f => f.dueDay)
    .map(f => {
      let venc = fechaDePago(hoy.getFullYear(), hoy.getMonth(), f.dueDay);
      if (venc < hoy) venc = fechaDePago(hoy.getFullYear(), hoy.getMonth() + 1, f.dueDay);
      return {
        id: f.id,
        label: f.label,
        amount: Number(f.amount),
        category: f.category,
        dueDate: venc,
        // round y no floor: el cambio de horario hace que un día mida 23 o 25 h
        daysLeft: Math.round((venc - hoy) / 864e5)
      };
    })
    .filter(p => p.daysLeft <= dias)
    .sort((a, b) => a.daysLeft - b.daysLeft);
}

/**
 * CSV pensado para Excel en español: separador ";" porque en Chile la coma es
 * el separador decimal, y BOM para que Excel respete tildes y eñes.
 */
export function toCsv(rows, columnas) {
  const esc = v => {
    if (v == null) return '';
    let s = String(v);
    // Excel ejecuta como fórmula un texto que empieza con = + - @. Las glosas
    // vienen de correos de terceros, así que se neutralizan con un apóstrofo.
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const cabecera = columnas.map(c => esc(c.titulo)).join(';');
  const cuerpo = rows.map(r => columnas.map(c => esc(c.valor(r))).join(';'));
  return '﻿' + [cabecera, ...cuerpo].join('\r\n');
}
