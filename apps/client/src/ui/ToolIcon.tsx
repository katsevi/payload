import { Drill, Sun, Wrench } from 'lucide-react';

/** Icono propio de cada herramienta desplegable (forma distinta, no solo color). */
export function ToolIcon({ toolId, size = 16 }: { toolId: string; size?: number }) {
  if (toolId === 'solar-concentrator') return <Sun size={size} aria-hidden="true" />;
  if (toolId === 'laser-drill') return <Drill size={size} aria-hidden="true" />;
  return <Wrench size={size} aria-hidden="true" />;
}
