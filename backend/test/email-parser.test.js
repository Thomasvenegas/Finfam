import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBankEmail, parseAmount, detectBank, normalizeInbound } from '../src/services/email-parser.service.js';

test('parseAmount entiende el formato chileno', () => {
  assert.equal(parseAmount('12.345'), 12345);
  assert.equal(parseAmount('1.234.567'), 1234567);
  assert.equal(parseAmount('12.345,50'), 12345.5);
  assert.equal(parseAmount('990'), 990);
  assert.equal(parseAmount('$ 45.000'), 45000);
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount('0'), null);
});

test('detecta el banco por el remitente', () => {
  assert.equal(detectBank('enviodigital@bancochile.cl'), 'Banco de Chile');
  assert.equal(detectBank('no-reply@santander.cl'), 'Santander');
  assert.equal(detectBank('alertas@bci.cl'), 'BCI');
  assert.equal(detectBank('random@gmail.com'), null);
});

test('Banco de Chile: compra con tarjeta', () => {
  const r = parseBankEmail({
    from: 'enviodigital@bancochile.cl',
    subject: 'Compra con Tarjeta de Crédito',
    text: 'Te informamos que se ha realizado una compra por $12.345 en LIDER EL BOSQUE el 05/09/2026.'
  });
  assert.equal(r.type, 'expense');
  assert.equal(r.amount, 12345);
  assert.equal(r.merchant, 'LIDER EL BOSQUE');
  assert.equal(r.bank, 'Banco de Chile');
});

test('Santander: compra con débito', () => {
  const r = parseBankEmail({
    from: 'notificaciones@santander.cl',
    subject: 'Notificación de compra',
    text: 'Compra por $8.990 en UBER TRIP con Tarjeta de Débito ****1234 el 04/09/2026.'
  });
  assert.equal(r.amount, 8990);
  assert.equal(r.merchant, 'UBER TRIP');
});

test('BCI: cargo', () => {
  const r = parseBankEmail({
    from: 'alertas@bci.cl',
    subject: 'Aviso de cargo',
    text: 'Se ha efectuado una compra por $45.000 en FARMACIA CRUZ VERDE.'
  });
  assert.equal(r.amount, 45000);
  assert.equal(r.merchant, 'FARMACIA CRUZ VERDE');
});

test('BancoEstado: transferencia enviada', () => {
  const r = parseBankEmail({
    from: 'no-responder@bancoestado.cl',
    subject: 'Transferencia realizada',
    text: 'Transferencia enviada por $150.000 a JUAN PEREZ el 03/09/2026.'
  });
  assert.equal(r.type, 'expense');
  assert.equal(r.amount, 150000);
  assert.equal(r.merchant, 'JUAN PEREZ');
});

test('monto con CLP en vez de $', () => {
  const r = parseBankEmail({
    from: 'avisos@itau.cl',
    subject: 'Compra',
    text: 'Compra por CLP 23.500 en COPEC LAS CONDES.'
  });
  assert.equal(r.amount, 23500);
});

test('reconoce abonos como ingreso', () => {
  const abono = parseBankEmail({
    from: 'enviodigital@bancochile.cl',
    subject: 'Abono en tu cuenta',
    text: 'Te informamos de un abono por $500.000 en tu cuenta corriente.'
  });
  assert.equal(abono.type, 'income');
  assert.equal(abono.amount, 500000);

  const transferencia = parseBankEmail({
    from: 'no-responder@bancoestado.cl',
    subject: 'Transferencia recibida',
    text: 'Has recibido una transferencia por $80.000 de MARIA SOTO.'
  });
  assert.equal(transferencia.type, 'income');
  assert.equal(transferencia.amount, 80000);
  assert.equal(transferencia.merchant, 'MARIA SOTO');
});

test('un correo que menciona ambas cosas se resuelve por lo que aparece primero', () => {
  // El asunto manda: es un abono, aunque el cuerpo hable de compras.
  const r = parseBankEmail({
    from: 'enviodigital@bancochile.cl',
    subject: 'Abono en tu cuenta',
    text: 'Abono por $300.000. Recuerda que tus compras del mes suman $120.000.'
  });
  assert.equal(r.type, 'income');
  assert.equal(r.amount, 300000);
});

test('las devoluciones cuentan como ingreso', () => {
  const r = parseBankEmail({
    from: 'notificaciones@santander.cl',
    subject: 'Devolución de compra',
    text: 'Se realizó una devolución por $15.000 de FALABELLA.'
  });
  assert.equal(r.type, 'income');
  assert.equal(r.amount, 15000);
});

test('ignora reversos, rechazos y resúmenes', () => {
  assert.equal(parseBankEmail({
    from: 'alertas@bci.cl',
    subject: 'Compra rechazada',
    text: 'Su compra por $10.000 en AMAZON fue rechazada.'
  }), null);

  assert.equal(parseBankEmail({
    from: 'enviodigital@bancochile.cl',
    subject: 'Estado de cuenta',
    text: 'Tu estado de cuenta del mes está disponible. Saldo disponible $250.000.'
  }), null);
});

test('sin monto no inventa un gasto', () => {
  assert.equal(parseBankEmail({
    from: 'enviodigital@bancochile.cl',
    subject: 'Compra realizada',
    text: 'Se realizó una compra con tu tarjeta.'
  }), null);
  assert.equal(parseBankEmail({}), null);
});

test('banco desconocido igual se parsea (patrón genérico)', () => {
  const r = parseBankEmail({
    from: 'avisos@bancoquenoconozco.cl',
    subject: 'Compra',
    text: 'Pago por $3.500 en STARBUCKS PROVIDENCIA.'
  });
  assert.equal(r.amount, 3500);
  assert.equal(r.merchant, 'STARBUCKS PROVIDENCIA');
  assert.equal(r.bank, null);
});

test('elige el monto del cargo, no el saldo disponible', () => {
  const r = parseBankEmail({
    from: 'enviodigital@bancochile.cl',
    subject: 'Compra con Tarjeta de Débito',
    text: 'Estimado cliente, se realizó una compra por $7.990 en SPOTIFY. Tu saldo disponible es $432.100.'
  });
  assert.equal(r.amount, 7990);
  assert.equal(r.merchant, 'SPOTIFY');
});

test('monto sin separador de miles', () => {
  const r = parseBankEmail({
    from: 'alertas@tenpo.cl',
    subject: 'Pago realizado',
    text: 'Pagaste $990 en METRO DE SANTIAGO.'
  });
  assert.equal(r.amount, 990);
});

test('usa la fecha de recepción si el correo no trae fecha', () => {
  const receivedAt = '2026-09-01T12:00:00.000Z';
  const r = parseBankEmail({
    from: 'alertas@bci.cl',
    subject: 'Compra',
    text: 'Compra por $5.000 en KIOSCO.',
    receivedAt
  });
  assert.equal(r.date.toISOString(), receivedAt);
});

// --- normalizeInbound: cada proveedor de inbound parse manda otra forma ---

test('normaliza payload de Postmark', () => {
  const n = normalizeInbound({
    From: 'enviodigital@bancochile.cl',
    Subject: 'Compra con Tarjeta',
    TextBody: 'Compra por $1.000 en KIOSCO.',
    ToFull: [{ Email: 'finfam+ab12cd34ef56@inbound.postmarkapp.com' }],
    MessageID: 'abc-123'
  });
  assert.equal(n.from, 'enviodigital@bancochile.cl');
  assert.equal(n.messageId, 'abc-123');
  assert.match(n.recipients, /\+ab12cd34ef56@/);
});

test('normaliza payload de CloudMailin', () => {
  const n = normalizeInbound({
    envelope: { to: 'finfam+ab12cd34ef56@cloudmailin.net', from: 'alertas@bci.cl' },
    headers: { from: 'alertas@bci.cl', subject: 'Cargo', message_id: 'cm-9' },
    plain: 'Compra por $2.000 en FERIA.'
  });
  assert.equal(n.from, 'alertas@bci.cl');
  assert.equal(n.subject, 'Cargo');
  assert.equal(n.messageId, 'cm-9');
  assert.match(n.recipients, /\+ab12cd34ef56@/);
});

test('si solo viene HTML, lo convierte a texto parseable', () => {
  const n = normalizeInbound({
    from: 'notificaciones@santander.cl',
    subject: 'Compra',
    html: '<html><body><p>Compra por <b>$9.500</b> en JUMBO KENNEDY.</p></body></html>',
    to: 'finfam+deadbeef1234@inbound.postmarkapp.com'
  });
  const r = parseBankEmail(n);
  assert.equal(r.amount, 9500);
  assert.equal(r.merchant, 'JUMBO KENNEDY');
});

test('monto al final de la frase no arrastra el punto', () => {
  assert.equal(parseAmount('300.000.'), 300000);
  const r = parseBankEmail({
    from: 'alertas@bci.cl',
    subject: 'Compra',
    text: 'Se realizó una compra por $12.500.'
  });
  assert.equal(r.amount, 12500);
});

// --- Publicidad del banco: el falso positivo más caro ---

test('descarta promoción con descuento aunque hable de compras', () => {
  assert.equal(parseBankEmail({
    from: 'comunicaciones@bancochile.cl',
    subject: '¡Aprovecha 20% de descuento!',
    text: 'Aprovecha un descuento de $10.000 en tu próxima compra pagando con tu Tarjeta de Crédito.'
  }), null);
});

test('descarta oferta de cupo preaprobado', () => {
  assert.equal(parseBankEmail({
    from: 'ofertas@santander.cl',
    subject: 'Tu cupo preaprobado te espera',
    text: 'Tienes un cupo preaprobado de $2.000.000 para tus compras. Solicítalo hoy.'
  }), null);
});

test('descarta campaña de Cyber con cuotas sin interés', () => {
  assert.equal(parseBankEmail({
    from: 'marketing@bci.cl',
    subject: 'Cyber Monday en tus comercios favoritos',
    text: 'Compra en cuotas sin interés y obtén descuentos de hasta $50.000.'
  }), null);
});

test('descarta invitación a acumular puntos', () => {
  assert.equal(parseBankEmail({
    from: 'beneficios@falabella.com',
    subject: 'Canjea tus puntos',
    text: 'Participa y canjea tus puntos por una compra de hasta $30.000. Bases legales en el sitio.'
  }), null);
});

test('una compra real sobrevive aunque mencione beneficios', () => {
  // El caso difícil: el aviso trae lenguaje de campaña pero es un cargo real.
  const r = parseBankEmail({
    from: 'enviodigital@bancochile.cl',
    subject: 'Compra con Tarjeta de Crédito',
    text: 'Se realizó una compra por $12.000 en LIDER con tu tarjeta terminada en 1234. '
        + 'Acumula puntos con cada compra.'
  });
  assert.equal(r.type, 'expense');
  assert.equal(r.amount, 12000);
});

test('un abono real sobrevive aunque el pie traiga publicidad', () => {
  const r = parseBankEmail({
    from: 'no-responder@bancoestado.cl',
    subject: 'Transferencia recibida',
    text: 'Has recibido una transferencia por $80.000 de MARIA SOTO. '
        + 'Conoce más beneficios en nuestra app.'
  });
  assert.equal(r.type, 'income');
  assert.equal(r.amount, 80000);
  // El pie publicitario no debe robarse la descripción del movimiento.
  assert.equal(r.merchant, 'MARIA SOTO');
});

test('el pie del correo no se roba la descripción', () => {
  // "en nuestra app" está en otra frase: no es el comercio del cargo.
  const r = parseBankEmail({
    from: 'enviodigital@bancochile.cl',
    subject: 'Compra con Tarjeta',
    text: 'Se realizó una compra por $9.900 en STARBUCKS. Revisa tus movimientos en nuestra app.'
  });
  assert.equal(r.merchant, 'STARBUCKS');
});

test('un abono usa el remitente del dinero, no un lugar mencionado después', () => {
  const r = parseBankEmail({
    from: 'no-responder@bancoestado.cl',
    subject: 'Abono en tu cuenta',
    text: 'Abono por $45.000 de PEDRO GONZALEZ en tu cuenta corriente.'
  });
  assert.equal(r.type, 'income');
  assert.equal(r.merchant, 'PEDRO GONZALEZ');
});
