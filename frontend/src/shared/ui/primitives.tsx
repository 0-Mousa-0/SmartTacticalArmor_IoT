import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { cx } from './cx';
import s from './ui.module.css';

/* ── Button ─────────────────────────────────────────────── */
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  icon?: IconName;
  loading?: boolean;
}

export function Button({ variant = 'secondary', size = 'md', icon, loading, children, className, disabled, type, ...rest }: ButtonProps) {
  return (
    <button
      type={type ?? 'button'}
      className={cx(s.button, variant !== 'secondary' && s[variant], size === 'sm' && s.sm, className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <span className={s.spin} aria-hidden="true" /> : icon ? <Icon name={icon} size={size === 'sm' ? 15 : 17} /> : null}
      {children}
    </button>
  );
}

/* ── Card ───────────────────────────────────────────────── */
interface CardProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  className?: string;
}

export function Card({ title, subtitle, actions, children, flush, className }: CardProps) {
  return (
    <section className={cx(s.card, className)}>
      {(title || actions) && (
        <header className={s.cardHeader}>
          <div>
            {title && <h2 className={s.cardTitle}>{title}</h2>}
            {subtitle && <p className={s.cardSubtitle}>{subtitle}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className={flush ? s.cardBodyFlush : s.cardBody}>{children}</div>
    </section>
  );
}

/* ── Badge ──────────────────────────────────────────────── */
export type Tone = 'neutral' | 'accent' | 'info' | 'warning' | 'critical' | 'success' | 'ai';

export function Badge({ tone = 'neutral', dot, pulse, children, title }: { tone?: Tone; dot?: boolean; pulse?: boolean; children: ReactNode; title?: string }) {
  return (
    <span className={cx(s.badge, s[tone], pulse && s.pulse)} title={title}>
      {dot && <span className={s.dot} aria-hidden="true" />}
      {children}
    </span>
  );
}

/* ── Stat tile ──────────────────────────────────────────── */
export function StatTile({ label, value, hint, icon, color }: { label: string; value: ReactNode; hint?: ReactNode; icon?: IconName; color?: string }) {
  return (
    <div className={cx(s.card, s.stat)}>
      <span className={s.statLabel}>
        {icon && <Icon name={icon} size={16} />}
        {label}
      </span>
      <span className={s.statValue} style={color ? { color } : undefined}>
        {value}
      </span>
      {hint && <span className={s.statHint}>{hint}</span>}
    </div>
  );
}

/* ── Page header ────────────────────────────────────────── */
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className={s.pageHeader}>
      <div>
        <h1 className={s.pageTitle}>{title}</h1>
        {subtitle && <p className={s.pageSubtitle}>{subtitle}</p>}
      </div>
      {actions && <div className={s.pageActions}>{actions}</div>}
    </div>
  );
}

/* ── Empty / loading states ─────────────────────────────── */
export function EmptyState({ icon = 'check', title, hint, action }: { icon?: IconName; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className={s.state}>
      <Icon name={icon} size={28} className={s.stateIcon} />
      <p className={s.stateTitle}>{title}</p>
      {hint && <p>{hint}</p>}
      {action}
    </div>
  );
}

export function Skeleton({ height = 120 }: { height?: number }) {
  return <div className={s.skeleton} style={{ height }} aria-hidden="true" />;
}

/* ── Segmented control (tabs) ───────────────────────────── */
export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  count?: number;
}

export function SegmentedControl<T extends string>({ options, value, onChange, label }: { options: SegmentOption<T>[]; value: T; onChange: (value: T) => void; label: string }) {
  return (
    <div className={s.segmented} role="tablist" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          className={cx(s.segment, option.value === value && s.segmentActive)}
          onClick={() => onChange(option.value)}
        >
          {option.label}
          {option.count !== undefined && <span className={s.count}>{option.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* ── Risk meter ─────────────────────────────────────────── */
export function Meter({ value, color, label }: { value: number; color: string; label: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className={s.meter} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={clamped} aria-label={label}>
      <div className={s.meterFill} style={{ width: `${clamped}%`, background: color }} />
    </div>
  );
}

