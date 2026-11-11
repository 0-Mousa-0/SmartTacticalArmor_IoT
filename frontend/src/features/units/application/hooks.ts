import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDependencies } from '@/app/di/DependenciesContext';
import type { CommandType } from '../domain/Unit';

/** Polling cadence matches the vest's report interval (5 s by default). */
export const unitKeys = {
  all: ['units'] as const,
  detail: (id: string) => ['units', id] as const,
  history: (id: string, minutes: number) => ['units', id, 'history', minutes] as const,
  commands: (id: string) => ['units', id, 'commands'] as const,
};

export function useUnits() {
  const { units } = useDependencies();
  return useQuery({ queryKey: unitKeys.all, queryFn: () => units.list(), refetchInterval: 5_000 });
}

export function useUnit(id: string) {
  const { units } = useDependencies();
  return useQuery({ queryKey: unitKeys.detail(id), queryFn: () => units.get(id), refetchInterval: 3_000 });
}

export function useTelemetryHistory(id: string, minutes: number) {
  const { units } = useDependencies();
  return useQuery({
    queryKey: unitKeys.history(id, minutes),
    queryFn: () => units.history(id, minutes),
    refetchInterval: 10_000,
    placeholderData: keepPreviousData,
  });
}

export function useCommands(id: string) {
  const { units } = useDependencies();
  return useQuery({ queryKey: unitKeys.commands(id), queryFn: () => units.commands(id), refetchInterval: 4_000 });
}

export function useSendCommand(id: string) {
  const { units } = useDependencies();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ type, params }: { type: CommandType; params?: Record<string, unknown> }) => units.sendCommand(id, type, params),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: unitKeys.commands(id) });
      void queryClient.invalidateQueries({ queryKey: unitKeys.detail(id) });
    },
  });
}
