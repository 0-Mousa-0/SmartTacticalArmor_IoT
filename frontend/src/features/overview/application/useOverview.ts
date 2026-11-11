import { useQuery } from '@tanstack/react-query';
import { useDependencies } from '@/app/di/DependenciesContext';

export function useOverview() {
  const { overview } = useDependencies();
  return useQuery({ queryKey: ['overview'], queryFn: () => overview.get(), refetchInterval: 5_000 });
}
