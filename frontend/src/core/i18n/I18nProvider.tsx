import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { makeFormatters } from '@/core/format/format';
import { I18nContext, type I18nValue } from './context';
import { translate, translateDynamic } from './translate';
import type { Lang } from './types';

const STORAGE_KEY = 'sta.lang';

function initialLang(): Lang {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'ar' || stored === 'en') return stored;
  } catch {
    /* storage unavailable */
  }
  return 'ar';
}

/** Arabic (RTL) by default; the choice is remembered per browser. */
export function I18nProvider({ children, defaultLang }: { children: ReactNode; defaultLang?: Lang }) {
  const [lang, setLangState] = useState<Lang>(() => defaultLang ?? initialLang());
  const dir = lang === 'ar' ? 'rtl' : 'ltr';

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
    document.title = lang === 'ar' ? 'درع | القيادة والسيطرة' : 'Dera | Command & Control';
  }, [lang, dir]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage unavailable */
    }
  }, []);

  const value = useMemo<I18nValue>(
    () => ({
      lang,
      dir,
      setLang,
      toggleLang: () => setLang(lang === 'ar' ? 'en' : 'ar'),
      t: (key, vars) => translate(lang, key, vars),
      tx: (path, fallback, vars) => translateDynamic(lang, path, fallback, vars),
      fmt: makeFormatters(lang),
    }),
    [lang, dir, setLang],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
