-- AlterTable
ALTER TABLE "GeneratedTask" ADD COLUMN     "axisCode" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "axisRead" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "axisWrite" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "LearningEvent" ADD COLUMN     "axisCode" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "axisRead" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "axisWrite" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "generated" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "AgentMemory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatTurn" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatTurn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentMemory_userId_agent_key" ON "AgentMemory"("userId", "agent");

-- CreateIndex
CREATE INDEX "ChatTurn_userId_agent_createdAt_idx" ON "ChatTurn"("userId", "agent", "createdAt");

-- AddForeignKey
ALTER TABLE "AgentMemory" ADD CONSTRAINT "AgentMemory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatTurn" ADD CONSTRAINT "ChatTurn_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

