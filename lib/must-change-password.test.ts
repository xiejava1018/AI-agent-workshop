// lib/must-change-password.test.ts
import { describe, it, expect } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { enforceNotMustChange } from "./must-change-password";

function makeReq(pathname: string, flag: string | null): NextRequest {
  const url = `http://localhost:30141${pathname}`;
  const headers: Record<string, string> = {};
  if (flag !== null) headers["x-must-change-password"] = flag;
  return new NextRequest(url, { headers });
}

describe("enforceNotMustChange", () => {
  it("allows change-password endpoint regardless of flag", () => {
    expect(enforceNotMustChange(makeReq("/api/auth/change-password", "true"))).toBeNull();
    expect(enforceNotMustChange(makeReq("/api/auth/change-password", "false"))).toBeNull();
    expect(enforceNotMustChange(makeReq("/api/auth/change-password", null))).toBeNull();
  });

  it("blocks when flag is 'true' on a non-allowlisted path", () => {
    const res = enforceNotMustChange(makeReq("/api/agent/new", "true"));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    expect(res!.headers.get("content-type")).toMatch(/application\/json/);
  });

  it("allows when flag is 'false' on a non-allowlisted path", () => {
    expect(enforceNotMustChange(makeReq("/api/agent/new", "false"))).toBeNull();
  });

  it("allows when flag is missing on a non-allowlisted path", () => {
    // dev direct-curl scenario: no middleware → no header → gate allows
    expect(enforceNotMustChange(makeReq("/api/agent/new", null))).toBeNull();
  });

  it("returns NextResponse.json with error body on block", async () => {
    const res = enforceNotMustChange(makeReq("/api/projects", "true"));
    expect(res).not.toBeNull();
    const body = await res!.json();
    expect(body).toEqual({ error: "password change required" });
  });

  it("blocks on multiple non-allowlisted paths", () => {
    for (const p of ["/api/agent/new", "/api/projects", "/api/projects/abc/bind", "/api/agent/xyz/events", "/api/agent/xyz"]) {
      const res = enforceNotMustChange(makeReq(p, "true"));
      expect(res).not.toBeNull();
      expect(res!.status).toBe(403);
    }
  });
});
