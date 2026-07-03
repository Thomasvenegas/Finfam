# FinFam — Visualización económica familiar 🇨🇱

App de finanzas personales/familiares. Cada gasto (manual, del banco o por correo) descuenta el saldo del mes **en tiempo real** y se refleja en los gráficos.

**Stack:** Angular 17 · Node.js (Express) · PostgreSQL (Prisma) · Socket.IO · Fintoc (open banking Chile)

## Arquitectura

```
frontend (Angular :4200)
   │  REST + JWT            ┌──────────────┐
   ├───────────────────────►│  API Express │──► PostgreSQL (Prisma)
   │  WebSocket (Socket.IO) │   (:3000)    │
   ◄────────────────────────┤              │◄── Webhooks Fintoc (movimientos Banco de Chile, etc.)
      expense:created       └──────────────┘◄── Inbound email (correos "compra con tarjeta")
```

Flujo en tiempo real: llega un movimiento del banco (webhook) o se registra un gasto → se crea el `Expense` → el servidor emite `expense:created` a la sala del usuario → el dashboard recarga el resumen → **el saldo disponible baja al instante**.

## Requisitos previos

- Node.js 20+
- PostgreSQL 14+ (crea una base `finfam`)
- Cuenta en [Google Cloud Console](https://console.cloud.google.com) → OAuth Client ID (tipo Web, origen `http://localhost:4200`)
- Cuenta en [Fintoc](https://fintoc.com) (tienen sandbox gratuito con bancos chilenos simulados)

## Backend

```bash
cd backend
cp .env.example .env      # completa DATABASE_URL, JWT_SECRET, GOOGLE_CLIENT_ID, llaves Fintoc
npm install
npx prisma migrate dev --name init
npm run dev               # http://localhost:3000
```

## Frontend

```bash
cd frontend
npm install
npm start                 # http://localhost:4200
```

Antes de partir, reemplaza:
- `GOOGLE_CLIENT_ID` en `src/app/pages/login.component.ts`
- `pk_test_TU_LLAVE_PUBLICA` (Fintoc) en `src/app/pages/dashboard.component.ts`

## Cómo funciona cada requisito

| Requisito | Implementación |
|---|---|
| Login nativo | `POST /api/auth/register` y `/login` con bcrypt + JWT |
| Login con Google | Google Identity Services en el frontend; el backend verifica el ID token con `google-auth-library` |
| Onboarding guiado | Wizard de 4 pasos: hogar/hijos → sueldo y otros ingresos (dividendos, arriendos) → gastos fijos → resumen. `POST /api/onboarding` |
| Saldo que baja en tiempo real | Socket.IO: evento `expense:created` por usuario |
| Gráficos del mes | `GET /api/dashboard/summary`: curva de gasto acumulado vs línea de ingreso (detecta si gastaste más de lo que ganas) + dona por categoría |
| Tarjeta de crédito | Solo banco, marca, últimos 4 dígitos, cupo y día de facturación (**PCI-DSS: nunca el número completo ni CVV**) |
| Banco de Chile y otros | Widget + API de **Fintoc** (`cl_banco_de_chile`, Santander, BCI, Estado, Itaú, Scotiabank, Falabella). Webhook `POST /api/bank/webhook` crea gastos automáticamente, con categorización por comercio |
| Gastos por correo | `POST /api/bank/email-ingest`: reenvía los correos de notificación del banco a un inbound parse (Mailgun/SendGrid) que llama este endpoint |

## Nota importante sobre bancos en Chile

Los bancos chilenos **no ofrecen APIs públicas** a desarrolladores particulares. Las opciones reales son:

1. **Fintoc** (recomendada, la que usa este proyecto): agregador regulado, soporta Banco de Chile y los principales bancos. Sandbox gratis.
2. **Floid**: alternativa similar.
3. **Parseo de correos** de notificación de compra (incluido como respaldo).

La Ley Fintech (21.521) y el Sistema de Finanzas Abiertas del CMF están estandarizando APIs bancarias en Chile, pero el acceso es para instituciones inscritas — para un proyecto personal/startup, el agregador es el camino.

## Próximos pasos sugeridos

- Presupuestos por categoría con alertas ("llevas 80% de tu presupuesto de ocio")
- Multiusuario por hogar (invitar a tu pareja al mismo presupuesto)
- Cifrado de `linkToken` en reposo (ej. `pgcrypto` o KMS) antes de producción
- Historial de meses anteriores y comparación mes a mes
- Notificaciones push cuando llega un cargo grande
