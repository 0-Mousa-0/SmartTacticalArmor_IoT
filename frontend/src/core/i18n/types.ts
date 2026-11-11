import type { en } from './dictionaries/en';

export type Lang = 'ar' | 'en';

/** Same shape as the English dictionary, but any string values. */
export type Dictionary = DeepStringify<typeof en>;

type DeepStringify<T> = { [K in keyof T]: T[K] extends string ? string : DeepStringify<T[K]> };

/** Every dot-path that ends in a string, e.g. "nav.overview". */
type Leaves<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : Leaves<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

export type TranslationKey = Leaves<typeof en>;
export type TranslationVars = Record<string, string | number>;
