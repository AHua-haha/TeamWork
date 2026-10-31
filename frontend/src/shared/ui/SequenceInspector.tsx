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
  selectedKey, onSelect, empty = <div className="sequence-inspector-empty tw:grid tw:min-h-[180px] tw:place-items-center tw:p-6 tw:text-[var(--muted,#8793a1)]">No entries</div>,
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

  const shellClass = 'sequence-inspector tw:grid tw:grid-cols-[minmax(220px,34%)_1fr] tw:min-h-[320px] tw:overflow-hidden tw:rounded-[10px] tw:border tw:border-solid tw:border-[var(--line,#27303a)] tw:bg-[var(--surface,#11161c)] tw:max-[700px]:block';
  if (!items.length) return <section className={shellClass}>{empty}</section>;
  const selected = selectedIndex >= 0 ? items[selectedIndex] : undefined;
  return <section className={shellClass} aria-label="Sequence inspector">
    <div className="sequence-inspector-list tw:overflow-auto tw:border-0 tw:border-e tw:border-solid tw:border-[var(--line,#27303a)] tw:p-1.5 tw:max-[700px]:max-h-60 tw:max-[700px]:border-e-0 tw:max-[700px]:border-b" role="listbox" aria-label="Entries">
      {items.map((item, index) => {
        const key = getKey(item, index);
        const selected = key === activeKey;
        return <button key={key} id={`${baseId}-${key}`} type="button" role="option" aria-selected={selected}
          className={`sequence-inspector-row tw:box-border tw:block tw:w-full tw:cursor-pointer tw:rounded-[7px] tw:border-0 tw:bg-transparent tw:p-2.5 tw:text-left tw:[font:inherit] tw:text-inherit tw:hover:bg-[var(--surface-raised,#202832)] tw:aria-selected:bg-[var(--surface-raised,#202832)] tw:focus-visible:outline-2 tw:focus-visible:outline-[var(--accent,#7cb8ff)] tw:focus-visible:-outline-offset-2${selected ? ' is-selected' : ''}`} onClick={() => { setInternalKey(key); onSelect?.(item, index); }}>
          {renderRow(item, index, selected)}
        </button>;
      })}
    </div>
    <div className="sequence-inspector-detail tw:overflow-auto tw:p-4" aria-live="polite">
      {selected === undefined ? empty : renderDetail(selected, selectedIndex)}
    </div>
  </section>;
}
