import { useDataSource, type DataSourceMode } from '@/app/di/dataSource';
import { useI18n } from '@/core/i18n/useI18n';
import { Card, SegmentedControl } from '@/shared/ui';

/** Settings: choose between the real vests and the simulation. */
export function DataSourceCard() {
  const { t } = useI18n();
  const { mode, setMode } = useDataSource();
  return (
    <Card title={t('demo.sourceTitle')} subtitle={t('demo.sourceHint')}>
      <SegmentedControl<DataSourceMode>
        label={t('demo.sourceTitle')}
        value={mode}
        onChange={setMode}
        options={[
          { value: 'live', label: t('demo.modeLive') },
          { value: 'demo', label: t('demo.modeDemo') },
        ]}
      />
    </Card>
  );
}
