export interface AuthenticatedUser {
  userId: string;
  displayName: string;
  mustChangePassword: boolean;
}

export interface TokenPair {
  accessToken: string;
  accessExpiresIn: number;
  refreshToken: string;
  refreshExpiresIn: number;
}

export interface AuthProvider {
  revoke(userId: string): Promise<void>;
}

export interface PasswordAuthProvider extends AuthProvider {
  authenticate(credential: { username: string; password: string }): Promise<AuthenticatedUser>;
  signAccessToken(userId: string): Promise<string>;
  signRefreshToken(userId: string): Promise<string>;
}

export interface OAuthProvider extends AuthProvider {
  authenticateOAuth(code: string, state: string): Promise<AuthenticatedUser>;
}

let _provider: AuthProvider | null = null;

export function registerAuthProvider(p: AuthProvider): void {
  _provider = p;
}

export function resetAuthProvider(): void {
  _provider = null;
}

export function getAuthProvider(): AuthProvider {
  if (!_provider) throw new Error("AuthProvider not registered");
  return _provider;
}

export function getPasswordAuthProvider(): PasswordAuthProvider {
  const p = getAuthProvider();
  if (
    !p ||
    typeof (p as PasswordAuthProvider).authenticate !== "function" ||
    typeof (p as PasswordAuthProvider).signAccessToken !== "function" ||
    typeof (p as PasswordAuthProvider).signRefreshToken !== "function"
  ) {
    throw new Error("registered AuthProvider is not a PasswordAuthProvider");
  }
  return p as PasswordAuthProvider;
}

export function isPasswordAuthProvider(p: AuthProvider): p is PasswordAuthProvider {
  return (
    typeof (p as PasswordAuthProvider).authenticate === "function" &&
    typeof (p as PasswordAuthProvider).signAccessToken === "function" &&
    typeof (p as PasswordAuthProvider).signRefreshToken === "function"
  );
}
