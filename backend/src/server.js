import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { ZodError } from 'zod';

import authRoutes from './routes/auth.routes.js';
import onboardingRoutes from './routes/onboarding.routes.js';
import expenseRoutes from './routes/expenses.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import cardRoutes from './routes/cards.routes.js';
import bankRoutes from './routes/bank.routes.js';
import gmailRoutes from './routes/gmail.routes.js';
import pendingRoutes from './routes/pending.routes.js';
import fixedExpenseRoutes from './routes/fixed-expenses.routes.js';
import incomeRoutes from './routes/incomes.routes.js';
import movementRoutes from './routes/movements.routes.js';

const app = express();
const server = http.createServer(app);

// ---- WebSocket: cada usuario se une a su propia sala, así el dashboard
// se actualiza en tiempo real cuando entra un gasto (manual o del banco).
export const io = new Server(server, {
  cors: { origin: process.env.FRONTEND_URL }
});

io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    socket.join(`user:${payload.sub}`);
    next();
  } catch {
    next(new Error('unauthorized'));
  }
});

/** Notifica al frontend que hubo un gasto nuevo y debe refrescar saldos. */
export function emitExpenseCreated(userId, expense) {
  io.to(`user:${userId}`).emit('expense:created', expense);
}

/** Ídem para un ingreso detectado (ej. un abono avisado por correo). */
export function emitIncomeCreated(userId, income) {
  io.to(`user:${userId}`).emit('income:created', income);
}

/** Un movimiento detectado en un correo que espera confirmación del usuario. */
export function emitPendingCreated(userId, pending) {
  io.to(`user:${userId}`).emit('pending:created', pending);
}

app.use(cors({ origin: process.env.FRONTEND_URL }));
// El webhook de Fintoc necesita el body crudo para verificar la firma
app.use('/api/bank/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/onboarding', onboardingRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/cards', cardRoutes);
app.use('/api/bank', bankRoutes);
app.use('/api/gmail', gmailRoutes);
app.use('/api/pending', pendingRoutes);
app.use('/api/fixed-expenses', fixedExpenseRoutes);
app.use('/api/incomes', incomeRoutes);
app.use('/api/movements', movementRoutes);

app.use((err, _req, res, _next) => {
  // Un dato mal formado es culpa de la petición, no del servidor: sin esto
  // toda validación de Zod se reportaba como 500 y el cliente no podía
  // distinguir "te equivocaste" de "me caí".
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Datos inválidos',
      detalles: err.errors.map(e => ({ campo: e.path.join('.'), mensaje: e.message }))
    });
  }
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Error interno' });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`API escuchando en http://localhost:${PORT}`));
