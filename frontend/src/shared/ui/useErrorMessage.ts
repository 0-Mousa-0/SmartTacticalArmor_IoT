import { ApiError } from '@/core/http/ApiError';
import { useI18n } from '@/core/i18n/useI18n';

/** Turns any thrown value into a message the operator can act on. */
export function useErrorMessage(): (error: unknown) => string {
  const { t } = useI18n();
  return (error: unknown) => {
    if (error instanceof ApiError) {
      if (error.isNetwork) return error.message === 'timeout' ? t('errors.timeout') : t('errors.network');
      if (error.isForbidden) return t('errors.forbidden');
      if (error.status === 404) return error.message || t('errors.notFound');
      return error.message || t('errors.generic');
    }
    return t('errors.generic');
  };
}
