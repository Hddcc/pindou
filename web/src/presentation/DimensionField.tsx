import {Minus, Plus} from 'lucide-react';

export function DimensionField({name, label, value, onChange}: {name: string; label: string; value: string; onChange: (value: string) => void}) {
  const size = Number(value), change = (delta: number) => onChange(String(Math.max(1, Math.min(200, size + delta))));
  return <div className="field dimension-field"><label htmlFor={`dimension-${name}`}>{label}（格）</label><div className="dimension-stepper">
    <button type="button" title={`减少${label}`} aria-label={`减少${label}`} disabled={size <= 1} onClick={() => change(-1)}><Minus size={18}/></button>
    <input id={`dimension-${name}`} aria-label={`${label}（格）`} name={name} type="number" inputMode="numeric" min={1} max={200} step={1} value={value} onChange={event => onChange(event.target.value)} required/>
    <button type="button" title={`增加${label}`} aria-label={`增加${label}`} disabled={size >= 200} onClick={() => change(1)}><Plus size={18}/></button>
  </div></div>;
}
