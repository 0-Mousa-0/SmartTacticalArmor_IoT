import type { HttpClient } from '@/core/http/HttpClient';
import { toOperator, type OperatorDto } from '@/features/auth/data/AuthApi';
import type { Operator } from '@/features/auth/domain/Operator';
import type { NewOperator, OperatorChanges, OperatorRepository } from '../domain/OperatorAccounts';

export class OperatorApi implements OperatorRepository {
  constructor(private readonly http: HttpClient) {}

  async list(): Promise<Operator[]> {
    return (await this.http.get<OperatorDto[]>('/operators')).map(toOperator);
  }

  async create(input: NewOperator): Promise<Operator> {
    return toOperator(
      await this.http.post<OperatorDto>('/operators', {
        email: input.email,
        full_name: input.fullName,
        role: input.role,
        password: input.password,
      }),
    );
  }

  async update(id: string, changes: OperatorChanges): Promise<Operator> {
    const body: Record<string, unknown> = {};
    if (changes.fullName !== undefined) body.full_name = changes.fullName;
    if (changes.role !== undefined) body.role = changes.role;
    if (changes.isActive !== undefined) body.is_active = changes.isActive;
    if (changes.password) body.password = changes.password;
    return toOperator(await this.http.patch<OperatorDto>(`/operators/${encodeURIComponent(id)}`, body));
  }
}
