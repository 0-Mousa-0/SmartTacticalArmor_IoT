import { useQuery } from '@tanstack/react-query';
import { useDependencies } from '@/app/di/DependenciesContext';

export function useAnalysis() {
  const { analysis } = useDependencies();
  return useQuery({ queryKey: ['analysis'], queryFn: () => analysis.summary(), refetchInterval: 10_000 });
}
