import type { ReactNode } from 'react';
import { useEffect, useId, useState } from 'react';

export type SequenceInspectorProps<T> = {
  items: readonly T[];
  getKey?: (item: T, index: number) => string;
  renderRow: (item: T, index: number, selected: boolean) => ReactNode;
  renderDetail: (item: T, index: number) => ReactNode;
  selectedKey?: string;
  onSelect?: (item: T, index: number) => void;
  empty?: ReactNode;
};

/** A presentation-only chronological list with a detail panel. */
export function SequenceInspector<T>({
  items, getKey = (_item, index) => String(index), renderRow, renderDetail,
  selectedKey, onSelect, empty = <div className="sequence-inspector-empty">No entries</div>,
}: SequenceInspectorProps<T>) {
  const [internalKey, setInternalKey] = useState<string | undefined>(selectedKey ?? (items.length ? getKey(items[items.length - 1]!, items.length - 1) : undefined));
  const baseId = useId();
  const activeKey = selectedKey ?? internalKey;
  const selectedIndex = items.findIndex((item, index) => getKey(item, index) === activeKey);

  useEffect(() => {
    if (selectedIndex < 0 && items.length) {
      const index = items.length - 1;
      const key = getKey(items[index]!, index);
      setInternalKey(key);
      onSelect?.(items[index]!, index);
    }
  }, [items, selectedIndex, getKey, onSelect]);

  if (!items.length) return <section className="sequence-inspector">{empty}</section>;
  const selected = selectedIndex >= 0 ? items[selectedIndex] : undefined;
  return <section className="sequence-inspector" aria-label="Sequence inspector">
    <div className="sequence-inspector-list" role="listbox" aria-label="Entries">
      {items.map((item, index) => {
        const key = getKey(item, index);
        const selected = key === activeKey;
        return <button key={key} id={`${baseId}-${key}`} type="button" role="option" aria-selected={selected}
          className={`sequence-inspector-row${selected ? ' is-selected' : ''}`} onClick={() => { setInternalKey(key); onSelect?.(item, index); }}>
          {renderRow(item, index, selected)}
        </button>;
      })}
    </div>
    <div className="sequence-inspector-detail" aria-live="polite">
      {selected === undefined ? empty : renderDetail(selected, selectedIndex)}
    </div>
  </section>;
}
