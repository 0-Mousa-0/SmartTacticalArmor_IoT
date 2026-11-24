import { Area, AreaChart, ResponsiveContainer, Tooltip, YAxis } from 'recharts';
import { useI18n } from '@/core/i18n/useI18n';
import { useTelemetryHistory } from '@/features/units/application/hooks';
import s from '../overview.module.css';

const MINUTES = 15;

/** Small trend under the readings: heart rate when the vest measures it, else vest temperature. */
export function TrendSpark({ unitId, simulated = false }: { unitId: string; simulated?: boolean }) {
  const { t, fmt } = useI18n();
  const { data } = useTelemetryHistory(unitId, MINUTES);
  const points = data ?? [];
  const hasHeart = points.some((p) => p.heartRate !== null);
  const values = points
    .map((p) => ({ t: p.t, v: hasHeart ? p.heartRate : p.vestTempC }))
    .filter((p): p is { t: string; v: number } => p.v !== null);
  if (values.length < 2) return null;

  const numbers = values.map((p) => p.v);
  const min = Math.min(...numbers);
  const max = Math.max(...numbers);
  const digits = hasHeart ? 0 : 1;
  const unit = hasHeart ? ' bpm' : ' °C';
  const color = hasHeart ? 'var(--critical)' : 'var(--chart-2)';
  const gradient = `spark-${unitId}`;

  return (
    <div className={s.trend}>
      <div className={s.trendHead}>
        <span>
          {hasHeart ? t('overview.trendHeart') : t('overview.trendTemp')}
          {hasHeart && simulated && ` · ${t('sensors.simulated')}`}
        </span>
        <span className={`${s.trendRange} ltr`}>
          {fmt.number(min, digits)} – {fmt.number(max, digits)}
        </span>
      </div>
      <div dir="ltr" style={{ width: '100%', height: 64 }}>
        <ResponsiveContainer>
          <AreaChart data={values} margin={{ top: 6, right: 0, bottom: 2, left: 0 }}>
            <defs>
              <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <YAxis hide domain={['dataMin - 1', 'dataMax + 1']} />
            <Tooltip
              contentStyle={{ background: 'var(--surface-2)', border: '1px solid var(--border-strong)', borderRadius: 12, color: 'var(--text)', fontSize: 12 }}
              labelFormatter={(_, payload) => (payload?.[0] ? fmt.time(String(payload[0].payload.t)) : '')}
              formatter={(value: number) => [`${value.toFixed(digits)}${unit}`, '']}
              separator=""
            />
            <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.6} fill={`url(#${gradient})`} isAnimationActive={false} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
