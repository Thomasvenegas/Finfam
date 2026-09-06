/**
 * Parser de correos de notificación bancaria (Chile).
 *
 * Objetivo: dado un correo reenviado desde Gmail, decidir si representa una
 * SALIDA de dinero y, si es así, extraer monto y comercio. Es multi-banco:
 * primero detecta el emisor por el remitente y luego aplica patrones genéricos
 * en español, de modo que agregar un banco nuevo sea agregar una línea a BANKS.
 *
 * Nunca inventa un gasto: si no logra un monto confiable devuelve null y el
 * correo se ignora (mejor perder una notificación que registrar un cobro falso).
 */

// Palabras que indican que salió dinero de la cuenta.
const OUTFLOW = /(compra|cargo|cargamos|pago|pagaste|giro|transferencia enviada|enviaste|transferiste|suscripci[oó]n|debitamos|d[eé]bito por|avance|retiro)/i;

// Entradas de dinero.
const INFLOW = /(abono|abonamos|dep[oó]sito|depositamos|transferencia recibida|te transfirieron|recibiste|acreditamos|devoluci[oó]n|reembolso|remuneraci[oó]n|sueldo)/i;

// Eventos que anulan el cargo aunque el correo hable de una compra.
// Ojo: en Chile "cancelar" suele significar pagar, por eso se exige el
// sustantivo al lado (compra/transacción/operación) en vez de la palabra sola.
const VETO = /(rechazad|fallid|no autorizad|revers[ao]|anulaci[oó]n|anulad|estado de cuenta|resumen mensual|(?:compra|transacci[oó]n|operaci[oó]n)\s+cancelad)/i;

// Publicidad del banco. Son el falso positivo más caro: hablan de "compras" y
// traen montos ("20% dcto", "hasta $50.000"), así que sin filtrarlas terminan
// descontando plata que nunca se gastó.
const PROMO = /(descuento|dcto\b|% ?off|promoci[oó]n|promo\b|oferta|aprovecha|benefici(?:o|os)\b|canjea|acumula|sorteo|concurso|participa|te invitamos|inscr[ií]bete|suscr[ií]bete|preaprobad|pre-?aprobad|aumenta tu cupo|black friday|cyber ?(?:day|monday|week)|hasta agotar stock|bases legales|v[aá]lid[ao] hasta|conoce m[aá]s|desc[uú]bre|imperdible|sin costo|cuotas sin inter[eé]s|\bclic aqu[ií]\b)/i;

// Señales de que el correo describe una transacción concreta y no una campaña.
// Si aparecen, mandan por sobre PROMO: un aviso de compra real puede mencionar
// los puntos acumulados o un beneficio sin dejar de ser un cargo.
const TRANSACTION = /(terminada? en|final(?:izada?)? en|\*{2,}\s*\d{3,4}|c[oó]digo de autorizaci[oó]n|n[uú]mero de (?:operaci[oó]n|transacci[oó]n)|comercio\s*:|fecha y hora|saldo disponible|se (?:ha\s+)?(?:realizad?[oa]|efectuad?[oa]|realiz[oó]|efectu[oó])|cargo en tu (?:cuenta|tarjeta)|has (?:recibido|realizado))/i;

/**
 * Dominios que se vigilan por defecto al conectar Gmail. Sirven para acotar la
 * búsqueda: así solo se descargan correos de bancos y no el resto de la bandeja.
 * El usuario puede agregar el suyo si su banco no está en la lista.
 */
export const DEFAULT_BANK_SENDERS = [
  'bancochile.cl', 'banchile.cl', 'santander.cl', 'bci.cl', 'bancoestado.cl',
  'bancofalabella.cl', 'falabella.com', 'itau.cl', 'scotiabank.cl',
  'bancoripley.cl', 'security.cl', 'bice.cl', 'consorcio.cl', 'coopeuch.cl',
  'tenpo.cl', 'soymach.com', 'mercadopago.cl'
];

/** Emisores conocidos, detectados por el dominio del remitente. */
const BANKS = [
  { name: 'Banco de Chile', match: /(bancochile|banchile)\./i },
  { name: 'Santander', match: /santander\./i },
  { name: 'BCI', match: /(bci|tbanc)\./i },
  { name: 'BancoEstado', match: /bancoestado\./i },
  { name: 'Banco Falabella', match: /falabella\./i },
  { name: 'Itaú', match: /itau\./i },
  { name: 'Scotiabank', match: /scotiabank\./i },
  { name: 'Banco Ripley', match: /ripley\./i },
  { name: 'Security', match: /security\./i },
  { name: 'Bice', match: /bice\./i },
  { name: 'Consorcio', match: /consorcio\./i },
  { name: 'Coopeuch', match: /coopeuch\./i },
  { name: 'Tenpo', match: /tenpo\./i },
  { name: 'Mach', match: /mach\./i },
  { name: 'Mercado Pago', match: /mercadopago\./i }
];

/**
 * Convierte un monto escrito en formato chileno a número.
 * "12.345" -> 12345 | "12.345,50" -> 12345.5 | "1,234.56" -> 1234.56
 */
export function parseAmount(raw = '') {
  // Se descartan separadores sueltos al inicio/fin ("300.000." -> "300.000").
  const cleaned = String(raw).replace(/[^\d.,]/g, '').replace(/^[.,]+|[.,]+$/g, '');
  if (!cleaned) return null;

  const lastDot = cleaned.lastIndexOf('.');
  const lastComma = cleaned.lastIndexOf(',');
  let normalized;

  if (lastDot === -1 && lastComma === -1) {
    normalized = cleaned;
  } else if (lastComma > lastDot) {
    // La coma es el separador decimal (formato chileno): 12.345,50
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  } else {
    const decimals = cleaned.length - lastDot - 1;
    // "12.345" con 3 dígitos finales es separador de miles, no decimal.
    normalized = decimals === 3
      ? cleaned.replace(/[.,]/g, '')
      : cleaned.replace(/,/g, '');
  }

  const value = Number(normalized);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Busca el monto del cargo. Muchos bancos incluyen también el saldo disponible,
 * así que se prefiere el monto que aparece más cerca (después) de la palabra
 * que denota el cargo.
 */
function extractAmount(text, anchorRe = OUTFLOW) {
  const candidates = [...text.matchAll(/(?:\$|CLP\$?)\s*(\d[\d.,]*\d|\d)/gi)]
    .map(m => ({ value: parseAmount(m[1]), index: m.index }))
    .filter(c => c.value);

  if (!candidates.length) {
    const withWord = text.match(/por\s+(\d[\d.,]*\d|\d)\s*pesos/i);
    return withWord ? parseAmount(withWord[1]) : null;
  }

  const anchor = text.search(anchorRe);
  if (anchor === -1) return candidates[0].value;

  const after = candidates.filter(c => c.index > anchor);
  return (after[0] || candidates[0]).value;
}

/** Extrae el nombre del comercio o destinatario. */
function extractMerchant(text, subject) {
  // Frases que cierran el nombre del comercio: fecha, medio de pago, monto...
  const END = String.raw`(?=\s+(?:el|los)\s+d[ií]a\b|\s+el\s+\d|\s+por\s+(?:\$|CLP)|\s+con\s+(?:tu\s+|su\s+|la\s+|el\s+)?(?:tarjeta|cuenta)|\s+a\s+las\s+\d|[.,;\n]|$)`;

  const patterns = [
    // "compra por $12.345 en LIDER EL BOSQUE el 05/09/2026"
    new RegExp(String.raw`\ben\s+(?:el\s+comercio\s+)?["']?(.{2,60}?)["']?` + END, 'i'),
    // "transferencia enviada a JUAN PEREZ"
    new RegExp(String.raw`\b(?:a|hacia)\s+(?:favor de\s+)?["']?([A-ZÁÉÍÓÚÑ].{1,59}?)["']?` + END),
    // "abono de MARIA SOTO" / "transferencia de JUAN"
    new RegExp(String.raw`\bde\s+(?:parte de\s+)?["']?([A-ZÁÉÍÓÚÑ].{1,59}?)["']?` + END),
    // "Comercio: LIDER"
    /\bcomercio\s*:\s*([^\n.,;]{2,60})/i,
    // "en el establecimiento LIDER"
    /\bestablecimiento\s+([^\n.,;]{2,60})/i
  ];

  for (const re of patterns) {
    const m = text.match(re);
    const merchant = m?.[1]?.trim().replace(/\s+/g, ' ');
    // Descarta capturas que en realidad son fragmentos de la frase.
    if (merchant && merchant.length >= 2 &&
        !/^(tu|su|la|el|los|las|una?|cuenta|tarjeta|pesos)$/i.test(merchant)) {
      return merchant;
    }
  }

  return subject?.trim() || 'Cargo bancario';
}

/** Lee la fecha del correo; si no la encuentra, usa la de recepción. */
function extractDate(text, receivedAt) {
  const m = text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/);
  if (m) {
    const [, d, mo, y] = m;
    const year = y.length === 2 ? 2000 + Number(y) : Number(y);
    const date = new Date(year, Number(mo) - 1, Number(d));
    if (!Number.isNaN(date.getTime())) return date;
  }
  return receivedAt ? new Date(receivedAt) : new Date();
}

/** Identifica el banco a partir del remitente. */
export function detectBank(from = '') {
  return BANKS.find(b => b.match.test(from))?.name || null;
}

/**
 * Analiza un correo bancario y lo clasifica como gasto o ingreso.
 * @returns {{type:'expense'|'income', amount:number, merchant:string,
 *            date:Date, bank:string|null}|null}
 */
export function parseBankEmail({ from = '', subject = '', text = '', receivedAt } = {}) {
  const body = `${subject}\n${text}`.replace(/\r/g, '');
  if (!body.trim()) return null;

  // Cargos que no llegaron a ocurrir: no mueven plata en ninguna dirección.
  if (VETO.test(body)) return null;

  // Publicidad: se descarta salvo que el correo traiga además una marca clara
  // de transacción (nº de tarjeta, código de autorización, saldo, etc.).
  if (PROMO.test(body) && !TRANSACTION.test(body)) return null;

  const outAt = body.search(OUTFLOW);
  const inAt = body.search(INFLOW);
  if (outAt === -1 && inAt === -1) return null;

  // Si el correo menciona ambas cosas, manda la que aparece primero
  // (el asunto suele decir de qué se trata: "Abono en tu cuenta...").
  let type;
  if (outAt === -1) type = 'income';
  else if (inAt === -1) type = 'expense';
  else type = inAt < outAt ? 'income' : 'expense';

  const amount = extractAmount(body, type === 'income' ? INFLOW : OUTFLOW);
  if (!amount) return null;

  return {
    type,
    amount,
    merchant: extractMerchant(body, subject),
    date: extractDate(body, receivedAt),
    bank: detectBank(from)
  };
}

/**
 * Normaliza el payload del correo según el proveedor de inbound parse que lo
 * envíe (Postmark, CloudMailin, SendGrid...), para que el resto del código
 * trabaje siempre con la misma forma.
 */
export function normalizeInbound(body = {}) {
  const headers = body.headers || {};
  const html = body.HtmlBody || body.html || '';
  const text = body.TextBody || body.plain || body.text ||
    // Si solo viene HTML, se limpian las etiquetas para poder aplicar el parser.
    html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');

  const recipients = [
    body.OriginalRecipient,
    body.To,
    ...(body.ToFull || []).map(t => t?.Email),
    body.envelope?.to,
    body.to,
    body.recipient
  ].filter(Boolean).join(' ');

  return {
    from: body.From || body.from || headers.from || '',
    subject: body.Subject || body.subject || headers.subject || '',
    text: (text || '').trim(),
    recipients,
    messageId: body.MessageID || body.message_id || headers.message_id || '',
    receivedAt: body.Date || body.date || headers.date || null
  };
}
