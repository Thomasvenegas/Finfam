# AGENTS.md — Guía para agentes de código (Codex)

## Qué es este proyecto
FinFam: app de finanzas personales/familiares para Chile. Cada gasto (manual, webhook bancario vía Fintoc, o correo parseado) descuenta el saldo mensual en tiempo real vía Socket.IO.

## Estructura
- `backend/` — Node.js 20+ (ESM), Express, Prisma + PostgreSQL, Socket.IO, JWT.
  - `src/server.js` — entrada; exporta `io` y `emitExpenseCreated(userId, expense)`.
  - `src/routes/` — auth (nativo + Google), onboarding, expenses, dashboard, cards, bank.
  - `src/services/fintoc.service.js` — agregador open banking (Banco de Chile y otros).
  - `prisma/schema.prisma` — modelos: User, Profile, Income, FixedExpense, Expense, CreditCard, BankLink.
- `frontend/` — Angular 17 standalone components, ng2-charts (Chart.js), socket.io-client.
  - `src/app/core/` — auth.service, interceptor, guards, socket.service.
  - `src/app/pages/` — login, onboarding (wizard 4 pasos), dashboard, cards.

## Cómo correr
```bash
# Backend
cd backend && cp .env.example .env && npm install
npx prisma migrate dev --name init
npm run dev            # :3000

# Frontend
cd frontend && npm install && npm start   # :4200
```
Requiere PostgreSQL local con base `finfam`. Variables en `backend/.env.example`.

## Convenciones
- Backend en ES Modules (`"type": "module"`), sin TypeScript. Validación de entrada con Zod en cada ruta.
- Todas las rutas privadas usan `requireAuth` (JWT en header `Authorization: Bearer`).
- Cada creación de `Expense`, venga de donde venga, DEBE llamar `emitExpenseCreated()` para que el dashboard se actualice en vivo.
- Montos en CLP, `Decimal(12,2)` en Prisma; convertir con `Number()` al agregar.
- Frontend: componentes standalone con template inline, señales (`signal`) para estado de auth, estilos con las variables CSS de `src/styles.css` (no agregar frameworks CSS).
- Textos de UI en español de Chile.

## Reglas de seguridad (no negociables)
- NUNCA almacenar número completo de tarjeta ni CVV (PCI-DSS): solo banco, marca, `last4`, cupo, día de facturación.
- Las credenciales bancarias nunca pasan por esta app: solo por el widget de Fintoc.
- El webhook `/api/bank/webhook` usa body crudo para verificar firma HMAC — no mover `express.raw()` después de `express.json()`.
- No loguear tokens, contraseñas ni `linkToken`.

## Pruebas / verificación
Aún no hay suite de tests. Al agregar features:
- Verifica que `npx prisma validate` pase si tocas el schema.
- Levanta ambos servidores y prueba el flujo: registro → onboarding → crear gasto → verificar que el saldo baja sin recargar.
- Si agregas tests, usa `node:test` en backend y Karma/Jasmine (default Angular) en frontend.

## Pendientes conocidos (buenos primeros encargos)
- Cifrar `BankLink.linkToken` en reposo.
- Presupuestos por categoría con alertas.
- Multiusuario por hogar (presupuesto compartido).
- Historial de meses anteriores y comparación mes a mes.
