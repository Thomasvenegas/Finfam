-- Movimientos detectados en correos, a la espera de confirmación del usuario
CREATE TABLE "PendingMovement" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'otros',
    "bank" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "date" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingMovement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PendingMovement_externalId_key" ON "PendingMovement"("externalId");
CREATE INDEX "PendingMovement_userId_status_idx" ON "PendingMovement"("userId", "status");

ALTER TABLE "PendingMovement" ADD CONSTRAINT "PendingMovement_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Punto de partida: solo se leen correos posteriores a la conexión
ALTER TABLE "GmailLink" ADD COLUMN "syncFrom" TIMESTAMP(3);
