import { Router } from 'express';
import crypto from 'crypto';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { emitExpenseCreated } from '../server.js';
import { listAccounts, listMovements, categorize } from '../services/fintoc.service.js';
import { normalizeInbound } from '../services/email-parser.service.js';
import { recordEmailMovement } from '../services/movement.service.js';

const router = Router();

// ---- Vincular banco: el frontend ya pasó por el widget de Fintoc
router.post('/link', requireAuth, async (req, res, next) => {
  try {
    const { linkToken, institution } = req.body; // ej: cl_banco_de_chile
    const accounts = await listAccounts(linkToken);
    const main = accounts[0];
    const link = await prisma.bankLink.create({
      data: {
        userId: req.userId,
        institution,
        linkToken,
        accountId: main?.id
      }
    });
    res.status(201).json({ id: link.id, institution: link.institution });
  } catch (e) { next(e); }
});

router.get('/links', requireAuth, async (req, res, next) => {
  try {
    const links = await prisma.bankLink.findMany({
      where: { userId: req.userId },
      select: { id: true, institution: true, lastSyncAt: true, createdAt: true }
    });
    res.json(links);
  } catch (e) { next(e); }
});

// ---- Sincronización manual (además de los webhooks)
router.post('/sync/:linkId', requireAuth, async (req, res, next) => {
  try {
    const link = await prisma.bankLink.findFirst({
      where: { id: req.params.linkId, userId: req.userId }
    });
    if (!link) return res.status(404).json({ error: 'Vínculo no encontrado' });

    const movements = await listMovements(
      link.linkToken,
      link.accountId,
      link.lastSyncAt?.toISOString()
    );

    let created = 0;
    for (const m of movements) {
      if (m.amount >= 0) continue; // solo cargos
      const expense = await prisma.expense.upsert({
        where: { externalId: m.id },
        update: {},
        create: {
          userId: link.userId,
          description: m.description || 'Movimiento bancario',
          amount: Math.abs(m.amount),
          category: categorize(m.description),
          source: 'fintoc',
          externalId: m.id,
          date: new Date(m.post_date || m.transaction_date)
        }
      });
      emitExpenseCreated(link.userId, expense);
      created++;
    }
    await prisma.bankLink.update({ where: { id: link.id }, data: { lastSyncAt: new Date() } });
    res.json({ synced: created });
  } catch (e) { next(e); }
});

// ---- Webhook de Fintoc: movimiento nuevo => gasto nuevo => socket => saldo baja
router.post('/webhook', async (req, res) => {
  try {
    // Verificación de firma (ver docs.fintoc.com/docs/webhooks)
    const signature = req.headers['fintoc-signature'];
    const expected = crypto
      .createHmac('sha256', process.env.FINTOC_WEBHOOK_SECRET)
      .update(req.body) // raw body
      .digest('hex');
    if (!signature?.includes(expected)) return res.status(401).end();

    const event = JSON.parse(req.body.toString());
    if (event.type === 'movement.created' && event.data.amount < 0) {
      const link = await prisma.bankLink.findFirst({
        where: { accountId: event.data.account_id }
      });
      if (link) {
        const expense = await prisma.expense.upsert({
          where: { externalId: event.data.id },
          update: {},
          create: {
            userId: link.userId,
            description: event.data.description || 'Cargo bancario',
            amount: Math.abs(event.data.amount),
            category: categorize(event.data.description),
            source: 'fintoc',
            externalId: event.data.id,
            date: new Date(event.data.post_date || Date.now())
          }
        });
        emitExpenseCreated(link.userId, expense);
      }
    }
    res.status(200).end();
  } catch (e) {
    console.error('webhook error', e);
    res.status(200).end(); // responder 200 para que Fintoc no reintente en loop
  }
});

// ---- Ingesta de correos de notificación bancaria
//
// Flujo: el usuario crea un filtro en Gmail que reenvía los correos de su banco
// a la dirección única que le entrega /ingest-address. Un servicio de inbound
// parse (Postmark, CloudMailin, SendGrid...) recibe ese correo y hace POST aquí.
// Así la app solo ve los correos del banco, nunca la bandeja completa.

/** Inserta el token del usuario en la dirección base: base+token@dominio */
function buildIngestAddress(token) {
  const base = process.env.INGEST_EMAIL_BASE;
  if (!base || !base.includes('@')) return null;
  const [local, domain] = base.split('@');
  return `${local}+${token}@${domain}`;
}

// Dirección personal de reenvío. Se genera el token la primera vez que se pide.
router.get('/ingest-address', requireAuth, async (req, res, next) => {
  try {
    let user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { ingestToken: true }
    });

    if (!user?.ingestToken) {
      user = await prisma.user.update({
        where: { id: req.userId },
        data: { ingestToken: crypto.randomBytes(8).toString('hex') },
        select: { ingestToken: true }
      });
    }

    const address = buildIngestAddress(user.ingestToken);
    res.json({ address, token: user.ingestToken, configured: Boolean(address) });
  } catch (e) { next(e); }
});

router.post('/email-ingest', async (req, res) => {
  try {
    const secret = process.env.EMAIL_INGEST_SECRET;
    const provided = req.headers['x-ingest-key'] || req.query.key;
    if (!secret || provided !== secret) return res.status(401).end();

    const mail = normalizeInbound(req.body);

    // El token va en la parte "+token" de la direccion a la que se reenvio.
    const token = mail.recipients.match(/\+([a-z0-9]{8,64})@/i)?.[1];
    if (!token) return res.json({ ok: true, reason: 'sin token de usuario' });

    const user = await prisma.user.findUnique({ where: { ingestToken: token } });
    if (!user) return res.json({ ok: true, reason: 'usuario no encontrado' });

    const externalId = mail.messageId ? `email:${mail.messageId}` : undefined;
    const result = await recordEmailMovement(user.id, mail, externalId);
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error('email-ingest error', e.message);
    // Se responde 200 para que el proveedor no reintente en bucle.
    res.status(200).json({ ok: false });
  }
});

export default router;
