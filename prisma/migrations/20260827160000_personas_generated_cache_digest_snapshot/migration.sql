-- CreateTable
CREATE TABLE "AgentPersona" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tone" TEXT NOT NULL DEFAULT 'polite',
    "firstPerson" TEXT NOT NULL DEFAULT '私',
    "extra" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentPersona_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneratedTask" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "domain" "Domain" NOT NULL,
    "difficulty" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "passage" TEXT NOT NULL DEFAULT '',
    "prompt" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "choices" JSONB,
    "answerKey" JSONB,
    "rubric" JSONB,
    "hints" JSONB NOT NULL,
    "explanation" TEXT NOT NULL,
    "skillTags" TEXT[],
    "request" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeneratedTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskFeedbackCache" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "hintLevel" INTEGER NOT NULL,
    "personaKey" TEXT NOT NULL DEFAULT 'default',
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskFeedbackCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyDigest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "summary" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "DailyDigest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfileSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "read" INTEGER NOT NULL,
    "write" INTEGER NOT NULL,
    "code" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfileSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentPersona_userId_agent_key" ON "AgentPersona"("userId", "agent");

-- CreateIndex
CREATE INDEX "GeneratedTask_userId_createdAt_idx" ON "GeneratedTask"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TaskFeedbackCache_taskId_answer_hintLevel_personaKey_key" ON "TaskFeedbackCache"("taskId", "answer", "hintLevel", "personaKey");

-- CreateIndex
CREATE UNIQUE INDEX "DailyDigest_userId_day_key" ON "DailyDigest"("userId", "day");

-- CreateIndex
CREATE INDEX "ProfileSnapshot_userId_createdAt_idx" ON "ProfileSnapshot"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "AgentPersona" ADD CONSTRAINT "AgentPersona_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedTask" ADD CONSTRAINT "GeneratedTask_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyDigest" ADD CONSTRAINT "DailyDigest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileSnapshot" ADD CONSTRAINT "ProfileSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

