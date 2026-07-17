// lib/scope-resolve.ts
import { prisma } from "./prisma";

export interface ResolveInput {
  agentId: string;
  userId: string;
  teamId: string | null;
  scope?: "team" | "personal";
}

export interface ResolvedSkills {
  skills: string[];
  layersApplied: string[];
}

/**
 * Resolve the effective skill set for an agent by converging four layers:
 * global → team → user → agent. Each binding has a mode of
 * "inherit" | "include" | "exclude". Excludes from any layer remove a slug
 * from the effective set; includes/inherits add it.
 *
 * Personal scope (`scope === "personal"`) skips the team layer entirely,
 * even if `teamId` is provided.
 */
export async function resolveAgentSkills(input: ResolveInput): Promise<ResolvedSkills> {
  const layersApplied: string[] = [];
  const effective = new Map<string, string>();

  // global layer
  const globalSkills = await prisma.skillPackage.findMany({
    where: { scope: "global", enabled: true },
  });
  for (const s of globalSkills) effective.set(s.slug, "inherit");
  layersApplied.push("global");

  // team layer (skip when personal scope)
  if (input.scope !== "personal" && input.teamId) {
    const teamSkills = await prisma.skillPackage.findMany({
      where: { scope: "team", teamId: input.teamId, enabled: true },
    });
    for (const s of teamSkills) effective.set(s.slug, "inherit");
    layersApplied.push("team");
  }

  // user layer bindings
  const userBindings = await prisma.userSkillBinding.findMany({
    where: { userId: input.userId },
  });
  for (const b of userBindings) {
    const pkg = await prisma.skillPackage.findUnique({ where: { id: b.skillPackageId } });
    if (!pkg) continue;
    if (b.mode === "exclude") effective.delete(pkg.slug);
    else effective.set(pkg.slug, b.mode);
  }
  layersApplied.push("user");

  // agent layer (last-write-wins convergence)
  const agentBindings = await prisma.agentSkillBinding.findMany({
    where: { agentId: input.agentId },
  });
  for (const b of agentBindings) {
    const pkg = await prisma.skillPackage.findUnique({ where: { id: b.skillPackageId } });
    if (!pkg) continue;
    if (b.mode === "exclude") effective.delete(pkg.slug);
    else effective.set(pkg.slug, b.mode);
  }
  layersApplied.push("agent");

  return { skills: [...effective.keys()], layersApplied };
}

export interface ResolvedMcp {
  mcpServers: Array<{ id: string; name: string; transport: string }>;
  deniedGlobalCredential: string[]; // IDs of global MCPs rejected due to credential
}

/**
 * Resolve the effective MCP server set for an agent across four layers:
 * global → team → user → agent. Same convergence semantics as skills.
 *
 * 凭证隔离铁律 (Credential Isolation Iron Rule):
 * Global-scope MCPs MUST NOT carry credentials. Any global McpServer with a
 * non-empty `configEnc` is denied (returned in `deniedGlobalCredential`) and
 * excluded from the effective set — credentials belong only to user/team/agent
 * scopes, never to a shared global registration.
 */
export async function resolveAgentMcpServers(input: ResolveInput): Promise<ResolvedMcp> {
  const effective = new Map<string, { id: string; name: string; transport: string }>();
  const deniedGlobalCredential: string[] = [];

  // global layer — enforce credential isolation
  const globalMcps = await prisma.mcpServer.findMany({
    where: { scope: "global", enabled: true },
  });
  for (const m of globalMcps) {
    if (m.configEnc && m.configEnc.length > 0) {
      // 铁律：global 层挂带凭证 MCP → 拒绝 + 记审计
      deniedGlobalCredential.push(m.id);
      continue;
    }
    effective.set(m.id, { id: m.id, name: m.name, transport: m.transport });
  }

  // team layer (skip when personal scope)
  if (input.scope !== "personal" && input.teamId) {
    const teamMcps = await prisma.mcpServer.findMany({
      where: { scope: "team", teamId: input.teamId, enabled: true },
    });
    for (const m of teamMcps) {
      effective.set(m.id, { id: m.id, name: m.name, transport: m.transport });
    }
  }

  // user layer — MCP has no UserMcpBinding, read user-scoped McpServer directly
  const userMcps = await prisma.mcpServer.findMany({
    where: { scope: "user", userId: input.userId, enabled: true },
  });
  for (const m of userMcps) {
    effective.set(m.id, { id: m.id, name: m.name, transport: m.transport });
  }

  // agent layer convergence — mode include/exclude
  const agentBindings = await prisma.agentMcpBinding.findMany({
    where: { agentId: input.agentId },
  });
  for (const b of agentBindings) {
    const mcp = await prisma.mcpServer.findUnique({ where: { id: b.mcpServerId } });
    if (!mcp) continue;
    if (b.mode === "exclude") {
      effective.delete(b.mcpServerId);
    } else {
      effective.set(b.mcpServerId, { id: mcp.id, name: mcp.name, transport: mcp.transport });
    }
  }

  return {
    mcpServers: [...effective.values()],
    deniedGlobalCredential,
  };
}
