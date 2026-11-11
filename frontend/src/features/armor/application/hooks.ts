import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useDependencies } from '@/app/di/DependenciesContext';
import type { ShieldingInput } from '../domain/Shielding';

export function useShieldingDataset() {
  const { armor } = useDependencies();
  return useQuery({ queryKey: ['armor', 'dataset'], queryFn: () => armor.dataset(), staleTime: Infinity });
}

/** Server-side calculation (single source of truth); results are cached per input. */
export function useShieldingEstimate(input: ShieldingInput | null) {
  const { armor } = useDependencies();
  return useQuery({
    queryKey: ['armor', 'estimate', input],
    queryFn: () => armor.estimate(input as ShieldingInput),
    enabled: input !== null,
    staleTime: Infinity,
    placeholderData: keepPreviousData,
  });
}
