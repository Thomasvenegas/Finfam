import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { OAuth2Client } from 'google-auth-library';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { signToken, requireAuth } from '../middleware/auth.js';

const router = Router();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, onboarded: u.onboarded });

// ---- Registro nativo
router.post('/register', async (req, res, next) => {
  try {
    const body = z.object({
      name: z.string().min(2),
      email: z.string().email(),
      password: z.string().min(8)
    }).parse(req.body);

    const exists = await prisma.user.findUnique({ where: { email: body.email } });
    if (exists) return res.status(409).json({ error: 'El correo ya está registrado' });

    const user = await prisma.user.create({
      data: {
        name: body.name,
        email: body.email,
        passwordHash: await bcrypt.hash(body.password, 12)
      }
    });
    res.status(201).json({ token: signToken(user.id), user: publicUser(user) });
  } catch (e) { next(e); }
});

// ---- Login nativo
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user?.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    res.json({ token: signToken(user.id), user: publicUser(user) });
  } catch (e) { next(e); }
});

// ---- Login con Google: el frontend envía el ID token de Google Identity Services
router.post('/google', async (req, res, next) => {
  try {
    const { credential } = req.body;
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID
    });
    const payload = ticket.getPayload();

    let user = await prisma.user.findFirst({
      where: { OR: [{ googleId: payload.sub }, { email: payload.email }] }
    });
    if (!user) {
      user = await prisma.user.create({
        data: { email: payload.email, name: payload.name, googleId: payload.sub }
      });
    } else if (!user.googleId) {
      user = await prisma.user.update({ where: { id: user.id }, data: { googleId: payload.sub } });
    }
    res.json({ token: signToken(user.id), user: publicUser(user) });
  } catch (e) { next(e); }
});

router.get('/me', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  res.json(publicUser(user));
});

// Renueva el token mientras el usuario está activo. Los tokens son de vida
// corta: si nadie los renueva porque la sesión quedó inactiva, vencen solos en
// el servidor, y un token copiado deja de servir.
router.post('/refresh', requireAuth, (req, res) => {
  res.json({ token: signToken(req.userId) });
});

export default router;
