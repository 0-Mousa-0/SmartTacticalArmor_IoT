import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDependencies } from '@/app/di/DependenciesContext';
import type { AlertQuery } from '../domain/Alert';

export const alertKeys = {
  all: ['alerts'] as const,
  list: (query: AlertQuery) => ['alerts', 'list', query] as const,
  detail: (id: string) => ['alerts', 'detail', id] as const,
  summary: ['alerts', 'summary'] as const,
};

export function useAlerts(query: AlertQuery) {
  const { alerts } = useDependencies();
  return useQuery({
    queryKey: alertKeys.list(query),
    queryFn: () => alerts.list(query),
    refetchInterval: 5_000,
    placeholderData: keepPreviousData,
  });
}

export function useAlert(id: string | null) {
  const { alerts } = useDependencies();
  return useQuery({
    queryKey: alertKeys.detail(id ?? ''),
    queryFn: () => alerts.get(id as string),
    enabled: Boolean(id),
    refetchInterval: 5_000,
  });
}

export function useAlertSummary() {
  const { alerts } = useDependencies();
  return useQuery({ queryKey: alertKeys.summary, queryFn: () => alerts.summary(), refetchInterval: 10_000 });
}

/** Alerts change the whole picture: refresh lists, overview, units and analysis. */
function useInvalidateOperationalData() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: alertKeys.all });
    void queryClient.invalidateQueries({ queryKey: ['overview'] });
    void queryClient.invalidateQueries({ queryKey: ['units'] });
  };
}

export function useAcknowledgeAlert() {
  const { alerts } = useDependencies();
  const invalidate = useInvalidateOperationalData();
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) => alerts.acknowledge(id, note),
    onSettled: invalidate,
  });
}

export function useResolveAlert() {
  const { alerts } = useDependencies();
  const invalidate = useInvalidateOperationalData();
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) => alerts.resolve(id, note),
    onSettled: invalidate,
  });
}
