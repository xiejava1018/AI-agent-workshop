export interface UserDto {
  id: string;
  username: string;
  role: "OWNER" | "ADMIN" | "MEMBER" | null;
  mustChangePassword: boolean;
  status: "active" | "disabled" | "deleted";
  createdAt: string;
}

export interface CreateUserRequest {
  username: string;
}

export interface CreateUserResponse {
  id: string;
  username: string;
  initialPassword: string;
}

export interface ResetPasswordResponse {
  initialPassword: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface SessionInfo {
  id: string;
  parentSessionId?: string | null;
  cwd: string;
  projectRoot?: string;
  title?: string;
  modified: string;
  createdBy?: string;
  teamId?: string;
}

export interface ModelConfigDto {
  enabledModels: string[];
  defaultModel?: string;
  allowUserOverride: boolean;
}

export interface ApiResponse<T> {
  data?: T;
  error?: string;
}

export interface PaginatedResponse<T> {
  list: T[];
  total: number;
}

export type UserStatus = "active" | "disabled" | "deleted";
export type UserRole = "OWNER" | "ADMIN" | "MEMBER";
