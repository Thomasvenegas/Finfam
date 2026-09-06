import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { encrypt, decrypt } from '../lib/crypto.js';
import { recordEmailMovement } from '../services/movement.service.js';
import { DEFAULT_BANK_SENDERS } from '../services/email-parser.service.js';
import {
  getAuthUrl, exchangeCode, fetchBankEmails, isGmailConfigured
} from '../services/gmail.service.js';

const router = Router();

/** Estado de la conexión del usuario. */
router.get('/status', requireAuth, async (req, res, next) => {
  try {
    const link = await prisma.gmailLink.findUnique({
      where: { userId: req.userId },
      select: { email: true, lastSyncAt: true, watchedSenders: true, createdAt: true }
    });
    res.json({
      configured: isGmailConfigured(),
      connected: Boolean(link),
      ...(link || {}),
      // Google caduca el permiso a los 7 días mientras la app esté en modo Testing.
      expiresAt: link ? new Date(link.createdAt.getTime() + 7 * 864e5) : null
    });
  } catch (e) { next(e); }
});

/** Devuelve la URL de consentimiento de Google. */
router.get('/auth-url', requireAuth, (req, res, next) => {
  try {
    if (!isGmailConfigured()) {
      return res.status(503).json({ error: 'Gmail no está configurado en el servidor' });
    }
    // El state lleva firmado quién inició la conexión: el callback de Google no
    // trae la sesión del usuario.
    const state = jwt.sign({ sub: req.userId }, process.env.JWT_SECRET, { expiresIn: '10m' });
    res.json({ url: getAuthUrl(state) });
  } catch (e) { next(e); }
});

/** Vuelta de Google: guarda el refresh token cifrado y manda al dashboard. */
router.get('/callback', async (req, res) => {
  const front = process.env.FRONTEND_URL || '';
  try {
    const { code, state } = req.query;
    if (!code || !state) return res.redirect(`${front}/dashboard?gmail=error`);

    const { sub: userId } = jwt.verify(state, process.env.JWT_SECRET);
    const { refreshToken, email } = await exchangeCode(code);

    await prisma.gmailLink.upsert({
      where: { userId },
      create: {
        userId,
        email,
        refreshToken: encrypt(refreshToken),
        watchedSenders: DEFAULT_BANK_SENDERS
      },
      update: { email, refreshToken: encrypt(refreshToken), createdAt: new Date() }
    });

    res.redirect(`${front}/dashboard?gmail=ok`);
  } catch (e) {
    console.error('gmail callback error', e.message);
    res.redirect(`${front}/dashboard?gmail=error`);
  }
});

/** Lee los correos bancarios recientes y crea los movimientos que falten. */
async function syncUser(link) {
  const mails = await fetchBankEmails(decrypt(link.refreshToken), {
    senders: link.watchedSenders,
    // Tras la primera vez basta mirar los últimos días; la deduplicación
    // por id de mensaje evita repetir lo ya registrado.
    days: link.lastSyncAt ? 3 : 30
  });

  let created = 0;
  for (const mail of mails) {
    const result = await recordEmailMovement(link.userId, mail, `gmail:${mail.id}`);
    if (result.created) created++;
  }

  await prisma.gmailLink.update({
    where: { id: link.id },
    data: { lastSyncAt: new Date() }
  });
  return { revisados: mails.length, creados: created };
}

router.post('/sync', requireAuth, async (req, res, next) => {
  try {
    const link = await prisma.gmailLink.findUnique({ where: { userId: req.userId } });
    if (!link) return res.status(404).json({ error: 'Gmail no conectado' });
    res.json(await syncUser(link));
  } catch (e) {
    // Si Google revocó el permiso (pasa a los 7 días en modo Testing),
    // se avisa para que el usuario reconecte en vez de dar un 500 opaco.
    if (/invalid_grant|unauthorized/i.test(e.message)) {
      await prisma.gmailLink.delete({ where: { userId: req.userId } }).catch(() => {});
      return res.status(401).json({ error: 'Se venció el permiso de Gmail. Conéctalo de nuevo.' });
    }
    next(e);
  }
});

/** Sincroniza a todos: pensado para un cron externo. */
router.post('/sync-all', async (req, res) => {
  const secret = process.env.EMAIL_INGEST_SECRET;
  const provided = req.headers['x-ingest-key'] || req.query.key;
  if (!secret || provided !== secret) return res.status(401).end();

  const links = await prisma.gmailLink.findMany();
  const resumen = [];
  for (const link of links) {
    try {
      resumen.push({ userId: link.userId, ...(await syncUser(link)) });
    } catch (e) {
      resumen.push({ userId: link.userId, error: e.message.slice(0, 120) });
    }
  }
  res.json({ cuentas: links.length, resumen });
});

router.delete('/disconnect', requireAuth, async (req, res, next) => {
  try {
    await prisma.gmailLink.deleteMany({ where: { userId: req.userId } });
    res.json({ disconnected: true });
  } catch (e) { next(e); }
});

export default router;
