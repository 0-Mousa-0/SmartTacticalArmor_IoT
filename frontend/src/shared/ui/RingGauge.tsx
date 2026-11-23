/** Thin circular gauge (value out of max), as used on the overview KPI tiles. */
export function RingGauge({ value, max, color, size = 58, label }: { value: number; max: number; color: string; size?: number; label: string }) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const stroke = 5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const centre = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} style={{ flex: 'none' }}>
      <circle cx={centre} cy={centre} r={radius} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
      {ratio > 0 && (
        <circle
          cx={centre}
          cy={centre}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${circumference * ratio} ${circumference}`}
          transform={`rotate(-90 ${centre} ${centre})`}
          style={{ transition: 'stroke-dasharray 0.5s' }}
        />
      )}
    </svg>
  );
}
