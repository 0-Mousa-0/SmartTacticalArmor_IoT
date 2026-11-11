import { createContext } from 'react';
import type { Formatters } from '@/core/format/format';
import type { Lang, TranslationKey, TranslationVars } from './types';

export interface I18nValue {
  lang: Lang;
  dir: 'rtl' | 'ltr';
  setLang: (lang: Lang) => void;
  toggleLang: () => void;
  t: (key: TranslationKey, vars?: TranslationVars) => string;
  tx: (path: string, fallback?: string, vars?: TranslationVars) => string;
  fmt: Formatters;
}

export const I18nContext = createContext<I18nValue | null>(null);
