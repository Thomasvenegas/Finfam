/**
 * Categorías de gasto: una sola lista para toda la app.
 *
 * Debe incluir todas las que sugiere el backend al categorizar un comercio
 * (backend/src/services/fintoc.service.js); si no, lo categorizado automático
 * no aparecería en filtros ni presupuestos. Hay un test que lo vigila.
 */
export const CATEGORIAS = [
  'supermercado',
  'comida',
  'transporte',
  'vivienda',
  'cuentas',
  'hogar',
  'salud',
  'educación',
  'mascotas',
  'ropa',
  'cuidado personal',
  'tecnología',
  'suscripciones',
  'ocio',
  'deporte',
  'viajes',
  'regalos',
  'seguros',
  'otros'
];

/** Mismo formato que el pipe currency del resto de la app ($12,345). */
const formato = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'CLP', currencyDisplay: 'narrowSymbol', maximumFractionDigits: 0
});
export const clp = (n: number) => formato.format(n);
