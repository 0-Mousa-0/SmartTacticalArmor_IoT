import type { Operator } from '@/features/auth/domain/Operator';
import type { Role } from '@/shared/domain/types';

export interface NewOperator {
  email: string;
  fullName: string;
  role: Role;
  password: string;
}

export interface OperatorChanges {
  fullName?: string;
  role?: Role;
  isActive?: boolean;
  password?: string;
}

export interface OperatorRepository {
  list(): Promise<Operator[]>;
  create(input: NewOperator): Promise<Operator>;
  update(id: string, changes: OperatorChanges): Promise<Operator>;
}
