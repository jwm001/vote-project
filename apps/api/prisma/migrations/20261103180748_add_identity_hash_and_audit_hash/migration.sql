-- AlterTable
ALTER TABLE "User" ADD COLUMN "idNumberHash" TEXT;

-- AlterTable
ALTER TABLE "Vote" ADD COLUMN "auditHash" TEXT;

-- AlterTable
ALTER TABLE "Vote" ADD COLUMN "auditRecordedAt" DATETIME;

-- CreateIndex
CREATE UNIQUE INDEX "User_idNumberHash_key" ON "User"("idNumberHash");
