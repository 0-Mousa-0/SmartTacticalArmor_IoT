import { useQuery } from '@tanstack/react-query';
import { useDependencies } from '@/app/di/DependenciesContext';

export function useSystemHealth() {
  const { system } = useDependencies();
  return useQuery({ queryKey: ['system', 'health'], queryFn: () => system.health(), refetchInterval: 15_000, retry: 0 });
}
