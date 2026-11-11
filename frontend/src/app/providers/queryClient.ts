import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/core/http/ApiError';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Data stays fresh through polling; don't retry what can't succeed.
        retry: (failures, error) => !(error instanceof ApiError && [401, 403, 404].includes(error.status)) && failures < 2,
        refetchOnWindowFocus: false,
        staleTime: 2_000,
      },
    },
  });
}
