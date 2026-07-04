/**
 * Integración con Fintoc (https://docs.fintoc.com)
 * ------------------------------------------------
 * Los bancos chilenos no exponen APIs públicas a particulares, por lo que la
 * vía estándar es un agregador. Fintoc soporta, entre otros:
 *   cl_banco_de_chile, cl_banco_santander, cl_banco_bci, cl_banco_estado,
 *   cl_banco_itau, cl_banco_scotiabank, cl_banco_falabella
 *
 * Flujo:
 * 1. El frontend abre el widget de Fintoc; el usuario ingresa sus credenciales
 *    directamente en el widget (nunca pasan por nuestro servidor).
 * 2. Fintoc devuelve un link_token que guardamos en BankLink.
 * 3. Fintoc envía webhooks con cada movimiento nuevo -> se crea el Expense
 *    y el socket actualiza el dashboard en tiempo real.
 */
const FINTOC_API = 'https://api.fintoc.com/v1';

const headers = () => ({
  Authorization: process.env.FINTOC_SECRET_KEY,
  'Content-Type': 'application/json'
});

export async function listAccounts(linkToken) {
  const r = await fetch(`${FINTOC_API}/accounts?link_token=${linkToken}`, { headers: headers() });
  if (!r.ok) throw new Error(`Fintoc accounts: ${r.status}`);
  return r.json();
}

export async function listMovements(linkToken, accountId, since) {
  const url = new URL(`${FINTOC_API}/accounts/${accountId}/movements`);
  url.searchParams.set('link_token', linkToken);
  if (since) url.searchParams.set('since', since);
  const r = await fetch(url, { headers: headers() });
  if (!r.ok) throw new Error(`Fintoc movements: ${r.status}`);
  return r.json();
}

/** Clasificación simple por palabras clave del comercio. */
export function categorize(description = '') {
  const d = description.toLowerCase();
  if (/(lider|jumbo|tottus|unimarc|santa isabel|acuenta)/.test(d)) return 'supermercado';
  if (/(copec|shell|petrobras|uber|cabify|didi|metro|bip)/.test(d)) return 'transporte';
  if (/(farmacia|cruz verde|salcobrand|ahumada|clinica|isapre)/.test(d)) return 'salud';
  if (/(netflix|spotify|disney|hbo|cine|steam)/.test(d)) return 'ocio';
  if (/(enel|aguas|metrogas|vtr|movistar|entel|wom|gtd)/.test(d)) return 'cuentas';
  if (/(restaurant|resto|pedidosya|rappi|uber eats|mcdonald|burger)/.test(d)) return 'comida';
  return 'otros';
}
