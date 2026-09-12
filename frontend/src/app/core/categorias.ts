/** Categorías de gasto: una sola lista para toda la app. */
export const CATEGORIAS = ['supermercado', 'comida', 'transporte', 'salud', 'cuentas', 'ocio', 'otros'];

/** Mismo formato que el pipe currency del resto de la app ($12,345). */
const formato = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'CLP', currencyDisplay: 'narrowSymbol', maximumFractionDigits: 0
});
export const clp = (n: number) => formato.format(n);
