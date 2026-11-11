import { Link, useNavigate } from 'react-router-dom';
import { useI18n } from '@/core/i18n/useI18n';
import { AlertItem } from '@/features/alerts/presentation/components/AlertItem';
import { Badge, Card, ConnectionPill, EmptyState, ErrorState, Icon, PageHeader, RiskBadge, RiskMeter, Skeleton, type IconName, uiStyles } from '@/shared/ui';
import { useAnalysis } from '../application/useAnalysis';
import s from './analysis.module.css';

const STEPS: { icon: IconName; title: 'analysis.step1Title' | 'analysis.step2Title' | 'analysis.step3Title' | 'analysis.step4Title'; body: 'analysis.step1' | 'analysis.step2' | 'analysis.step3' | 'analysis.step4' }[] = [
  { icon: 'wifi', title: 'analysis.step1Title', body: 'analysis.step1' },
  { icon: 'activity', title: 'analysis.step2Title', body: 'analysis.step2' },
  { icon: 'target', title: 'analysis.step3Title', body: 'analysis.step3' },
  { icon: 'brain', title: 'analysis.step4Title', body: 'analysis.step4' },
];

export default function AnalysisPage() {
  const { t, tx, fmt } = useI18n();
  const navigate = useNavigate();
  const { data, isLoading, error, refetch } = useAnalysis();

  if (isLoading) return <Skeleton height={520} />;
  if (error || !data) return <ErrorState error={error} onRetry={() => void refetch()} />;
  const model = data.model;

  return (
    <>
      <PageHeader title={t('analysis.title')} subtitle={t('analysis.subtitle')} actions={<Badge tone="ai">{t('analysis.disclaimer')}</Badge>} />

      <Card title={t('analysis.pipeline')}>
        <ol className={s.pipeline}>
          {STEPS.map((step, index) => (
            <li key={step.title}>
              <span className={s.stepIcon}>
                <Icon name={step.icon} size={20} />
              </span>
              <span className={s.stepNo}>{index + 1}</span>
              <strong>{t(step.title)}</strong>
              <p>{t(step.body, { n: model.persistReadings, z: model.zThreshold })}</p>
            </li>
          ))}
        </ol>
      </Card>

      <div className={s.grid}>
        <Card title={t('analysis.ranking')} flush>
          {data.units.length === 0 ? (
            <EmptyState title={t('common.noData')} />
          ) : (
            <ul className={s.ranking}>
              {data.units.map((unit) => (
                <li key={unit.deviceId}>
                  <Link to={`/units/${unit.deviceId}`} className={s.rankRow}>
                    <span className={s.rankName}>
                      <strong>{unit.callsign ?? unit.deviceCode}</strong>
                      <span className="muted ltr">{unit.deviceCode}</span>
                    </span>
                    <span className={s.rankMeter}>
                      <RiskMeter level={unit.risk.level} score={unit.risk.score} />
                    </span>
                    <RiskBadge level={unit.risk.level} score={unit.risk.score} />
                    <ConnectionPill state={unit.connection} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={t('analysis.modelCard')}>
          <dl className={uiStyles.kv}>
            <dt>{t('analysis.threshold')}</dt>
            <dd className="num">{model.zThreshold}σ</dd>
            <dt>{t('analysis.warmup')}</dt>
            <dd className="num">{model.warmupSamples}</dd>
            <dt>{t('analysis.alpha')}</dt>
            <dd className="num">{model.alpha}</dd>
            <dt>{t('analysis.persist')}</dt>
            <dd className="num">{model.persistReadings}</dd>
          </dl>
          <p className={s.method}>{t('analysis.method')}</p>
          <div className={s.metricChips}>
            {model.metrics.map((metric) => (
              <Badge key={metric.metric} tone="ai" title={`${metric.direction} · min σ ${metric.minStd}`}>
                {tx(`metrics.${metric.metric}`, metric.metric)} {metric.direction === 'up' ? '↑' : metric.direction === 'down' ? '↓' : '↕'}
              </Badge>
            ))}
          </div>
        </Card>
      </div>

      <Card title={t('analysis.baselines')} flush>
        <div className={uiStyles.tableWrap}>
          <table className={uiStyles.table}>
            <thead>
              <tr>
                <th>{t('unit.wearer')}</th>
                <th>{t('analysis.metric')}</th>
                <th>{t('analysis.mean')}</th>
                <th>{t('analysis.std')}</th>
                <th>{t('analysis.samples')}</th>
                <th>{t('analysis.lastZ')}</th>
              </tr>
            </thead>
            <tbody>
              {data.units.flatMap((unit) =>
                unit.baselines.map((baseline) => {
                  const hot = baseline.lastZ !== null && Math.abs(baseline.lastZ) > model.zThreshold;
                  return (
                    <tr key={`${unit.deviceId}-${baseline.metric}`}>
                      <td>{unit.callsign ?? unit.deviceCode}</td>
                      <td>{tx(`metrics.${baseline.metric}`, baseline.metric)}</td>
                      <td className="num">{fmt.number(baseline.mean, 2)}</td>
                      <td className="num">{fmt.number(baseline.std, 3)}</td>
                      <td className="num">
                        {fmt.number(baseline.samples)} {baseline.samples < model.warmupSamples && <Badge>{t('analysis.learning')}</Badge>}
                      </td>
                      <td className="num" style={{ color: hot ? 'var(--critical)' : undefined, fontWeight: hot ? 700 : undefined }}>
                        {fmt.number(baseline.lastZ, 2)}
                      </td>
                    </tr>
                  );
                }),
              )}
            </tbody>
          </table>
          {data.units.every((unit) => unit.baselines.length === 0) && <EmptyState icon="activity" title={t('common.noData')} />}
        </div>
      </Card>

      <div style={{ height: 'var(--gap)' }} />

      <Card title={t('analysis.findings')} flush>
        {data.findings.length === 0 ? (
          <EmptyState icon="brain" title={t('analysis.noFindings')} />
        ) : (
          data.findings.map((alert) => <AlertItem key={alert.id} alert={alert} onSelect={() => navigate(`/alerts?focus=${alert.id}`)} />)
        )}
      </Card>
    </>
  );
}
