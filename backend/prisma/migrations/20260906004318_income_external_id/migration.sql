-- Permite deduplicar ingresos creados desde correos si el webhook se reintenta
ALTER TABLE "Income" ADD COLUMN "externalId" TEXT;

CREATE UNIQUE INDEX "Income_externalId_key" ON "Income"("externalId");
