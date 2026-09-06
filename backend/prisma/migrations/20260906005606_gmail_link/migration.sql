-- Conexión de solo lectura a Gmail por usuario
CREATE TABLE "GmailLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "watchedSenders" TEXT[],
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GmailLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GmailLink_userId_key" ON "GmailLink"("userId");

ALTER TABLE "GmailLink" ADD CONSTRAINT "GmailLink_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
