export interface SkillSearchResult {
  package: string;
  installs: string;
  url: string;
}

export type PluginScope = "global" | "project";
export type PluginResourceKind = "extension" | "skill" | "prompt" | "theme";

export interface PluginResourceCounts {
  extensions: number;
  skills: number;
  prompts: number;
  themes: number;
}

export interface PluginDiagnostic {
  type: "warning" | "error";
  message: string;
  source?: string;
  path?: string;
}

export interface PluginResourceInfo {
  kind: PluginResourceKind;
  name: string;
  path: string;
  relativePath: string;
}

export interface PluginPackageInfo {
  source: string;
  scope: PluginScope;
  filtered: boolean;
  disabled: boolean;
  installedPath?: string;
  packageName?: string;
  version?: string;
  configuredVersion?: string;
  counts: PluginResourceCounts;
  resources: PluginResourceInfo[];
  status: "loaded" | "installed" | "missing" | "disabled";
}

export interface PluginsResponse {
  packages: PluginPackageInfo[];
  totals: PluginResourceCounts;
  diagnostics: PluginDiagnostic[];
}

// -----------------------------------------------------------------------------
// M3 T5.3 — tenant-scoped plugin listing.
//
// When `/api/plugins` is called with a `scope` query param it returns a
// DB-backed, tenant-filtered list of plugins (skill packages + MCP servers)
// resolved for the caller. This is distinct from the legacy filesystem-based
// `PluginsResponse` returned when `cwd` is supplied.
// -----------------------------------------------------------------------------

export type PluginTenantScope = "global" | "team" | "user" | "agent";

export type ScopedPluginKind = "skill" | "mcp";

export interface ScopedPluginInfo {
  id: string;
  kind: ScopedPluginKind;
  name: string;
  scope: string; // owning scope of the underlying row: global | team | user
  slug?: string; // skills only
  transport?: string; // MCP only
  teamId?: string | null;
  userId?: string | null;
}

export interface ScopedPluginsResponse {
  scope: PluginTenantScope;
  tenantId: string | null;
  plugins: ScopedPluginInfo[];
}
