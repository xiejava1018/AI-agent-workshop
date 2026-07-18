import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Mock the route's dependencies so the test runs without a database or a
// PI_WEB_DATA_DIR filesystem layout. vi.hoisted keeps the mock objects
// available at vi.mock time.
const statsMocks = vi.hoisted(() => ({
  listAllSessions: vi.fn(),
  getSessionMeta: vi.fn(),
  getUserTeamIds: vi.fn(),
  agentCount: vi.fn(),
  skillPackageCount: vi.fn(),
  projectCount: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    agent: { count: statsMocks.agentCount },
    skillPackage: { count: statsMocks.skillPackageCount },
    project: { count: statsMocks.projectCount },
  },
}));
vi.mock("@/lib/session-reader", () => ({ listAllSessions: statsMocks.listAllSessions }));
vi.mock("@/lib/session-meta", () => ({ getSessionMeta: statsMocks.getSessionMeta }));
vi.mock("@/lib/server-user", () => ({ getUserTeamIds: statsMocks.getUserTeamIds }));

import { GET } from "./route";

function makeReq(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/dashboard/stats", { headers });
}

beforeEach(() => {
  statsMocks.listAllSessions.mockReset();
  statsMocks.getSessionMeta.mockReset();
  statsMocks.getUserTeamIds.mockReset();
  statsMocks.agentCount.mockReset();
  statsMocks.skillPackageCount.mockReset();
  statsMocks.projectCount.mockReset();
});

describe("GET /api/dashboard/stats", () => {
  it("returns 401 when x-user-id is missing", async () => {
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "auth required" });
  });

  it("returns counts shaped for the dashboard cards", async () => {
    // Two JSONL sessions belong to the caller (s1, s2); s3 belongs to someone else.
    statsMocks.listAllSessions.mockResolvedValue([{ id: "s1" }, { id: "s2" }, { id: "s3" }]);
    statsMocks.getSessionMeta.mockImplementation((id: string) => ({
      s1: { userId: "u1" },
      s2: { userId: "u1" },
      s3: { userId: "other" },
    })[id]);
    statsMocks.agentCount.mockResolvedValue(5);
    statsMocks.skillPackageCount.mockResolvedValue(12);
    statsMocks.getUserTeamIds.mockResolvedValue(["t1", "t2"]);
    statsMocks.projectCount.mockResolvedValue(3);

    const res = await GET(makeReq({ "x-user-id": "u1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      sessions: 2,
      tokens: 0,
      agents: 5,
      skills: 12,
      projects: 3,
    });
    expect(statsMocks.projectCount).toHaveBeenCalledWith({
      where: { teamId: { in: ["t1", "t2"] } },
    });
  });

  it("returns 500 when a dependency throws", async () => {
    statsMocks.listAllSessions.mockRejectedValue(new Error("boom"));
    const res = await GET(makeReq({ "x-user-id": "u1" }));
    expect(res.status).toBe(500);
  });
});
