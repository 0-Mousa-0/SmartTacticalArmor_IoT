import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDependencies } from '@/app/di/DependenciesContext';
import type { NewOperator, OperatorChanges } from '../domain/OperatorAccounts';

export function useOperators(enabled: boolean) {
  const { operators } = useDependencies();
  return useQuery({ queryKey: ['operators'], queryFn: () => operators.list(), enabled });
}

export function useCreateOperator() {
  const { operators } = useDependencies();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: NewOperator) => operators.create(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['operators'] }),
  });
}

export function useUpdateOperator() {
  const { operators } = useDependencies();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, changes }: { id: string; changes: OperatorChanges }) => operators.update(id, changes),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['operators'] }),
  });
}

export function useChangePassword() {
  const { auth } = useDependencies();
  return useMutation({
    mutationFn: ({ current, next }: { current: string; next: string }) => auth.changePassword(current, next),
  });
}
