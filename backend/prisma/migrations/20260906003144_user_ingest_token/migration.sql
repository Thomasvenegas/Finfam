-- Token para identificar al usuario en la dirección de reenvío de correos bancarios
ALTER TABLE "User" ADD COLUMN "ingestToken" TEXT;

CREATE UNIQUE INDEX "User_ingestToken_key" ON "User"("ingestToken");
