import { useMemo, type ReactNode } from 'react';
import { externalHref, parseMarkdown, type Block, type Inline } from './markdown-parser.js';

/** `onLink` receives relative links so the caller can open them in place; other links open in a new tab. */
export function Markdown({ source, onLink }: { source: string; onLink: (href: string) => void }) {
  const parsed = useMemo(() => parseMarkdown(source), [source]);
  return <div className="markdown">{parsed.map((block, index) => <BlockView key={index} block={block} onLink={onLink} />)}</div>;
}

function inlines(children: Inline[], onLink: (href: string) => void): ReactNode[] {
  return children.map((child, index) => {
    switch (child.type) {
      case 'text': return child.text;
      case 'code': return <code key={index}>{child.text}</code>;
      case 'strong': return <strong key={index}>{inlines(child.children, onLink)}</strong>;
      case 'em': return <em key={index}>{inlines(child.children, onLink)}</em>;
      case 'del': return <del key={index}>{inlines(child.children, onLink)}</del>;
      case 'link': {
        const external = externalHref(child.href);
        if (external) return <a key={index} href={external} target="_blank" rel="noreferrer noopener">{inlines(child.children, onLink)}</a>;
        if (/^[a-z][a-z0-9+.-]*:/i.test(child.href) || !child.href) return <span key={index}>{inlines(child.children, onLink)}</span>;
        return <a key={index} href={child.href} onClick={event => { event.preventDefault(); onLink(child.href); }}>{inlines(child.children, onLink)}</a>;
      }
    }
  });
}

function BlockView({ block, onLink }: { block: Block; onLink: (href: string) => void }) {
  switch (block.type) {
    case 'heading': {
      const Tag = `h${block.level}` as 'h1';
      return <Tag>{inlines(block.children, onLink)}</Tag>;
    }
    case 'paragraph': return <p>{inlines(block.children, onLink)}</p>;
    case 'code': return <pre data-language={block.language || undefined}><code>{block.text}</code></pre>;
    case 'quote': return <blockquote>{block.children.map((child, index) => <BlockView key={index} block={child} onLink={onLink} />)}</blockquote>;
    case 'rule': return <hr />;
    case 'list': {
      const items = block.items.map((item, index) => <li key={index}>{item.map((child, inner) => <BlockView key={inner} block={child} onLink={onLink} />)}</li>);
      return block.ordered ? <ol start={block.start === 1 ? undefined : block.start}>{items}</ol> : <ul>{items}</ul>;
    }
    case 'table': return <div className="markdown-table"><table>
      <thead><tr>{block.head.map((cell, index) => <th key={index} style={{ textAlign: block.align[index] ?? undefined }}>{inlines(cell, onLink)}</th>)}</tr></thead>
      <tbody>{block.rows.map((row, index) => <tr key={index}>{row.map((cell, column) => <td key={column} style={{ textAlign: block.align[column] ?? undefined }}>{inlines(cell, onLink)}</td>)}</tr>)}</tbody>
    </table></div>;
  }
}
