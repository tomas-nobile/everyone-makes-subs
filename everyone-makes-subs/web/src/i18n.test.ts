import { describe, expect, it } from 'vitest';
import { isOriginalLang } from './i18n';

describe('isOriginalLang', () => {
  it('never treats Spanish as the original when the talk language is unknown (an English talk must show the translation)', () => {
    expect(isOriginalLang('es', undefined)).toBe(false);
    expect(isOriginalLang('es', 'en')).toBe(false);
    expect(isOriginalLang('en', 'en')).toBe(true);
  });
});
