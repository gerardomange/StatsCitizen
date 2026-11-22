import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { es } from './es.js';

/**
 * Lightweight gettext-style i18n: the English source text is the key.
 *   t('Pilot vitals')            -> "Signos vitales" in Spanish
 *   t('{n} sorties', { n: 4 })   -> "4 salidas"
 * Missing Spanish entries fall back to English, so nothing ever renders blank.
 */
export type Lang = 'en' | 'es';
export type Vars = Record<string, string | number>;
export type TFn = (text: string, vars?: Vars) => string;

const LANG_KEY = 'statscitizen.lang';
const DICTS: Record<Lang, Record<string, string>> = { en: {}, es };

function interpolate(text: string, vars?: Vars) {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

export function translate(lang: Lang, text: string, vars?: Vars) {
  return interpolate(DICTS[lang][text] ?? text, vars);
}

function readLang(): Lang {
  try {
    const v = localStorage.getItem(LANG_KEY);
    if (v === 'en' || v === 'es') return v;
  } catch {
    /* storage unavailable */
  }
  return 'en';
}

interface I18nValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: TFn;
  /** Locale for numbers/dates. */
  locale: string;
}

const I18nCtx = createContext<I18nValue>({
  lang: 'en',
  setLang: () => undefined,
  t: (text, vars) => interpolate(text, vars),
  locale: 'en-US',
});

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLangState] = useState<Lang>(readLang);

  useEffect(() => {
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch {
      /* storage unavailable */
    }
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((l: Lang) => setLangState(l), []);
  const t = useCallback<TFn>((text, vars) => translate(lang, text, vars), [lang]);
  const value = useMemo(() => ({ lang, setLang, t, locale: lang === 'es' ? 'es-MX' : 'en-US' }), [lang, setLang, t]);
  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>;
};

export const useI18n = () => useContext(I18nCtx);
export const useT = () => useContext(I18nCtx).t;
