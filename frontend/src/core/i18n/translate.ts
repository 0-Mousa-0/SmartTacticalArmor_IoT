import { ar } from './dictionaries/ar';
import { en } from './dictionaries/en';
import type { Dictionary, Lang, TranslationKey, TranslationVars } from './types';

export const dictionaries: Record<Lang, Dictionary> = { ar, en };

function lookup(dictionary: Dictionary, path: string): string | undefined {
  let node: unknown = dictionary;
  for (const part of path.split('.')) {
    if (node && typeof node === 'object' && part in node) {
      node = (node as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return typeof node === 'string' ? node : undefined;
}

function interpolate(template: string, vars?: TranslationVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

/** Typed lookup: unknown keys are a compile error. */
export function translate(lang: Lang, key: TranslationKey, vars?: TranslationVars): string {
  return interpolate(lookup(dictionaries[lang], key) ?? lookup(en, key) ?? key, vars);
}

/** Lookup for keys built at runtime (alert types, metrics…), with a fallback. */
export function translateDynamic(lang: Lang, path: string, fallback?: string, vars?: TranslationVars): string {
  return interpolate(lookup(dictionaries[lang], path) ?? lookup(en, path) ?? fallback ?? path, vars);
}
