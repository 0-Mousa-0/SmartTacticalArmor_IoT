import { useI18n } from '@/core/i18n/useI18n';
import { Button, EmptyState } from './primitives';
import { useErrorMessage } from './useErrorMessage';

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useI18n();
  const message = useErrorMessage()(error);
  return (
    <EmptyState
      icon="alert"
      title={message}
      action={
        onRetry ? (
          <Button icon="refresh" onClick={onRetry}>
            {t('common.retry')}
          </Button>
        ) : undefined
      }
    />
  );
}
