import { describe, expect, it } from 'vitest';
import { ar } from './dictionaries/ar';
import { en } from './dictionaries/en';
import { translate, translateDynamic } from './translate';

function leaves(node: unknown, prefix = ''): Record<string, string> {
  if (typeof node === 'string') return { [prefix]: node };
  return Object.entries(node as Record<string, unknown>).reduce<Record<string, string>>(
    (acc, [key, value]) => ({ ...acc, ...leaves(value, prefix ? `${prefix}.${key}` : key) }),
    {},
  );
}

describe('i18n', () => {
  it('Arabic and English dictionaries have exactly the same keys, none empty', () => {
    const arLeaves = leaves(ar);
    const enLeaves = leaves(en);
    expect(Object.keys(arLeaves).sort()).toEqual(Object.keys(enLeaves).sort());
    expect(Object.entries(arLeaves).filter(([, text]) => !text.trim())).toEqual([]);
  });

  it('keeps the same placeholders in both languages', () => {
    const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort().join(',');
    const arLeaves = leaves(ar);
    const mismatched = Object.entries(leaves(en)).filter(([key, text]) => placeholders(text) !== placeholders(arLeaves[key]));
    expect(mismatched).toEqual([]);
  });

  it('interpolates variables', () => {
    expect(translate('en', 'commands.sent', { unit: 'ALPHA-01' })).toBe('Command sent to ALPHA-01');
    expect(translate('ar', 'shell.critical', { n: 2 })).toBe('2 حرجة');
  });

  it('falls back for unknown dynamic keys', () => {
    expect(translateDynamic('en', 'alertTypes.SOS')).toBe('SOS distress call');
    expect(translateDynamic('ar', 'alertTypes.NEW_TYPE', 'NEW_TYPE')).toBe('NEW_TYPE');
  });
});
