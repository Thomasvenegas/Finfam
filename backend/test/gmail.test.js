import test from 'node:test';
import assert from 'node:assert/strict';
import { extractBody, extractHeaders, buildQuery } from '../src/services/gmail.service.js';
import { parseBankEmail } from '../src/services/email-parser.service.js';

const b64 = s => Buffer.from(s, 'utf8').toString('base64url');

test('extrae el cuerpo de un mensaje simple', () => {
  const body = extractBody({ body: { data: b64('Compra por $1.000 en KIOSCO.') } });
  assert.equal(body, 'Compra por $1.000 en KIOSCO.');
});

test('prefiere text/plain sobre text/html en un multipart', () => {
  const payload = {
    mimeType: 'multipart/alternative',
    parts: [
      { mimeType: 'text/plain', body: { data: b64('version texto') } },
      { mimeType: 'text/html', body: { data: b64('<p>version html</p>') } }
    ]
  };
  assert.equal(extractBody(payload), 'version texto');
});

test('si solo hay HTML lo limpia y queda parseable', () => {
  const payload = {
    mimeType: 'multipart/alternative',
    parts: [{ mimeType: 'text/html', body: { data: b64('<p>Compra por <b>$9.500</b> en JUMBO KENNEDY.</p>') } }]
  };
  const r = parseBankEmail({ from: 'x@bancochile.cl', subject: 'Compra', text: extractBody(payload) });
  assert.equal(r.amount, 9500);
  assert.equal(r.merchant, 'JUMBO KENNEDY');
});

test('recorre partes anidadas (multipart dentro de multipart)', () => {
  const payload = {
    mimeType: 'multipart/mixed',
    parts: [
      { mimeType: 'multipart/alternative', parts: [
        { mimeType: 'text/plain', body: { data: b64('cargo por $2.500 en FERIA') } }
      ]},
      { mimeType: 'application/pdf', body: { attachmentId: 'x' } }
    ]
  };
  assert.match(extractBody(payload), /FERIA/);
});

test('mensaje sin cuerpo devuelve string vacío', () => {
  assert.equal(extractBody(null), '');
  assert.equal(extractBody({ parts: [] }), '');
});

test('lee las cabeceras sin importar mayúsculas', () => {
  const h = extractHeaders({ headers: [
    { name: 'From', value: 'enviodigital@bancochile.cl' },
    { name: 'SUBJECT', value: 'Compra con Tarjeta' },
    { name: 'Date', value: 'Sat, 5 Sep 2026 10:00:00 -0400' }
  ]});
  assert.equal(h.from, 'enviodigital@bancochile.cl');
  assert.equal(h.subject, 'Compra con Tarjeta');
  assert.match(h.date, /2026/);
});

test('la consulta filtra por remitente: no baja correo ajeno al banco', () => {
  const q = buildQuery(['bancochile.cl', 'santander.cl'], 7);
  assert.equal(q, '(from:bancochile.cl OR from:santander.cl) newer_than:7d');
});

test('sin remitentes propios usa la lista por defecto', () => {
  assert.match(buildQuery([], 3), /from:bancochile\.cl/);
  assert.match(buildQuery(undefined, 3), /newer_than:3d/);
});
