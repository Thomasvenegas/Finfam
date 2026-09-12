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
/**
 * Categoría sugerida a partir del nombre del comercio. Es solo una sugerencia:
 * el usuario la corrige al confirmar o al editar el movimiento.
 *
 * El orden importa, porque gana la primera regla que calce: las específicas van
 * antes que las genéricas. Antes "UBER EATS" caía en transporte (calzaba "uber")
 * y "METROGAS" también (calzaba "metro").
 */
export const REGLAS_CATEGORIA = [
  ['suscripciones', /(netflix|spotify|disney|hbo|prime video|amazon prime|youtube premium|paramount|crunchyroll|icloud|google one|apple\.com\/bill|itunes)/],
  ['comida', /(uber ?eats|pedidos ?ya|rappi|restaurant|restoran|\bresto|mcdonald|burger|kfc|subway|domino|papa john|starbucks|juan maestro|doggis|sushi|pizza|cafeter|\bcafe\b)/],
  ['mascotas', /(veterinari|petco|superzoo|puppis|mascota|pet ?shop)/],
  ['vivienda', /(arriendo|dividendo|hipotecari|gastos comunes|condominio)/],
  ['cuentas', /(enel|aguas|metrogas|lipigas|abastible|gasco|\bcge\b|chilquinta|esval|essbio|vtr|movistar|entel|\bwom\b|\bclaro\b|gtd|mundo pacifico)/],
  ['transporte', /(copec|shell|petrobras|aramco|\benex\b|\buber\b|cabify|didi|\bmetro\b|\bbip\b|turbus|pullman|autopista|costanera norte|vespucio (?:norte|sur)|\btag\b|estacionamiento|parking|red movilidad)/],
  ['supermercado', /(lider|jumbo|tottus|unimarc|santa isabel|acuenta|ekono|\balvi\b|mayorista|oxxo)/],
  ['salud', /(farmacia|cruz verde|salcobrand|ahumada|clinica|isapre|dentist|laboratorio|optica|integramedica|redsalud|medic)/],
  ['hogar', /(sodimac|homecenter|\beasy\b|construmart|ikea|casaideas|ferreter|mueble|imperial|chilemat)/],
  ['educación', /(colegio|universidad|instituto|duoc|inacap|udemy|coursera|platzi|librer|buscalibre|matricula|arancel|jardin infantil)/],
  ['ropa', /(zara|h ?& ?m|forever ?21|adidas|nike|\bbata\b|skechers|tricot|corona|hites|la polar|calzado|zapat|vestuario)/],
  ['tecnología', /(pc ?factory|apple store|mac ?online|samsung|sp ?digital|microplay)/],
  ['viajes', /(latam|sky ?airline|jetsmart|booking|airbnb|hotel|despegar|expedia|aeropuerto|turismo)/],
  ['deporte', /(smart ?fit|sportlife|pacific fitness|gimnasio|\bgym\b|decathlon|crossfit)/],
  ['cuidado personal', /(peluquer|barber|preunic|maicao|\bdbs\b|\bspa\b|manicur|cosmetic|estetica)/],
  ['seguros', /(seguro|mapfre|zurich|\bhdi\b|liberty|\bsura\b|metlife)/],
  ['ocio', /(cine|hoyts|cinemark|steam|playstation|xbox|nintendo|concierto|ticketmaster|puntoticket|teatro)/]
];

export function categorize(description = '') {
  // Sin tildes: si no, "CLÍNICA" no calzaba con "clinica".
  const d = String(description).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return REGLAS_CATEGORIA.find(([, re]) => re.test(d))?.[0] || 'otros';
}
