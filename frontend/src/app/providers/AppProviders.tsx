import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { I18nProvider } from '@/core/i18n/I18nProvider';
import type { Lang } from '@/core/i18n/types';
import { AuthProvider } from '@/features/auth/application/AuthProvider';
import { ToastProvider } from '@/shared/ui';
import { createDependencies } from '../di/container';
import type { Dependencies } from '../di/types';
import { DataSourceProvider } from './DataSourceProvider';
import { createQueryClient } from './queryClient';

interface AppProvidersProps {
  children: ReactNode;
  /** Injected in tests; the real HTTP-backed repositories otherwise. */
  dependencies?: Dependencies;
  queryClient?: QueryClient;
  lang?: Lang;
}

export function AppProviders({ children, dependencies, queryClient, lang }: AppProvidersProps) {
  const [live] = useState(() => dependencies ?? createDependencies());
  const [client] = useState(() => queryClient ?? createQueryClient());
  return (
    <QueryClientProvider client={client}>
      <DataSourceProvider live={live}>
        <I18nProvider defaultLang={lang}>
          <ToastProvider>
            <AuthProvider>{children}</AuthProvider>
          </ToastProvider>
        </I18nProvider>
      </DataSourceProvider>
    </QueryClientProvider>
  );
}
