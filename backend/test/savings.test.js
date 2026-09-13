import test from 'node:test';
import assert from 'node:assert/strict';
import { aporteDe, planAporte } from '../src/services/savings.service.js';

test('solo aporta un gasto de categoría ahorro con meta', () => {
  assert.deepEqual(aporteDe({ category: 'ahorro', goalId: 'g1', amount: '50000' }), { goalId: 'g1', monto: 50000 });
  assert.equal(aporteDe({ category: 'ocio', goalId: 'g1', amount: 50000 }), null);
  assert.equal(aporteDe({ category: 'ahorro', goalId: null, amount: 50000 }), null);
  assert.equal(aporteDe(null), null);
});

test('registrar un ahorro suma a su meta', () => {
  assert.deepEqual(planAporte(null, { goalId: 'g1', monto: 50000 }), [{ goalId: 'g1', delta: 50000 }]);
});

test('borrar un ahorro lo descuenta de su meta', () => {
  assert.deepEqual(planAporte({ goalId: 'g1', monto: 50000 }, null), [{ goalId: 'g1', delta: -50000 }]);
});

test('cambiar el monto en la misma meta aplica solo la diferencia', () => {
  assert.deepEqual(planAporte({ goalId: 'g1', monto: 50000 }, { goalId: 'g1', monto: 30000 }), [{ goalId: 'g1', delta: -20000 }]);
  assert.deepEqual(planAporte({ goalId: 'g1', monto: 30000 }, { goalId: 'g1', monto: 30000 }), []);
});

test('mover el ahorro a otra meta descuenta de una y suma a la otra', () => {
  assert.deepEqual(planAporte({ goalId: 'g1', monto: 50000 }, { goalId: 'g2', monto: 50000 }),
    [{ goalId: 'g1', delta: -50000 }, { goalId: 'g2', delta: 50000 }]);
});

test('cambiar la categoría de ahorro a otra devuelve el aporte', () => {
  const antes = aporteDe({ category: 'ahorro', goalId: 'g1', amount: 40000 });
  const despues = aporteDe({ category: 'ocio', goalId: 'g1', amount: 40000 });
  assert.deepEqual(planAporte(antes, despues), [{ goalId: 'g1', delta: -40000 }]);
});
