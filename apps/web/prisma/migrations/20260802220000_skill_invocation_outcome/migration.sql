-- P3 (skill-runtime-completeness): SkillInvocation 调用结果反馈闭环
-- 新增 triggerKind/outcome/errorMessage/durationMs/tokenIn/tokenOut + outcome 索引
ALTER TABLE "SkillInvocation"
  ADD COLUMN "triggerKind"  TEXT NOT NULL DEFAULT 'explicit',
  ADD COLUMN "outcome"      TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN "errorMessage" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "durationMs"   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "tokenIn"      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "tokenOut"     INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "SkillInvocation_outcome_idx" ON "SkillInvocation"("outcome");
