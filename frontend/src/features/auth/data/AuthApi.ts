import type { HttpClient } from '@/core/http/HttpClient';
import type { Role } from '@/shared/domain/types';
import type { AuthRepository, Operator, Session } from '../domain/Operator';

export interface OperatorDto {
  operator_id: string;
  full_name: string;
  email: string;
  role: Role;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string | null;
}

interface LoginResponseDto {
  access_token: string;
  expires_in: number;
  operator: OperatorDto;
}

export const toOperator = (dto: OperatorDto): Operator => ({
  id: dto.operator_id,
  fullName: dto.full_name,
  email: dto.email,
  role: dto.role,
  isActive: dto.is_active,
  lastLoginAt: dto.last_login_at,
  createdAt: dto.created_at,
});

export class AuthApi implements AuthRepository {
  constructor(private readonly http: HttpClient) {}

  async login(email: string, password: string): Promise<Session> {
    const dto = await this.http.post<LoginResponseDto>('/auth/login', { email, password });
    return { token: dto.access_token, expiresInSeconds: dto.expires_in, operator: toOperator(dto.operator) };
  }

  async me(): Promise<Operator> {
    return toOperator(await this.http.get<OperatorDto>('/auth/me'));
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await this.http.post('/auth/change-password', { current_password: currentPassword, new_password: newPassword });
  }
}
