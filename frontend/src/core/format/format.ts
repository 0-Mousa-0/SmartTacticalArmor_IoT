import type { Lang } from '@/core/i18n/types';
import { env } from '@/core/config/env';

/** Gregorian calendar + Latin digits in Arabic too: data stays easy to scan. */
export const localeFor = (lang: Lang): string => (lang === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-GB');

export interface Formatters {
  number(value: number | null | undefined, digits?: number): string;
  time(iso: string | null | undefined): string;
  dateTime(iso: string | null | undefined): string;
  relative(iso: string | null | undefined): string;
  duration(seconds: number | null | undefined): string;
}

const DASH = '—';

export function makeFormatters(lang: Lang): Formatters {
  const locale = localeFor(lang);
  const timeFmt = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: env.timeZone,
  });
  const dateTimeFmt = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    hour12: false,
    timeZone: env.timeZone,
  });
  const relativeFmt = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });
  const numberFmts = new Map<number, Intl.NumberFormat>();

  const number = (value: number | null | undefined, digits = 0): string => {
    if (value === null || value === undefined || Number.isNaN(value)) return DASH;
    if (!numberFmts.has(digits)) {
      numberFmts.set(digits, new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }));
    }
    return numberFmts.get(digits)!.format(value);
  };

  return {
    number,
    time: (iso) => (iso ? timeFmt.format(new Date(iso)) : DASH),
    dateTime: (iso) => (iso ? dateTimeFmt.format(new Date(iso)) : DASH),
    relative: (iso) => {
      if (!iso) return DASH;
      const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
      const abs = Math.abs(seconds);
      if (abs < 60) return relativeFmt.format(seconds, 'second');
      if (abs < 3600) return relativeFmt.format(Math.round(seconds / 60), 'minute');
      if (abs < 86400) return relativeFmt.format(Math.round(seconds / 3600), 'hour');
      return relativeFmt.format(Math.round(seconds / 86400), 'day');
    },
    duration: (seconds) => {
      if (seconds === null || seconds === undefined) return DASH;
      const s = Math.max(0, Math.round(seconds));
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const rest = s % 60;
      const pad = (n: number) => String(n).padStart(2, '0');
      return h > 0 ? `${h}:${pad(m)}:${pad(rest)}` : `${m}:${pad(rest)}`;
    },
  };
}
