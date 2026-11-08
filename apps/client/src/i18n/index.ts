import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import { simLocales, DEFAULT_LOCALE, LOCALES, type Locale, type MessageRef, type LocalizedText } from '@payload/shared';
import es from '../locales/es.json';
import en from '../locales/en.json';
import { flatten } from './flatten';

export const LANG_STORAGE_KEY = 'payload.lang';

// Los recursos se aplanan a claves con puntos y se desactivan los separadores:
// así `t('hangar.title')` y las claves `MessageRef` del motor funcionan igual, anidadas o planas.
export const resources = {
  es: { ui: flatten(es), sim: flatten(simLocales.es) },
  en: { ui: flatten(en), sim: flatten(simLocales.en) },
};

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: DEFAULT_LOCALE,
    supportedLngs: [...LOCALES],
    ns: ['ui', 'sim'],
    defaultNS: 'ui',
    keySeparator: false,
    nsSeparator: false,
    interpolation: { escapeValue: false },
    // Español por defecto: solo se consulta lo recordado por el usuario (no el idioma del navegador).
    detection: { order: ['localStorage'], caches: ['localStorage'], lookupLocalStorage: LANG_STORAGE_KEY },
    react: { useSuspense: false },
  });

export function currentLocale(): Locale {
  const l = (i18n.resolvedLanguage ?? i18n.language ?? DEFAULT_LOCALE).slice(0, 2);
  return (LOCALES as readonly string[]).includes(l) ? (l as Locale) : DEFAULT_LOCALE;
}

export function setLocale(l: Locale): void {
  void i18n.changeLanguage(l);
  try {
    localStorage.setItem(LANG_STORAGE_KEY, l);
  } catch {
    /* almacenamiento no disponible */
  }
}

/** Traduce un MessageRef del motor (namespace `sim`). */
export function tr(msg: MessageRef | undefined): string {
  if (!msg) return '';
  return i18n.t(msg.key, { ns: 'sim', ...(msg.params ?? {}) }) as string;
}

/** Unidad de un recurso del motor (código estable → texto traducido, ns `sim`). */
export function tu(code: string): string {
  return i18n.t(`unit.${code}`, { ns: 'sim', defaultValue: code }) as string;
}

/** Texto de contenido del catálogo en el idioma actual. */
export function lt(text: LocalizedText | undefined): string {
  return text ? (text[currentLocale()] ?? text[DEFAULT_LOCALE]) : '';
}

export default i18n;
