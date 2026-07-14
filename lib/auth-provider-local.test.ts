import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import bcrypt from "bcryptjs";

// Mock the prisma module so we don't need a live DATABASE_URL in unit tests.
// The SUT imports `./prisma` relative, so we must mock that exact module specifier.
const findUnique = vi.fn();
vi.mock("./prisma", () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => findUnique(...args) },
  },
}));

import { LocalPasswordAuthProvider } from "./auth-provider-local";

const originalEnv = process.env.PI_WEB_JWT_SECRET;

beforeEach(() => {
  findUnique.mockReset();
  process.env.PI_WEB_JWT_SECRET = "test-secret-at-least-32-bytes-long-xxxxxx";
});

afterEach(() => {
  if (originalEnv === undefined) delete process.env.PI_WEB_JWT_SECRET;
  else process.env.PI_WEB_JWT_SECRET = originalEnv;
});

describe("LocalPasswordAuthProvider secret guard", () => {
  it("throws when PI_WEB_JWT_SECRET is not set", async () => {
    delete process.env.PI_WEB_JWT_SECRET;
    const provider = new LocalPasswordAuthProvider();
    await expect(provider.signAccessToken("u-1")).rejects.toThrow(
      "PI_WEB_JWT_SECRET"
    );
  });
});

describe("LocalPasswordAuthProvider.authenticate error semantics", () => {
  it("throws invalid credentials for an unknown user", async () => {
    findUnique.mockResolvedValueOnce(null);
    const provider = new LocalPasswordAuthProvider();
    await expect(
      provider.authenticate({ username: "definitely-not-root", password: "pw" })
    ).rejects.toThrow("invalid credentials");
  });

  it("throws invalid credentials for a wrong password when user exists", async () => {
    const hash = await bcrypt.hash("correct-password", 10);
    findUnique.mockResolvedValueOnce({
      id: "u-1",
      username: "alice",
      passwordHash: hash,
      mustChangePassword: false,
    });
    const provider = new LocalPasswordAuthProvider();
    await expect(
      provider.authenticate({ username: "alice", password: "wrong-password-1234" })
    ).rejects.toThrow("invalid credentials");
  });

  it("returns user info on successful authentication", async () => {
    const hash = await bcrypt.hash("correct-password", 10);
    findUnique.mockResolvedValueOnce({
      id: "u-1",
      username: "alice",
      passwordHash: hash,
      mustChangePassword: true,
    });
    const provider = new LocalPasswordAuthProvider();
    const user = await provider.authenticate({
      username: "alice",
      password: "correct-password",
    });
    expect(user).toEqual({
      userId: "u-1",
      displayName: "alice",
      mustChangePassword: true,
    });
  });
});
