import { OAuth2Client } from 'google-auth-library';
import { DEFAULT_BANK_SENDERS } from './email-parser.service.js';

/**
 * Lectura de solo lectura del Gmail del usuario, acotada a los correos de su
 * banco. Se habla con la API REST vía fetch para no arrastrar todo googleapis.
 *
 * Importante: aunque el permiso que concede Google es de lectura completa, la
 * consulta que se envía filtra por remitente, así que nunca se descargan
 * correos ajenos a los bancos vigilados.
 */

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/gmail.readonly'
];

export function oauthClient() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
    throw new Error('Faltan credenciales de Google para conectar Gmail');
  }
  return new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
}

export function isGmailConfigured() {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_REDIRECT_URI &&
    !process.env.GOOGLE_CLIENT_ID.startsWith('sandbox-placeholder')
  );
}

/** URL de consentimiento. `state` viaja de ida y vuelta para saber quién volvió. */
export function getAuthUrl(state) {
  return oauthClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',      // fuerza que Google entregue refresh_token
    scope: SCOPES,
    state
  });
}

/** Cambia el código por tokens y averigua qué cuenta se conectó. */
export async function exchangeCode(code) {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error('Google no entregó refresh token; revoca el acceso y reintenta');
  }

  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token,
    audience: process.env.GOOGLE_CLIENT_ID
  });

  return { refreshToken: tokens.refresh_token, email: ticket.getPayload()?.email || '' };
}

/** Un access token nuevo a partir del refresh token guardado. */
async function accessTokenFrom(refreshToken) {
  const client = oauthClient();
  client.setCredentials({ refresh_token: refreshToken });
  const { token } = await client.getAccessToken();
  if (!token) throw new Error('No se pudo renovar el acceso a Gmail');
  return token;
}

async function gmailFetch(path, accessToken) {
  const r = await fetch(`${GMAIL_API}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!r.ok) {
    const detail = await r.text();
    throw new Error(`Gmail API ${r.status}: ${detail.slice(0, 200)}`);
  }
  return r.json();
}

/**
 * Consulta de búsqueda: solo la bandeja de entrada, solo remitentes vigilados
 * y solo lo reciente.
 *
 * `in:inbox` deja fuera lo archivado, el spam, la papelera y los enviados. No
 * se restringe a la pestaña "Principal" (category:primary) a propósito: Gmail
 * suele clasificar los avisos de los bancos como "Actualizaciones", así que
 * filtrar por esa pestaña haría perder gastos en silencio.
 */
export function buildQuery(senders = DEFAULT_BANK_SENDERS, days = 7) {
  const list = (senders?.length ? senders : DEFAULT_BANK_SENDERS)
    .map(s => `from:${s}`)
    .join(' OR ');
  return `in:inbox (${list}) newer_than:${days}d`;
}

/** Decodifica el cuerpo del mensaje, prefiriendo texto plano sobre HTML. */
export function extractBody(payload) {
  if (!payload) return '';

  const decode = data => Buffer.from(data, 'base64url').toString('utf8');

  // Mensaje simple, sin partes.
  if (payload.body?.data && !payload.parts) return decode(payload.body.data);

  const parts = [];
  const walk = node => {
    if (!node) return;
    if (node.body?.data) parts.push({ type: node.mimeType, text: decode(node.body.data) });
    (node.parts || []).forEach(walk);
  };
  walk(payload);

  const plain = parts.find(p => p.type === 'text/plain');
  if (plain) return plain.text;

  const html = parts.find(p => p.type === 'text/html');
  return html ? html.text.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ') : '';
}

/** Aplana las cabeceras que nos interesan. */
export function extractHeaders(payload) {
  const headers = payload?.headers || [];
  const get = name => headers.find(h => h.name?.toLowerCase() === name)?.value || '';
  return { from: get('from'), subject: get('subject'), date: get('date') };
}

/**
 * Devuelve los correos bancarios recientes, ya normalizados para el parser.
 * @returns {Promise<Array<{id:string, from:string, subject:string, text:string, receivedAt:string}>>}
 */
export async function fetchBankEmails(refreshToken, { senders, days = 7, max = 25 } = {}) {
  const accessToken = await accessTokenFrom(refreshToken);
  const query = encodeURIComponent(buildQuery(senders, days));

  const list = await gmailFetch(`/messages?q=${query}&maxResults=${max}`, accessToken);
  const ids = (list.messages || []).map(m => m.id);

  const mails = [];
  for (const id of ids) {
    const msg = await gmailFetch(`/messages/${id}?format=full`, accessToken);
    const { from, subject, date } = extractHeaders(msg.payload);
    mails.push({
      id,
      from,
      subject,
      text: extractBody(msg.payload),
      receivedAt: date || new Date(Number(msg.internalDate)).toISOString()
    });
  }
  return mails;
}
