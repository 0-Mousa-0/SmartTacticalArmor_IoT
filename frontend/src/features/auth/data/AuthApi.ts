import type { HttpClient } from '@/core/http/HttpClient';
import type { Role } from '@/shared/domain/types';
import type { AuthRepository, Operator, Session } from '../domain/Operator';

export interface OperatorDto {
  operator_id: string | null;
  full_name: string;
  email: string | null;
  role: Role;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string | null;
  /** Only /auth/me without a session, when the API allows public access. */
  public?: boolean;
}

interface LoginResponseDto {
  access_token: string;
  expires_in: number;
  operator: OperatorDto;
}

export const toOperator = (dto: OperatorDto): Operator => ({
  id: dto.operator_id ?? '',
  fullName: dto.full_name,
  email: dto.email ?? '',
  role: dto.role,
  isActive: dto.is_active,
  lastLoginAt: dto.last_login_at,
  createdAt: dto.created_at,
  isPublic: dto.public === true,
});

export class AuthApi implements AuthRepository {
  constructor(private readonly http: HttpClient) {}

  async login(email: string, password: string): Promise<Session> {
    const dto = await this.http.post<LoginResponseDto>('/auth/login', { email, password });
    return { token: dto.access_token, expiresInSeconds: dto.expires_in, operator: toOperator(dto.operator) };
  }

  /** The signed-in operator, or the public-access visitor; 401 = sign-in required. */
  async me(): Promise<Operator> {
    return toOperator(await this.http.get<OperatorDto>('/auth/me'));
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await this.http.post('/auth/change-password', { current_password: currentPassword, new_password: newPassword });
  }
}
