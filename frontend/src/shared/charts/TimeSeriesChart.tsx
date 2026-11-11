import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useI18n } from '@/core/i18n/useI18n';

export interface Series {
  key: string;
  label: string;
  color: string;
  dashed?: boolean;
}

interface TimeSeriesChartProps {
  data: Record<string, unknown>[];
  series: Series[];
  height?: number;
  unit?: string;
  /** Recharts domain, e.g. ['auto','auto'] or ['dataMin - 0.5', 'dataMax + 0.5'] */
  domain?: [number | string, number | string];
  decimals?: number;
  threshold?: { value: number; label: string; color: string };
}

/** Line chart over time. Rendered LTR even in Arabic: time flows left to right. */
export function TimeSeriesChart({ data, series, height = 220, unit, domain = ['auto', 'auto'], decimals = 2, threshold }: TimeSeriesChartProps) {
  const { fmt } = useI18n();
  return (
    <div dir="ltr" style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 4" vertical={false} />
          <XAxis
            dataKey="t"
            tickFormatter={(value: string) => fmt.time(value).slice(0, 5)}
            stroke="var(--text-faint)"
            fontSize={11}
            minTickGap={36}
          />
          <YAxis
            stroke="var(--text-faint)"
            fontSize={11}
            domain={domain}
            width={58}
            tickFormatter={(value: number) => `${value.toFixed(decimals)}${unit ?? ''}`}
            allowDecimals
          />
          <Tooltip
            contentStyle={{ background: 'var(--surface-2)', border: '1px solid var(--border-strong)', borderRadius: 8, color: 'var(--text)' }}
            labelFormatter={(value: string) => fmt.time(value)}
            formatter={(value: number, name: string) => [`${typeof value === 'number' ? value.toFixed(2) : value}${unit ?? ''}`, name]}
          />
          <Legend wrapperStyle={{ fontSize: 12, color: 'var(--text-muted)' }} />
          {threshold && (
            <ReferenceLine y={threshold.value} stroke={threshold.color} strokeDasharray="4 4" label={{ value: threshold.label, fill: threshold.color, fontSize: 11, position: 'insideTopRight' }} />
          )}
          {series.map((item) => (
            <Line
              key={item.key}
              type="monotone"
              dataKey={item.key}
              name={item.label}
              stroke={item.color}
              strokeWidth={2}
              strokeDasharray={item.dashed ? '5 4' : undefined}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
