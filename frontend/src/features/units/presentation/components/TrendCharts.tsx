import { useI18n } from '@/core/i18n/useI18n';
import { TimeSeriesChart } from '@/shared/charts/TimeSeriesChart';
import { EmptyState, Skeleton } from '@/shared/ui';
import { useTelemetryHistory } from '../../application/hooks';
import s from '../unitsPage.module.css';

export function TrendCharts({ unitId, minutes, zThreshold = 3 }: { unitId: string; minutes: number; zThreshold?: number }) {
  const { t } = useI18n();
  const { data, isLoading } = useTelemetryHistory(unitId, minutes);
  if (isLoading) return <Skeleton height={240} />;
  if (!data || data.length === 0) return <EmptyState icon="activity" title={t('common.noData')} />;

  const points = data.map((p) => ({
    t: p.t,
    temp: p.vestTempC,
    activity: p.activityG,
    peak: p.peakG,
    anomaly: p.anomalyScore,
  }));

  return (
    <div className={s.charts}>
      <div>
        <p className={s.chartTitle}>{t('unit.temperatureChart')}</p>
        <TimeSeriesChart
          data={points}
          series={[{ key: 'temp', label: t('sensors.vestTemp'), color: '#ff9f43' }]}
          unit="°"
          decimals={1}
          domain={['dataMin - 0.5', 'dataMax + 0.5']}
        />
      </div>
      <div>
        <p className={s.chartTitle}>{t('unit.motionChart')}</p>
        <TimeSeriesChart
          data={points}
          series={[
            { key: 'activity', label: t('unit.activity'), color: '#35d0ba' },
            { key: 'peak', label: t('unit.peak'), color: '#5aa9ff', dashed: true },
          ]}
        />
      </div>
      <div className={s.chartWide}>
        <p className={s.chartTitle}>{t('unit.anomalyChart')}</p>
        <TimeSeriesChart
          data={points}
          height={170}
          series={[{ key: 'anomaly', label: '|z|', color: '#a78bfa' }]}
          domain={[0, 'auto']}
          decimals={1}
          threshold={{ value: zThreshold, label: `z = ${zThreshold}`, color: '#ff5c6c' }}
        />
      </div>
    </div>
  );
}
