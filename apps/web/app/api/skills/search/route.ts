import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserContext } from "@/lib/server-user";
import { runNpx } from "@/lib/npx";
import type { SkillSearchResult } from "@/lib/api-types";

export const dynamic = "force-dynamic";

const ANSI_RE = /\x1B\[[0-9;]*m/g;

// -----------------------------------------------------------------------------
// Helpers for DB-backed scope-filtered search (T5.2)
// -----------------------------------------------------------------------------

const VALID_SCOPES = ["global", "team", "user"] as const;

function unauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: "auth required" }, { status: 401 });
}

/**
 * Build a Prisma `where` clause for the SkillPackage search.
 *
 * - `q` (optional): fuzzy search over name and description (case-insensitive contains).
 * - `scope` (optional): one of "global" | "team" | "user". When team scope is
 *   selected, only packages belonging to teams the caller is a member of are
 *   returned. When user scope is selected, only the caller's own packages are
 *   returned.
 */
async function buildSearchWhere(
  callerId: string,
  q: string | null,
  scope: string | null,
  teamIds: string[],
): Promise<Record<string, unknown>> {
  const where: Record<string, unknown> = {};

  // Text search
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
    ];
  }

  // Scope filtering
  if (scope && (VALID_SCOPES as readonly string[]).includes(scope)) {
    if (scope === "global") {
      where.scope = "global";
    } else if (scope === "team") {
      where.scope = "team";
      where.teamId = { in: teamIds };
    } else if (scope === "user") {
      where.scope = "user";
      where.userId = callerId;
    }
  }

  return where;
}
const DEFAULT_LIMIT = 50;
const MIN_LIMIT = 1;
const MAX_LIMIT = 50;
const SEARCH_API_BASE = process.env.SKILLS_API_URL || "https://skills.sh";

interface SkillsApiSkill {
  id?: string;
  name?: string;
  source?: string;
  installs?: number;
}

interface SkillsApiResponse {
  skills?: SkillsApiSkill[];
}

function parseLimit(value: unknown): number {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.floor(num)));
}

function formatInstalls(count?: number): string {
  if (!count || count <= 0) return "";
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, "")}M installs`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1).replace(/\.0$/, "")}K installs`;
  return `${count} install${count === 1 ? "" : "s"}`;
}

function parseSearchOutput(raw: string): SkillSearchResult[] {
  const clean = raw.replace(ANSI_RE, "");
  const results: SkillSearchResult[] = [];
  const lines = clean.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // package line: "owner/repo@skill  NNK installs"
    const pkgMatch = line.match(/^([\w.\-]+\/[\w.\-@:]+)\s+([\d.,]+[KMB]?\s+installs)$/);
    if (pkgMatch) {
      const urlLine = lines[i + 1]?.trim().replace(/^└\s*/, "");
      results.push({
        package: pkgMatch[1],
        installs: pkgMatch[2],
        url: urlLine?.startsWith("https://") ? urlLine : "",
      });
    }
  }
  return results;
}

async function searchSkillsApi(query: string, limit: number): Promise<SkillSearchResult[]> {
  const url = `${SEARCH_API_BASE}/api/search?q=${encodeURIComponent(query)}&limit=${limit}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`skills.sh search failed: HTTP ${res.status}`);

  const data = (await res.json()) as SkillsApiResponse;
  return (data.skills ?? [])
    .map((skill) => {
      const name = skill.name?.trim();
      const source = skill.source?.trim();
      const slug = skill.id?.trim();
      if (!name || (!source && !slug)) return null;

      const pkg = `${source || slug}@${name}`;
      return {
        package: pkg,
        installs: formatInstalls(skill.installs),
        url: slug ? `${SEARCH_API_BASE}/${slug}` : "",
      };
    })
    .filter((skill): skill is SkillSearchResult => skill !== null)
    .sort((a, b) => parseInstallCount(b.installs) - parseInstallCount(a.installs));
}

function parseInstallCount(installs: string): number {
  const match = installs.match(/^([\d.]+)([KMB])?\s+installs?$/);
  if (!match) return 0;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return 0;
  const multiplier = match[2] === "B" ? 1_000_000_000 : match[2] === "M" ? 1_000_000 : match[2] === "K" ? 1_000 : 1;
  return value * multiplier;
}

// -----------------------------------------------------------------------------
// GET /api/skills/search — scope-filtered DB-backed skill package search
// Query params:
//   q       — text search (name / description, case-insensitive contains)
//   scope   — "global" | "team" | "user" (default: all scopes)
//
// RBAC: any authenticated user.
// -----------------------------------------------------------------------------

export async function GET(req: NextRequest): Promise<NextResponse> {
  const callerId = req.headers.get("x-user-id");
  if (!callerId) return unauthorizedResponse();

  const ctx = await getCurrentUserContext(callerId);
  if (!ctx) return unauthorizedResponse();

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q");
  const scope = searchParams.get("scope");

  try {
    const where = await buildSearchWhere(callerId, q, scope, ctx.teamIds);
    const skills = await prisma.skillPackage.findMany({
      where,
      orderBy: { name: "asc" },
    });
    return NextResponse.json({ skills });
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// POST /api/skills/search  body: { query: string, limit?: number }
export async function POST(req: Request) {
  try {
    const { query, limit: rawLimit } = await req.json() as { query?: string; limit?: unknown };
    if (!query?.trim()) return NextResponse.json({ error: "query required" }, { status: 400 });
    const limit = parseLimit(rawLimit);

    try {
      const results = await searchSkillsApi(query.trim(), limit);
      return NextResponse.json({ results });
    } catch {
      const { stdout, stderr } = await runNpx(["skills", "find", query.trim()], {
        timeout: 20000,
        env: { ...process.env, FORCE_COLOR: "0" },
      });

      const results = parseSearchOutput(stdout + stderr).slice(0, limit);
      return NextResponse.json({ results });
    }
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    const raw = (err.stdout ?? "") + (err.stderr ?? "");
    const results = raw ? parseSearchOutput(raw) : [];
    if (results.length > 0) return NextResponse.json({ results });
    return NextResponse.json({ error: err.message ?? String(e) }, { status: 500 });
  }
}
