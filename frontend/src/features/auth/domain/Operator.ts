import type { Role } from '@/shared/domain/types';

export interface Operator {
  id: string;
  fullName: string;
  email: string;
  role: Role;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string | null;
  /** Anonymous visitor: the API runs in public-access mode (no sign-in). */
  isPublic: boolean;
}

export interface Session {
  token: string;
  expiresInSeconds: number;
  operator: Operator;
}

export interface AuthRepository {
  login(email: string, password: string): Promise<Session>;
  me(): Promise<Operator>;
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
}
