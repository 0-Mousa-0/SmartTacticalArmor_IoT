import { useI18n } from '@/core/i18n/useI18n';
import { TimeSeriesChart } from '@/shared/charts/TimeSeriesChart';
import { EmptyState, Skeleton } from '@/shared/ui';
import { useTelemetryHistory } from '../../application/hooks';
import s from '../unitsPage.module.css';

export function TrendCharts({
  unitId,
  minutes,
  zThreshold = 3,
  vitalsSimulated = false,
}: {
  unitId: string;
  minutes: number;
  zThreshold?: number;
  vitalsSimulated?: boolean;
}) {
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
    hr: p.heartRate,
    spo2: p.spo2,
  }));
  const hasVitals = data.some((p) => p.heartRate !== null || p.spo2 !== null);

  return (
    <div className={s.charts}>
      {hasVitals && (
        <div className={s.chartWide}>
          <p className={s.chartTitle}>
            {t('unit.vitalsChart')}
            {vitalsSimulated && ` · ${t('sensors.simulated')}`}
          </p>
          <TimeSeriesChart
            data={points}
            height={200}
            series={[
              { key: 'hr', label: t('sensors.heartRate'), color: 'var(--chart-5)' },
              { key: 'spo2', label: t('sensors.spo2'), color: 'var(--chart-3)' },
            ]}
            decimals={0}
          />
        </div>
      )}
      <div>
        <p className={s.chartTitle}>{t('unit.temperatureChart')}</p>
        <TimeSeriesChart
          data={points}
          series={[{ key: 'temp', label: t('sensors.vestTemp'), color: 'var(--chart-2)' }]}
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
            { key: 'activity', label: t('unit.activity'), color: 'var(--chart-1)' },
            { key: 'peak', label: t('unit.peak'), color: 'var(--chart-3)', dashed: true },
          ]}
        />
      </div>
      <div className={s.chartWide}>
        <p className={s.chartTitle}>{t('unit.anomalyChart')}</p>
        <TimeSeriesChart
          data={points}
          height={170}
          series={[{ key: 'anomaly', label: '|z|', color: 'var(--chart-4)' }]}
          domain={[0, 'auto']}
          decimals={1}
          threshold={{ value: zThreshold, label: `z = ${zThreshold}`, color: 'var(--chart-5)' }}
        />
      </div>
    </div>
  );
}
