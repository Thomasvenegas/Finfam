import { Router } from 'express';
import crypto from 'crypto';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { emitExpenseCreated } from '../server.js';
import { listAccounts, listMovements, categorize } from '../services/fintoc.service.js';

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

// ---- Alternativa: ingesta de correos de notificación del banco
// (ej: reenvío automático de los correos de "Compra con tarjeta" de Banco de Chile
// a un servicio tipo Mailgun/SendGrid Inbound Parse que hace POST aquí)
router.post('/email-ingest', async (req, res) => {
  try {
    if (req.headers['x-ingest-key'] !== process.env.JWT_SECRET) return res.status(401).end();
    const { userEmail, subject, text } = req.body;

    // Patrón típico Banco de Chile: "compra por $12.345 en COMERCIO"
    const match = text?.match(/\$\s?([\d.]+)\s+en\s+(.+?)(\.|\n|$)/i);
    if (!match) return res.json({ parsed: false });

    const amount = Number(match[1].replace(/\./g, ''));
    const merchant = match[2].trim();
    const user = await prisma.user.findUnique({ where: { email: userEmail } });
    if (!user) return res.status(404).end();

    const expense = await prisma.expense.create({
      data: {
        userId: user.id,
        description: merchant,
        amount,
        category: categorize(merchant),
        source: 'email'
      }
    });
    emitExpenseCreated(user.id, expense);
    res.json({ parsed: true, subject });
  } catch (e) {
    console.error(e);
    res.status(500).end();
  }
});

export default router;
