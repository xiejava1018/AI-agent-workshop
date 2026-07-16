import { describe, it, expect, beforeEach } from "vitest";
import {
  AuthProvider,
  PasswordAuthProvider,
  OAuthProvider,
  TokenPair,
  AuthenticatedUser,
  registerAuthProvider,
  getAuthProvider,
  getPasswordAuthProvider,
  resetAuthProvider,
} from "./auth-provider";

beforeEach(() => {
  resetAuthProvider();
});

describe("auth-provider registry", () => {
  it("getAuthProvider throws when not registered", () => {
    expect(() => getAuthProvider()).toThrow("AuthProvider not registered");
  });

  it("getPasswordAuthProvider throws when not registered", () => {
    expect(() => getPasswordAuthProvider()).toThrow("AuthProvider not registered");
  });

  it("getPasswordAuthProvider throws when registered provider is not a PasswordAuthProvider", () => {
    const baseProvider: AuthProvider = {
      revoke: async () => {},
    };
    registerAuthProvider(baseProvider);
    expect(() => getPasswordAuthProvider()).toThrow(
      "registered AuthProvider is not a PasswordAuthProvider"
    );
  });

  it("registers a PasswordAuthProvider and exposes getAuthProvider/getPasswordAuthProvider", async () => {
    const user: AuthenticatedUser = {
      userId: "u-1",
      displayName: "alice",
      mustChangePassword: false,
    };

    const mockProvider: PasswordAuthProvider = {
      revoke: async () => {},
      authenticate: async (_credential: { username: string; password: string }) => user,
      signAccessToken: async (userId: string) => `access-${userId}`,
      signRefreshToken: async (userId: string) => `refresh-${userId}`,
    };

    registerAuthProvider(mockProvider);

    expect(getAuthProvider()).toBe(mockProvider);
    const passwordProvider = getPasswordAuthProvider();
    expect(passwordProvider).toBe(mockProvider);

    const authenticated = await passwordProvider.authenticate({
      username: "alice",
      password: "secret",
    });
    expect(authenticated).toEqual(user);

    const accessToken = await passwordProvider.signAccessToken(user.userId);
    expect(accessToken).toBe("access-u-1");

    const refreshToken = await passwordProvider.signRefreshToken(user.userId);
    expect(refreshToken).toBe("refresh-u-1");
  });
});

describe("OAuthProvider placeholder", () => {
  it("is type-compatible with a minimal implementation", () => {
    const oauth: OAuthProvider = {
      revoke: async () => {},
      authenticateOAuth: async (_code: string, _state: string) => ({
        userId: "oauth-1",
        displayName: "OAuth User",
        mustChangePassword: false,
      }),
    };

    expect(typeof oauth.authenticateOAuth).toBe("function");
    expect(typeof oauth.revoke).toBe("function");
  });
});

describe("TokenPair interface", () => {
  it("can be constructed with the documented shape", () => {
    const pair: TokenPair = {
      accessToken: "at",
      accessExpiresIn: 15 * 60,
      refreshToken: "rt",
      refreshExpiresIn: 7 * 24 * 60 * 60,
    };
    expect(pair.accessExpiresIn).toBe(900);
    expect(pair.refreshExpiresIn).toBe(604800);
  });
});
