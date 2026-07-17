-- Add FK constraints with ON DELETE CASCADE for binding tables

-- AgentSkillBinding: add FKs to Agent and SkillPackage with cascade
ALTER TABLE "AgentSkillBinding" DROP CONSTRAINT IF EXISTS "AgentSkillBinding_agentId_fkey";
ALTER TABLE "AgentSkillBinding" ADD CONSTRAINT "AgentSkillBinding_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE;

ALTER TABLE "AgentSkillBinding" DROP CONSTRAINT IF EXISTS "AgentSkillBinding_skillPackageId_fkey";
ALTER TABLE "AgentSkillBinding" ADD CONSTRAINT "AgentSkillBinding_skillPackageId_fkey"
  FOREIGN KEY ("skillPackageId") REFERENCES "SkillPackage"("id") ON DELETE CASCADE;

-- AgentMcpBinding: add FKs to Agent and McpServer with cascade
ALTER TABLE "AgentMcpBinding" DROP CONSTRAINT IF EXISTS "AgentMcpBinding_agentId_fkey";
ALTER TABLE "AgentMcpBinding" ADD CONSTRAINT "AgentMcpBinding_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE;

ALTER TABLE "AgentMcpBinding" DROP CONSTRAINT IF EXISTS "AgentMcpBinding_mcpServerId_fkey";
ALTER TABLE "AgentMcpBinding" ADD CONSTRAINT "AgentMcpBinding_mcpServerId_fkey"
  FOREIGN KEY ("mcpServerId") REFERENCES "McpServer"("id") ON DELETE CASCADE;

-- UserSkillBinding: add FKs to User and SkillPackage with cascade
-- Note: User relation was missing entirely (userId existed but no relation defined)
ALTER TABLE "UserSkillBinding" DROP CONSTRAINT IF EXISTS "UserSkillBinding_userId_fkey";
ALTER TABLE "UserSkillBinding" ADD CONSTRAINT "UserSkillBinding_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE;

ALTER TABLE "UserSkillBinding" DROP CONSTRAINT IF EXISTS "UserSkillBinding_skillPackageId_fkey";
ALTER TABLE "UserSkillBinding" ADD CONSTRAINT "UserSkillBinding_skillPackageId_fkey"
  FOREIGN KEY ("skillPackageId") REFERENCES "SkillPackage"("id") ON DELETE CASCADE;
