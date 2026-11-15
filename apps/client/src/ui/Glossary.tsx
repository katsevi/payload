/**
 * Glosario OPCIONAL (fase 4, regla 6 revisada): una línea por término. Se abre y se cierra con G o «?» o con su botón,
 * en el hangar y en el mapa del sistema solar. Nunca se abre solo ni bloquea: es un panel lateral, no un modal.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, X } from 'lucide-react';
import { GLOSSARY_TERMS, isGlossaryKey } from '../game/glossary';

/** Estado del glosario con su tecla (G o «?»). */
export function useGlossary(): [boolean, (v: boolean | ((o: boolean) => boolean)) => void] {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (isGlossaryKey(e)) setOpen((o) => !o);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  return [open, setOpen];
}

export function GlossaryButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  return (
    <button className="num flex shrink-0 items-center gap-1 whitespace-nowrap text-[11px] text-slate-400 hover:text-accent" onClick={onToggle} aria-pressed={open} aria-controls="glossary-panel">
      <BookOpen size={13} aria-hidden="true" /> {t('glossary.hint')}
    </button>
  );
}

export function GlossaryPanel({ onClose, className = '' }: { onClose: () => void; className?: string }) {
  const { t } = useTranslation();
  return (
    <section id="glossary-panel" className={`console-panel flex max-h-[70vh] w-80 flex-col gap-2 overflow-auto p-3 ${className}`} aria-label={t('glossary.title')}>
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2"><span className="panel-code" aria-hidden="true">GLS</span><span className="panel-title !text-xs">{t('glossary.title')}</span></h2>
        <button className="text-slate-400 hover:text-accent" onClick={onClose} aria-label={t('common.close')}>
          <X size={15} />
        </button>
      </div>
      <dl className="flex flex-col gap-1.5 text-xs">
        {GLOSSARY_TERMS.map((id) => (
          <div key={id} className="border-l border-line pl-2">
            <dt className="num font-semibold text-accent">{t(`glossary.${id}.term`)}</dt>
            <dd className="text-slate-400">{t(`glossary.${id}.line`)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
