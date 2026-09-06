# FinFam — Visualización económica familiar 🇨🇱

App de finanzas personales/familiares. Cada movimiento —manual, del banco o detectado
en un correo— ajusta el saldo del mes **en tiempo real** y se refleja en los gráficos.

**En producción:** https://finfam-frontend.vercel.app · instalable como PWA

**Stack:** Angular 17 (PWA) · Node.js 20 (Express, ESM) · PostgreSQL (Prisma) ·
Socket.IO · Gmail API · Fintoc

## Arquitectura

```
                          Vercel                         Render
   ┌──────────────────────────────┐        ┌───────────────────────────┐
   │  frontend Angular (PWA)      │  REST  │   API Express             │
   │  service worker + manifest   ├───────►│                           │──► PostgreSQL
   │                              │◄───────┤                           │    (Supabase)
   └──────────────────────────────┘  WS    └───────────────────────────┘
        expense:created                       ▲          ▲          ▲
        income:created                        │          │          │
        pending:created                  Gmail API   Inbound     Webhooks
                                        (solo lectura) parse      Fintoc
```

**Flujo de un movimiento detectado en un correo:**

```
Llega el correo del banco a la bandeja de entrada
        ↓  (cron cada 10 min, GitHub Actions)
Se lee SOLO ese correo: filtro por remitente + in:inbox + posterior a la conexión
        ↓
El parser lo clasifica: gasto o ingreso, monto, comercio, categoría
        ↓
Queda en «Por confirmar» — el saldo NO se mueve
        ↓
El usuario aprueba o descarta
        ↓
Recién ahí se crea el Expense/Income y el socket actualiza el dashboard
```

Nada toca el saldo sin confirmación: un cobro no reconocido, un traspaso entre
cuentas propias o un correo mal interpretado no distorsionan el mes.

## Requisitos previos

- Node.js 20+
- PostgreSQL 14+ (local, o gratis en [Supabase](https://supabase.com) / [Neon](https://neon.tech))
- [Google Cloud Console](https://console.cloud.google.com): proyecto con **Gmail API**
  habilitada y credenciales OAuth de tipo *Aplicación web*
- Opcional: cuenta en [Fintoc](https://fintoc.com) (sandbox gratuito con bancos chilenos)

## Puesta en marcha

### Backend

```bash
cd backend
cp .env.example .env      # completa las variables (ver tabla abajo)
npm install
npx prisma migrate deploy # aplica las migraciones existentes
npm run dev               # http://localhost:3000
npm test                  # 43 tests con node:test
```

### Frontend

```bash
cd frontend
npm install --legacy-peer-deps   # ver "Nota sobre dependencias"
npm start                        # http://localhost:4200
```

Queda un valor por reemplazar a mano: la llave pública de Fintoc
(`pk_test_TU_LLAVE_PUBLICA`) en `src/app/pages/dashboard.component.ts`.
El resto de la configuración del frontend vive en `src/environments/`.

### Variables de entorno

| Variable | Para qué |
|---|---|
| `DATABASE_URL` | Cadena de conexión a PostgreSQL |
| `JWT_SECRET` · `JWT_EXPIRES` | Firma de sesiones |
| `GOOGLE_CLIENT_ID` · `GOOGLE_CLIENT_SECRET` | Login con Google y lectura de Gmail |
| `GOOGLE_REDIRECT_URI` | Debe coincidir exacto con el URI autorizado en Google Cloud |
| `TOKEN_ENCRYPTION_KEY` | 32 bytes hex; cifra el refresh token de Gmail en reposo |
| `EMAIL_INGEST_SECRET` | Protege el webhook de correos y el cron `/sync-all` |
| `INGEST_EMAIL_BASE` | Dirección del inbound parse, si se usa la vía de reenvío |
| `FINTOC_SECRET_KEY` · `FINTOC_WEBHOOK_SECRET` | Integración con Fintoc |
| `FRONTEND_URL` | Origen permitido en CORS y en Socket.IO |

### Nota sobre dependencias

`ng2-charts@6` declara un peer abierto sobre `@angular/cdk`, que npm resuelve a la
última versión y choca con Angular 17. Por eso **el frontend necesita
`--legacy-peer-deps`** en cada instalación. Fijar `@angular/cdk` en la 17
resolvería el problema de raíz.

## Capturar movimientos desde el correo

Dos caminos, ambos terminan en la misma bandeja de confirmación:

**1. Leer Gmail directamente** (`/api/gmail`) — el usuario autoriza acceso de solo
lectura. La consulta enviada a Gmail es
`in:inbox (from:bancochile.cl OR from:santander.cl OR …) after:<conexión>`, así que
solo se descargan correos de bancos: nunca el resto de la bandeja, ni archivados,
spam o papelera.

> Con la app en modo *Testing* de Google, el permiso caduca a los 7 días y hay que
> reconectar. Publicarla con el scope `gmail.readonly` exige verificación y una
> auditoría de seguridad CASA.

**2. Reenvío** (`POST /api/bank/email-ingest`) — para quien no quiera dar acceso a su
Gmail. Cada usuario recibe una dirección única (`base+<token>@…`), crea un filtro en
Gmail que reenvía solo los correos de su banco, y un servicio de inbound parse
(Postmark, CloudMailin) hace POST al webhook.

### El parser

`backend/src/services/email-parser.service.js` es multi-banco y trabaja sobre texto
en español, sin depender de plantillas por banco:

- Distingue **salidas** (compra, cargo, giro, transferencia enviada) de **entradas**
  (abono, devolución, transferencia recibida).
- Descarta lo que no movió plata: rechazos, reversos, anulaciones, estados de cuenta.
- **Descarta la publicidad del banco**, que es el falso positivo más caro: las
  campañas hablan de "compras" y traen montos. La regla es descartar si hay lenguaje
  promocional *y* ninguna marca concreta de transacción (tarjeta terminada en, código
  de autorización, saldo disponible), para que un aviso real que menciona puntos o
  beneficios no se pierda.
- Entiende el formato chileno de miles (`$12.345` = 12345, `$12.345,50` = 12345.5) y
  elige el monto del cargo, no el saldo disponible que muchos bancos incluyen.

Está cubierto por tests con correos representativos de Banco de Chile, Santander,
BCI, BancoEstado, Itaú y Tenpo.

## Endpoints

| Ruta | Qué hace |
|---|---|
| `/api/auth` | Registro, login nativo y con Google (bcrypt + JWT) |
| `/api/onboarding` | Wizard de 4 pasos: hogar → ingresos → gastos fijos → resumen |
| `/api/dashboard/summary` | Resumen del mes: totales, curva acumulada, dona por categoría y últimos movimientos |
| `/api/expenses` | Alta, edición, borrado y listado de gastos |
| `/api/fixed-expenses` | Gastos fijos: alta, edición y borrado |
| `/api/pending` | Bandeja de confirmación: listar, aprobar, descartar |
| `/api/gmail` | Conectar/desconectar Gmail, estado, sincronizar (`/sync-all` para el cron) |
| `/api/bank` | Vínculos Fintoc, webhook de movimientos y webhook de correos |
| `/api/cards` | Tarjetas: solo banco, marca, últimos 4, cupo y día de facturación |

## Seguridad

- **PCI-DSS**: nunca se guarda el número completo de tarjeta ni el CVV.
- Las credenciales bancarias no pasan por la app: solo por el widget de Fintoc.
- El refresh token de Gmail se guarda **cifrado con AES-256-GCM**, nunca en texto plano.
- El webhook de Fintoc verifica la firma HMAC sobre el body crudo.
- Todas las rutas privadas exigen JWT, y las consultas filtran por usuario: pedir un
  recurso ajeno devuelve 404, sin revelar si existe.

## Nota sobre bancos en Chile

Los bancos chilenos **no ofrecen APIs públicas** a desarrolladores particulares. Las
opciones reales son:

1. **Parseo de los correos de notificación** (lo que usa este proyecto por defecto):
   no requiere convenio con nadie y funciona con cualquier banco que mande avisos.
2. **Fintoc**: agregador regulado, soporta Banco de Chile y los principales bancos.
   Sandbox gratis. Integrado como alternativa.
3. **Floid**: agregador similar.

La Ley Fintech (21.521) y el Sistema de Finanzas Abiertas del CMF están estandarizando
las APIs bancarias, pero el acceso es para instituciones inscritas.

## Próximos pasos sugeridos

- Editar y borrar ingresos (hoy solo se pueden corregir los gastos)
- Cifrar `BankLink.linkToken` en reposo, como ya se hace con el token de Gmail
- Presupuestos por categoría con alertas ("llevas 80% de tu presupuesto de ocio")
- Multiusuario por hogar (invitar a tu pareja al mismo presupuesto)
- Historial de meses anteriores y comparación mes a mes
- Notificaciones push cuando llega un cargo grande
