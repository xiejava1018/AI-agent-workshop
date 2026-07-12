export interface AuthenticatedUser {
  id: string;
  username: string;
  mustChangePassword: boolean;
}

export interface AuthProvider {
  authenticate(username: string, password: string): Promise<AuthenticatedUser>;
  revoke(userId: string): Promise<void>;
}

let _provider: AuthProvider | null = null;

export function registerAuthProvider(p: AuthProvider): void {
  _provider = p;
}

export function getAuthProvider(): AuthProvider {
  if (!_provider) throw new Error("AuthProvider not registered");
  return _provider;
}