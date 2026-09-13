import test from 'node:test';
import assert from 'node:assert/strict';
import { categorize, REGLAS_CATEGORIA } from '../src/services/fintoc.service.js';

const casos = [
  // Los tres errores que tenía la versión anterior
  ['UBER EATS SANTIAGO', 'comida'],          // antes: transporte
  ['METROGAS', 'cuentas'],                    // antes: transporte
  ['CLÍNICA ALEMANA', 'salud'],               // antes: otros, por la tilde
  // Específicas antes que genéricas
  ['UBER TRIP', 'transporte'],
  ['METRO DE SANTIAGO', 'transporte'],
  ['CLINICA VETERINARIA LOS LEONES', 'mascotas'],
  ['PETROBRAS', 'transporte'],
  ['PRESTO CREDITOS', 'otros'],               // "presto" contiene "resto": no es comida
  // Costanera y Vespucio son autopistas y también malls
  ['COSTANERA NORTE TAG', 'transporte'],
  ['VESPUCIO SUR', 'transporte'],
  ['MALL PLAZA VESPUCIO', 'otros'],
  // Categorías nuevas
  ['SODIMAC CONSTITUCION', 'hogar'],
  ['PAGO DIVIDENDO HIPOTECARIO', 'vivienda'],
  ['GASTOS COMUNES EDIFICIO', 'vivienda'],
  ['NETFLIX.COM', 'suscripciones'],
  ['DUOC UC', 'educación'],
  ['ZARA COSTANERA', 'ropa'],
  ['PC FACTORY', 'tecnología'],
  ['LATAM AIRLINES', 'viajes'],
  ['SMART FIT', 'deporte'],
  ['PREUNIC', 'cuidado personal'],
  ['MAPFRE SEGUROS', 'seguros'],
  ['CINEMARK', 'ocio'],
  // Las de siempre siguen igual
  ['LIDER EXPRESS', 'supermercado'],
  ['FARMACIA CRUZ VERDE', 'salud'],
  ['PEDIDOSYA', 'comida'],
  ['KIOSCO DON PEPE', 'otros']
];

for (const [comercio, esperada] of casos) {
  test(`"${comercio}" -> ${esperada}`, () => assert.equal(categorize(comercio), esperada));
}

test('sin descripción cae en otros', () => {
  assert.equal(categorize(), 'otros');
  assert.equal(categorize(''), 'otros');
});

test('las categorías que sugiere el backend existen en el frontend', () => {
  // Debe calzar con frontend/src/app/core/categorias.ts: si el backend sugiere
  // una categoría que el frontend no lista, no aparece en filtros ni presupuestos.
  const frontend = ['supermercado', 'comida', 'transporte', 'vivienda', 'cuentas', 'hogar', 'salud', 'educación',
    'mascotas', 'ropa', 'cuidado personal', 'tecnología', 'suscripciones', 'ocio', 'deporte',
    'viajes', 'regalos', 'seguros', 'ahorro', 'otros'];
  for (const [cat] of REGLAS_CATEGORIA) assert.ok(frontend.includes(cat), `falta "${cat}" en el frontend`);
});
