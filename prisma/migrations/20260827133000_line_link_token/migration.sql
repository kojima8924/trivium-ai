-- CreateTable
CREATE TABLE "LineLinkToken" (
    "token" TEXT NOT NULL,
    "lineUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "LineLinkToken_pkey" PRIMARY KEY ("token")
);

-- CreateIndex
CREATE INDEX "LineLinkToken_lineUserId_idx" ON "LineLinkToken"("lineUserId");

-- CreateIndex
CREATE INDEX "LineLinkToken_expiresAt_idx" ON "LineLinkToken"("expiresAt");

