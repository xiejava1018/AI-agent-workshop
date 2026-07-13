import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { rebuildFromJsonl, type SessionMetaRow } from "./session-meta";

let tmpDir: string;
let origDataDir: string | undefined;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "session-meta-test-"));
  origDataDir = process.env.PI_WEB_DATA_DIR;
  process.env.PI_WEB_DATA_DIR = tmpDir;
});

afterEach(() => {
  if (origDataDir !== undefined) {
    process.env.PI_WEB_DATA_DIR = origDataDir;
  } else {
    delete process.env.PI_WEB_DATA_DIR;
  }
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

describe("rebuildFromJsonl", () => {
  it("populates map from .jsonl files with userId", async () => {
    writeFileSync(
      join(tmpDir, "session1.jsonl"),
      JSON.stringify({ type: "session", userId: "user-1", projectId: "proj-1" }) + "\n"
    );
    const map = new Map<string, SessionMetaRow>();
    await rebuildFromJsonl(map);
    expect(map.size).toBe(1);
    expect(map.get("session1")?.userId).toBe("user-1");
    expect(map.get("session1")?.projectId).toBe("proj-1");
    expect(map.get("session1")?.createdAt).toEqual(expect.any(Number));
  });

  it("handles empty data directory gracefully", async () => {
    const map = new Map<string, SessionMetaRow>();
    await rebuildFromJsonl(map);
    expect(map.size).toBe(0);
  });

  it("falls back to userId=null on parse failure (M1 spec degradation)", async () => {
    writeFileSync(join(tmpDir, "broken.jsonl"), "this is not valid JSON\n");
    const map = new Map<string, SessionMetaRow>();
    await rebuildFromJsonl(map);
    expect(map.size).toBe(1);
    expect(map.get("broken")?.userId).toBeNull();
    expect(map.get("broken")?.projectId).toBeNull();
  });

  it("scans subdirectories", async () => {
    mkdirSync(join(tmpDir, "sub"));
    writeFileSync(
      join(tmpDir, "sub", "session2.jsonl"),
      JSON.stringify({ userId: "user-2" }) + "\n"
    );
    const map = new Map<string, SessionMetaRow>();
    await rebuildFromJsonl(map);
    expect(map.size).toBe(1);
    expect(map.get("session2")?.userId).toBe("user-2");
  });

  it("does not overwrite pre-existing entries (idempotent)", async () => {
    writeFileSync(
      join(tmpDir, "session3.jsonl"),
      JSON.stringify({ userId: "user-from-disk" }) + "\n"
    );
    const map = new Map<string, SessionMetaRow>();
    map.set("session3", { userId: "user-in-memory", projectId: null, createdAt: 123 });
    await rebuildFromJsonl(map);
    expect(map.get("session3")?.userId).toBe("user-in-memory");
  });

  it("skips non-jsonl files", async () => {
    writeFileSync(join(tmpDir, "readme.md"), "not a jsonl");
    writeFileSync(join(tmpDir, "session4.jsonl"), JSON.stringify({ userId: "u" }) + "\n");
    const map = new Map<string, SessionMetaRow>();
    await rebuildFromJsonl(map);
    expect(map.size).toBe(1);
  });
});
