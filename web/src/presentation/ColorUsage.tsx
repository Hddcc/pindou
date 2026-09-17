import {useState} from 'react';
import {Check} from 'lucide-react';
import {type ColorStatistic} from '../domain/editor';

export function ColorUsage({items, selected, beadMode, onSelect}: {items: ColorStatistic[]; selected: string | null; beadMode: boolean; onSelect: (code: string | null) => void}) {
  const [sort, setSort] = useState<'quantity' | 'code'>('quantity');
  const sorted = sort === 'quantity' ? items : [...items].sort((a, b) => a.label.localeCompare(b.label, 'en', {numeric: true}));
  return <div className="color-usage">
    <div className="usage-total" data-testid="usage-total"><strong>{items.length} 色</strong><span>{items.reduce((total, item) => total + item.count, 0).toLocaleString()} 颗拼豆</span></div>
    <div className="segmented usage-sort" aria-label="用色统计排序"><button className={sort === 'quantity' ? 'selected' : ''} aria-pressed={sort === 'quantity'} onClick={() => setSort('quantity')}>数量</button><button className={sort === 'code' ? 'selected' : ''} aria-pressed={sort === 'code'} onClick={() => setSort('code')}>色号</button></div>
    {beadMode && <button className={`usage-all ${selected === null ? 'selected' : ''}`} aria-pressed={selected === null} onClick={() => onSelect(null)}>全部颜色{selected === null && <Check size={16}/>}</button>}
    <div className="usage-list">{sorted.map(item => <button key={item.code} className={`usage-row ${selected === item.code ? 'selected' : ''}`} aria-label={`已用颜色 ${item.label}，${item.count} 颗`} aria-pressed={selected === item.code} onClick={() => onSelect(item.code)}>
      <span className="usage-swatch" style={{background: item.hex}}/><span className="usage-code"><strong>{item.label}</strong><small>{item.hex}</small></span><span className="usage-count">{item.count.toLocaleString()} 颗</span><span className="usage-check">{selected === item.code && <Check size={15}/>}</span>
    </button>)}{!items.length && <div className="empty-state">暂无用色</div>}</div>
  </div>;
}
