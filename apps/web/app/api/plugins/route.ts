import { NextResponse } from "next/server";
import { existsSync, readFileSync, statSync } from "fs";
import { basename, dirname, extname, join, relative } from "path";
import {
  DefaultPackageManager,
  getAgentDir,
  SettingsManager,
  type PackageSource,
  type ResolvedPaths,
  type ResolvedResource,
} from "@earendil-works/pi-coding-agent";
import type {
  PluginDiagnostic,
  PluginPackageInfo,
  PluginResourceCounts,
  PluginResourceInfo,
  PluginResourceKind,
  PluginScope,
  PluginsResponse,
  PluginTenantScope,
  ScopedPluginInfo,
  ScopedPluginsResponse,
} from "@/lib/api-types";
import { prisma } from "@/lib/prisma";
import { getCurrentUserContext } from "@/lib/server-user";
import { resolveAgentSkills, resolveAgentMcpServers } from "@/lib/scope-resolve";

export const dynamic = "force-dynamic";

type PluginAction = "install" | "remove" | "update" | "disable" | "enable";

function emptyCounts(): PluginResourceCounts {
  return { extensions: 0, skills: 0, prompts: 0, themes: 0 };
}

function toPluginScope(scope: string): PluginScope {
  return scope === "project" ? "project" : "global";
}

function keyFor(source: string, scope: PluginScope): string {
  return `${scope}\0${source}`;
}

function getPackageSource(entry: PackageSource): string {
  return typeof entry === "string" ? entry : entry.source;
}

function isDisabledPackage(entry: PackageSource): boolean {
  if (typeof entry === "string") return false;
  return (
    Array.isArray(entry.extensions) && entry.extensions.length === 0 &&
    Array.isArray(entry.skills) && entry.skills.length === 0 &&
    Array.isArray(entry.prompts) && entry.prompts.length === 0 &&
    Array.isArray(entry.themes) && entry.themes.length === 0
  );
}

function getDisabledPackages(settingsManager: SettingsManager): Map<string, boolean> {
  const disabled = new Map<string, boolean>();
  for (const entry of settingsManager.getGlobalSettings().packages ?? []) {
    disabled.set(keyFor(getPackageSource(entry), "global"), isDisabledPackage(entry));
  }
  for (const entry of settingsManager.getProjectSettings().packages ?? []) {
    disabled.set(keyFor(getPackageSource(entry), "project"), isDisabledPackage(entry));
  }
  return disabled;
}

function setPackageDisabled(
  settingsManager: SettingsManager,
  source: string,
  scope: PluginScope,
  disabled: boolean,
): boolean {
  const current = scope === "project"
    ? settingsManager.getProjectSettings().packages ?? []
    : settingsManager.getGlobalSettings().packages ?? [];
  let changed = false;
  const next = current.map((entry): PackageSource => {
    if (getPackageSource(entry) !== source) return entry;
    changed = true;
    if (disabled) {
      return {
        ...(typeof entry === "string" ? { source: entry } : entry),
        extensions: [],
        skills: [],
        prompts: [],
        themes: [],
      };
    }
    return getPackageSource(entry);
  });
  if (!changed) return false;
  if (scope === "project") settingsManager.setProjectPackages(next);
  else settingsManager.setPackages(next);
  return true;
}

function addCount(counts: PluginResourceCounts, kind: keyof PluginResourceCounts): void {
  counts[kind] += 1;
}

function getResourceName(path: string, kind: PluginResourceKind): string {
  const file = basename(path);
  const ext = extname(file);
  if (kind === "skill" && file.toLowerCase() === "skill.md") return basename(dirname(path));
  if ((kind === "extension" || kind === "theme" || kind === "prompt") && ext) {
    if (kind === "extension" && /^index\.(ts|js)$/.test(file)) return basename(dirname(path));
    return file.slice(0, -ext.length);
  }
  return file;
}

function getRelativePath(resource: ResolvedResource): string {
  const baseDir = resource.metadata.baseDir;
  if (!baseDir) return resource.path;
  const rel = relative(baseDir, resource.path);
  return rel && !rel.startsWith("..") ? rel : resource.path;
}

function getConfiguredVersion(source: string): string | undefined {
  const npmSpec = source.startsWith("npm:") ? source.slice(4) : undefined;
  if (npmSpec) {
    const lastAt = npmSpec.lastIndexOf("@");
    const packageNameEnd = npmSpec.startsWith("@") ? npmSpec.indexOf("/", 1) : 0;
    if (lastAt > packageNameEnd) return npmSpec.slice(lastAt + 1) || undefined;
    return undefined;
  }

  if (source.startsWith("git:") || /^[a-z]+:\/\//.test(source)) {
    const lastAt = source.lastIndexOf("@");
    const lastSlash = source.lastIndexOf("/");
    const lastColon = source.lastIndexOf(":");
    if (lastAt > Math.max(lastSlash, lastColon)) return source.slice(lastAt + 1) || undefined;
  }
  return undefined;
}

function readPackageMetadata(installedPath?: string): { packageName?: string; version?: string } {
  if (!installedPath) return {};
  try {
    const stats = statSync(installedPath);
    const packageJsonPath = stats.isDirectory()
      ? join(installedPath, "package.json")
      : join(dirname(installedPath), "package.json");
    if (!existsSync(packageJsonPath)) return {};
    const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      name?: unknown;
      version?: unknown;
    };
    return {
      packageName: typeof parsed.name === "string" ? parsed.name : undefined,
      version: typeof parsed.version === "string" ? parsed.version : undefined,
    };
  } catch {
    return {};
  }
}

function collectResource(
  resource: ResolvedResource,
  kind: keyof PluginResourceCounts,
  countsByPackage: Map<string, PluginResourceCounts>,
  resourcesByPackage: Map<string, PluginResourceInfo[]>,
  totals: PluginResourceCounts,
): void {
  if (!resource.enabled || resource.metadata.origin !== "package") return;
  const source = resource.metadata.source;
  const scope = toPluginScope(resource.metadata.scope);
  const key = keyFor(source, scope);
  const counts = countsByPackage.get(key) ?? emptyCounts();
  addCount(counts, kind);
  addCount(totals, kind);
  countsByPackage.set(key, counts);
  const resources = resourcesByPackage.get(key) ?? [];
  const resourceKind = kind === "extensions"
    ? "extension"
    : kind === "skills"
      ? "skill"
      : kind === "prompts"
        ? "prompt"
        : "theme";
  resources.push({
    kind: resourceKind,
    name: getResourceName(resource.path, resourceKind),
    path: resource.path,
    relativePath: getRelativePath(resource),
  });
  resourcesByPackage.set(key, resources);
}

function collectResources(paths: ResolvedPaths): {
  countsByPackage: Map<string, PluginResourceCounts>;
  resourcesByPackage: Map<string, PluginResourceInfo[]>;
  totals: PluginResourceCounts;
} {
  const countsByPackage = new Map<string, PluginResourceCounts>();
  const resourcesByPackage = new Map<string, PluginResourceInfo[]>();
  const totals = emptyCounts();
  for (const resource of paths.extensions) collectResource(resource, "extensions", countsByPackage, resourcesByPackage, totals);
  for (const resource of paths.skills) collectResource(resource, "skills", countsByPackage, resourcesByPackage, totals);
  for (const resource of paths.prompts) collectResource(resource, "prompts", countsByPackage, resourcesByPackage, totals);
  for (const resource of paths.themes) collectResource(resource, "themes", countsByPackage, resourcesByPackage, totals);
  return { countsByPackage, resourcesByPackage, totals };
}

async function readPlugins(cwd: string): Promise<PluginsResponse> {
  const settingsManager = SettingsManager.create(cwd, getAgentDir());
  const packageManager = new DefaultPackageManager({
    cwd,
    agentDir: getAgentDir(),
    settingsManager,
  });

  const diagnostics: PluginDiagnostic[] = [];
  let countsByPackage = new Map<string, PluginResourceCounts>();
  let resourcesByPackage = new Map<string, PluginResourceInfo[]>();
  let totals = emptyCounts();
  const disabledByPackage = getDisabledPackages(settingsManager);

  try {
    const resolved = await packageManager.resolve(async (source) => {
      diagnostics.push({
        type: "warning",
        source,
        message: "Package is configured but not installed yet.",
      });
      return "skip";
    });
    ({ countsByPackage, resourcesByPackage, totals } = collectResources(resolved));
  } catch (error) {
    diagnostics.push({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }

  const packages = packageManager.listConfiguredPackages().map((pkg) => {
    const scope = toPluginScope(pkg.scope);
    const key = keyFor(pkg.source, scope);
    const disabled = disabledByPackage.get(key) ?? false;
    const counts = countsByPackage.get(key) ?? emptyCounts();
    const resources = resourcesByPackage.get(key) ?? [];
    const resourceCount = counts.extensions + counts.skills + counts.prompts + counts.themes;
    const packageMetadata = readPackageMetadata(pkg.installedPath);
    if (!pkg.installedPath) {
      diagnostics.push({
        type: "warning",
        source: pkg.source,
        message: "Configured package path was not found.",
      });
    }
    return {
      source: pkg.source,
      scope,
      filtered: pkg.filtered,
      disabled,
      installedPath: pkg.installedPath,
      packageName: packageMetadata.packageName,
      version: packageMetadata.version,
      configuredVersion: getConfiguredVersion(pkg.source),
      counts,
      resources,
      status: disabled ? "disabled" : resourceCount > 0 ? "loaded" : pkg.installedPath ? "installed" : "missing",
    } satisfies PluginPackageInfo;
  });

  return { packages, totals, diagnostics };
}

function readScope(scope: unknown): PluginScope {
  return scope === "project" ? "project" : "global";
}

// -----------------------------------------------------------------------------
// M3 T5.3 — tenant-scoped plugin listing.
//
// When `scope` is supplied, `/api/plugins` returns a DB-backed, tenant-filtered
// list of plugins (skill packages + MCP servers) resolved for the caller.
// Tenant identity is derived from the DB via `x-user-id`; the client-supplied
// `tenantId` is only ever used to *narrow* within the caller's own scope and
// is rejected when it points outside what the caller may access.
// -----------------------------------------------------------------------------

const VALID_TENANT_SCOPES = ["global", "team", "user", "agent"] as const;

function isTenantScope(v: string | null): v is PluginTenantScope {
  return v !== null && (VALID_TENANT_SCOPES as readonly string[]).includes(v);
}

function skillToPlugin(s: {
  id: string;
  slug: string;
  name: string;
  scope: string;
  teamId: string | null;
  userId: string | null;
}): ScopedPluginInfo {
  return {
    id: s.id,
    kind: "skill",
    name: s.name,
    scope: s.scope,
    slug: s.slug,
    teamId: s.teamId,
    userId: s.userId,
  };
}

/**
 * Resolve the tenant-scoped plugin list. `configEnc` is NEVER read into the
 * response — MCP rows are mapped to id/name/transport only.
 *
 * Returns a discriminated result so the caller can map domain errors to the
 * correct HTTP status (400 bad request / 403 forbidden).
 */
async function resolveScopedPlugins(
  scope: PluginTenantScope,
  ctx: { userId: string; teamIds: string[] },
  params: { tenantId: string | null; agentId: string | null },
): Promise<
  | { ok: true; response: ScopedPluginsResponse }
  | { ok: false; status: 400 | 403; error: string }
> {
  const { tenantId, agentId } = params;
  const plugins: ScopedPluginInfo[] = [];

  if (scope === "global") {
    const skills = await prisma.skillPackage.findMany({
      where: { scope: "global", enabled: true },
    });
    for (const s of skills) plugins.push(skillToPlugin(s));
    // 凭证隔离铁律：global 层挂带凭证的 MCP 一律排除。
    const mcps = await prisma.mcpServer.findMany({
      where: { scope: "global", enabled: true },
    });
    for (const m of mcps) {
      if (m.configEnc && m.configEnc.length > 0) continue;
      plugins.push({ id: m.id, kind: "mcp", name: m.name, scope: "global", transport: m.transport });
    }
    return { ok: true, response: { scope, tenantId: null, plugins } };
  }

  if (scope === "team") {
    // A client-supplied tenantId must be one of the caller's own teams.
    if (tenantId && !ctx.teamIds.includes(tenantId)) {
      return { ok: false, status: 403, error: "forbidden: not a member of tenant team" };
    }
    const teamFilter = tenantId ? [tenantId] : ctx.teamIds;
    if (teamFilter.length === 0) {
      return { ok: true, response: { scope, tenantId: tenantId ?? null, plugins } };
    }
    const skills = await prisma.skillPackage.findMany({
      where: { scope: "team", teamId: { in: teamFilter }, enabled: true },
    });
    for (const s of skills) plugins.push(skillToPlugin(s));
    const mcps = await prisma.mcpServer.findMany({
      where: { scope: "team", teamId: { in: teamFilter }, enabled: true },
    });
    for (const m of mcps) {
      plugins.push({ id: m.id, kind: "mcp", name: m.name, scope: "team", teamId: m.teamId, transport: m.transport });
    }
    return { ok: true, response: { scope, tenantId: tenantId ?? null, plugins } };
  }

  if (scope === "user") {
    // User scope is ALWAYS forced to the caller — a client tenantId is ignored.
    const skills = await prisma.skillPackage.findMany({
      where: { scope: "user", userId: ctx.userId, enabled: true },
    });
    for (const s of skills) plugins.push(skillToPlugin(s));
    const mcps = await prisma.mcpServer.findMany({
      where: { scope: "user", userId: ctx.userId, enabled: true },
    });
    for (const m of mcps) {
      plugins.push({ id: m.id, kind: "mcp", name: m.name, scope: "user", userId: m.userId, transport: m.transport });
    }
    return { ok: true, response: { scope, tenantId: ctx.userId, plugins } };
  }

  // scope === "agent" — four-layer resolution for a specific agent.
  if (!agentId) return { ok: false, status: 400, error: "agentId required for agent scope" };
  const agent = await prisma.agent.findUnique({ where: { id: agentId } });
  if (!agent) return { ok: false, status: 400, error: "agent not found" };
  // Access: caller owns the personal agent, or belongs to the agent's team.
  const isOwner = agent.ownerUserId === ctx.userId;
  const inTeam = agent.teamId != null && ctx.teamIds.includes(agent.teamId);
  if (!isOwner && !inTeam) {
    return { ok: false, status: 403, error: "forbidden: cannot access agent" };
  }

  const resolveInput = {
    agentId,
    userId: ctx.userId,
    teamId: agent.teamId,
    scope: agent.scope === "personal" ? ("personal" as const) : ("team" as const),
  };
  const [resolvedSkills, resolvedMcp] = await Promise.all([
    resolveAgentSkills(resolveInput),
    resolveAgentMcpServers(resolveInput),
  ]);
  // Map resolved skill slugs back to their package rows for id/name/scope.
  if (resolvedSkills.skills.length > 0) {
    const pkgs = await prisma.skillPackage.findMany({
      where: { slug: { in: resolvedSkills.skills }, enabled: true },
    });
    const seen = new Set<string>();
    for (const slug of resolvedSkills.skills) {
      const pkg = pkgs.find((p) => p.slug === slug);
      if (pkg && !seen.has(pkg.slug)) {
        seen.add(pkg.slug);
        plugins.push(skillToPlugin(pkg));
      }
    }
  }
  for (const m of resolvedMcp.mcpServers) {
    plugins.push({ id: m.id, kind: "mcp", name: m.name, scope: "agent", transport: m.transport });
  }
  return { ok: true, response: { scope, tenantId: agentId, plugins } };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const scopeParam = searchParams.get("scope");

  // T5.3 — tenant-scoped listing when `scope` is supplied.
  if (scopeParam !== null) {
    if (!isTenantScope(scopeParam)) {
      return NextResponse.json(
        { error: 'scope must be "global" | "team" | "user" | "agent"' },
        { status: 400 },
      );
    }
    const callerId = req.headers.get("x-user-id");
    if (!callerId) return NextResponse.json({ error: "auth required" }, { status: 401 });
    const userCtx = await getCurrentUserContext(callerId);
    if (!userCtx) return NextResponse.json({ error: "auth required" }, { status: 401 });

    try {
      const result = await resolveScopedPlugins(
        scopeParam,
        { userId: callerId, teamIds: userCtx.teamIds },
        { tenantId: searchParams.get("tenantId"), agentId: searchParams.get("agentId") },
      );
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: result.status });
      }
      return NextResponse.json(result.response);
    } catch (error) {
      return NextResponse.json({ error: String(error) }, { status: 500 });
    }
  }

  // Legacy filesystem-based listing (unchanged).
  const cwd = searchParams.get("cwd");
  if (!cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });

  try {
    return NextResponse.json(await readPlugins(cwd));
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// POST /api/plugins body: { action, source?, scope?, cwd }
export async function POST(req: Request) {
  try {
    const body = await req.json() as {
      action?: PluginAction;
      source?: string;
      scope?: PluginScope;
      cwd?: string;
    };
    if (!body.cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });
    if (!body.action) return NextResponse.json({ error: "action required" }, { status: 400 });

    const settingsManager = SettingsManager.create(body.cwd, getAgentDir());
    const packageManager = new DefaultPackageManager({
      cwd: body.cwd,
      agentDir: getAgentDir(),
      settingsManager,
    });
    const source = body.source?.trim();
    const local = readScope(body.scope) === "project";

    if (body.action === "install") {
      if (!source) return NextResponse.json({ error: "source required" }, { status: 400 });
      await packageManager.installAndPersist(source, { local });
    } else if (body.action === "remove") {
      if (!source) return NextResponse.json({ error: "source required" }, { status: 400 });
      await packageManager.removeAndPersist(source, { local });
    } else if (body.action === "update") {
      await packageManager.update(source);
    } else if (body.action === "disable") {
      if (!source) return NextResponse.json({ error: "source required" }, { status: 400 });
      setPackageDisabled(settingsManager, source, readScope(body.scope), true);
      await settingsManager.flush();
    } else if (body.action === "enable") {
      if (!source) return NextResponse.json({ error: "source required" }, { status: 400 });
      setPackageDisabled(settingsManager, source, readScope(body.scope), false);
      await settingsManager.flush();
    } else {
      return NextResponse.json({ error: `Unsupported action: ${body.action}` }, { status: 400 });
    }

    return NextResponse.json(await readPlugins(body.cwd));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
