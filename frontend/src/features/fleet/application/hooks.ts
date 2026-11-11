import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDependencies } from '@/app/di/DependenciesContext';
import type { PersonnelInput, VestInput } from '../domain/Fleet';

export function usePersonnel() {
  const { fleet } = useDependencies();
  return useQuery({ queryKey: ['personnel'], queryFn: () => fleet.listPersonnel() });
}

function useInvalidateFleet() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['personnel'] });
    void queryClient.invalidateQueries({ queryKey: ['units'] });
    void queryClient.invalidateQueries({ queryKey: ['overview'] });
  };
}

export function useSavePersonnel() {
  const { fleet } = useDependencies();
  const invalidate = useInvalidateFleet();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: PersonnelInput }) =>
      id ? fleet.updatePersonnel(id, input) : fleet.createPersonnel(input),
    onSuccess: invalidate,
  });
}

export function useDeactivatePersonnel() {
  const { fleet } = useDependencies();
  const invalidate = useInvalidateFleet();
  return useMutation({ mutationFn: (id: string) => fleet.deactivatePersonnel(id), onSuccess: invalidate });
}

export function useSaveVest() {
  const { fleet } = useDependencies();
  const invalidate = useInvalidateFleet();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: VestInput }) => (id ? fleet.updateVest(id, input) : fleet.registerVest(input)),
    onSuccess: invalidate,
  });
}

export function useRetireVest() {
  const { fleet } = useDependencies();
  const invalidate = useInvalidateFleet();
  return useMutation({ mutationFn: (id: string) => fleet.retireVest(id), onSuccess: invalidate });
}
