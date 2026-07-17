import { describe, it, expect } from "vitest";
import {
  validateLoginBody,
  INVALID_CREDENTIALS_MESSAGE,
} from "./validation";

describe("validateLoginBody", () => {
  it("returns ok for valid username + password", () => {
    const result = validateLoginBody({ username: "root", password: "secret" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.username).toBe("root");
      expect(result.password).toBe("secret");
    }
  });

  it("returns 400 for null body", () => {
    const result = validateLoginBody(null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.body.error).toBe("missing credentials");
    }
  });

  it("returns 400 for non-object body", () => {
    const result = validateLoginBody("not-an-object");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
    }
  });

  it("returns 400 when username is missing", () => {
    const result = validateLoginBody({ password: "x" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it("returns 400 when password is missing", () => {
    const result = validateLoginBody({ username: "x" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it("returns 400 when both fields are missing", () => {
    const result = validateLoginBody({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it("returns 400 when username is empty string", () => {
    const result = validateLoginBody({ username: "", password: "x" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it("returns 400 when password is empty string", () => {
    const result = validateLoginBody({ username: "x", password: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it("returns 400 when username is a number (not a string)", () => {
    const result = validateLoginBody({ username: 123, password: "x" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it("returns 400 when password is a boolean (not a string)", () => {
    const result = validateLoginBody({ username: "x", password: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it("returns 400 when username is null", () => {
    const result = validateLoginBody({ username: null, password: "x" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });
});

describe("INVALID_CREDENTIALS_MESSAGE sentinel", () => {
  it("is the literal expected by route → 401 mapping", () => {
    expect(INVALID_CREDENTIALS_MESSAGE).toBe("invalid credentials");
  });
});
