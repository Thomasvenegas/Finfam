import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMonth, shiftMonth, projectMonthEnd, variation,
  budgetStatus, upcomingPayments, toCsv
} from '../src/services/finance.service.js';

test('parseMonth entrega el rango y descarta formatos inválidos', () => {
  const sep = parseMonth('2026-09');
  assert.equal(sep.daysInMonth, 30);
  assert.equal(sep.start.getDate(), 1);
  assert.equal(parseMonth('2028-02').daysInMonth, 29); // bisiesto
  assert.equal(parseMonth('2026-13'), null);
  assert.equal(parseMonth('septiembre'), null);
  assert.equal(parseMonth(undefined), null);
});

test('shiftMonth cruza el cambio de año', () => {
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2025-12', 1), '2026-01');
  assert.equal(shiftMonth('2026-09', -1), '2026-08');
});

test('la proyección extiende el ritmo de gasto variable al mes completo', () => {
  const p = projectMonthEnd({ income: 1000000, fixed: 300000, variable: 100000, dayOfMonth: 10, daysInMonth: 30 });
  assert.equal(p.projectedVariable, 300000);
  assert.equal(p.projectedAvailable, 400000);
  assert.equal(p.preliminar, false);
});

test('los primeros días la proyección se marca como preliminar', () => {
  assert.equal(projectMonthEnd({ income: 1, fixed: 0, variable: 1, dayOfMonth: 2, daysInMonth: 30 }).preliminar, true);
});

test('variation no inventa un porcentaje sin base', () => {
  assert.equal(variation(150, 100), 50);
  assert.equal(variation(50, 100), -50);
  assert.equal(variation(500, 0), null);
});

test('budgetStatus avisa al 80% y marca excedido al 100%', () => {
  assert.equal(budgetStatus(79000, 100000).level, 'ok');
  assert.equal(budgetStatus(80000, 100000).level, 'alerta');
  assert.equal(budgetStatus(100000, 100000).level, 'excedido');
  assert.equal(budgetStatus(120000, 100000).remaining, -20000);
});

test('upcomingPayments: próximos, ordenados, y un 31 en febrero se corre al 28', () => {
  const hoy = new Date(2026, 1, 20); // 20 de febrero de 2026 (no bisiesto)
  const fijos = [
    { id: 'a', label: 'Colegio', amount: 1, category: 'cuentas', dueDay: 5 },   // 5 de marzo: 13 días
    { id: 'b', label: 'Luz', amount: 1, category: 'cuentas', dueDay: 22 },      // 2 días
    { id: 'c', label: 'Dividendo', amount: 1, category: 'cuentas', dueDay: 31 },// 28 de feb: 8 días
    { id: 'd', label: 'Hoy', amount: 1, category: 'cuentas', dueDay: 20 },      // vence hoy
    { id: 'e', label: 'Sin día', amount: 1, category: 'cuentas', dueDay: null }
  ];
  const r = upcomingPayments(fijos, hoy, 10);
  assert.deepEqual(r.map(p => [p.label, p.daysLeft]), [['Hoy', 0], ['Luz', 2], ['Dividendo', 8]]);
  assert.equal(r.find(p => p.label === 'Dividendo').dueDate.getDate(), 28);
});

test('toCsv: BOM, separador ";" y comillas escapadas', () => {
  const csv = toCsv(
    [{ d: 'Líder', m: 12345 }, { d: 'Uno; dos', m: 1 }, { d: 'Dijo "hola"', m: 2 }],
    [{ titulo: 'Descripción', valor: r => r.d }, { titulo: 'Monto', valor: r => r.m }]
  );
  assert.ok(csv.startsWith('﻿'));
  const lineas = csv.slice(1).split('\r\n');
  assert.equal(lineas[0], 'Descripción;Monto');
  assert.equal(lineas[1], 'Líder;12345');
  assert.equal(lineas[2], '"Uno; dos";1');
  assert.equal(lineas[3], '"Dijo ""hola""";2');
});

test('toCsv neutraliza fórmulas que vendrían en la glosa de un correo', () => {
  const csv = toCsv([{ d: '=HYPERLINK("http://x")' }, { d: -500 }],
    [{ titulo: 'D', valor: r => r.d }]);
  const lineas = csv.slice(1).split('\r\n');
  assert.equal(lineas[1], `"'=HYPERLINK(""http://x"")"`);
  assert.equal(lineas[2], '-500'); // un número negativo no se toca
});
