import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { assertWithinRoot, PathTraversalError } from "./path-safety";

let root: string;
let outside: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "path-safety-"));
  outside = mkdtempSync(join(tmpdir(), "path-safety-out-"));
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "index.ts"), "// hello");
  // 符号链接指向外
  try {
    symlinkSync(join(outside, "leak.txt"), join(root, "src", "leak.txt"));
    writeFileSync(join(outside, "leak.txt"), "secret");
  } catch {}
});

afterAll(() => { rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); });

describe("assertWithinRoot", () => {
  it("accepts legitimate child path", () => {
    const r = assertWithinRoot(join(root, "src", "index.ts"), root);
    expect(r).toContain("index.ts");
  });

  it("rejects .. traversal", () => {
    expect(() => assertWithinRoot(join(root, "src", "..", "..", "etc", "passwd"), root))
      .toThrow(PathTraversalError);
  });

  it("rejects absolute escape", () => {
    expect(() => assertWithinRoot("/etc/passwd", root)).toThrow(PathTraversalError);
  });

  it("rejects symlink pointing outside root", () => {
    expect(() => assertWithinRoot(join(root, "src", "leak.txt"), root))
      .toThrow(PathTraversalError);
  });

  it("accepts relative input resolved under root", () => {
    const r = assertWithinRoot("src/index.ts", root);
    expect(r).toContain("index.ts");
  });
});