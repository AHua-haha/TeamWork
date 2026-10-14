const paths = {
  plus: 'M12 5v14M5 12h14',
  pencil: 'M4 20h4L19 9l-4-4L4 16v4Z',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6',
  copy: 'M9 9h10v11H9zM15 9V4H5v11h4',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  chevron: 'M9 6l6 6-6 6',
  history: 'M4 12a8 8 0 1 0 2.4-5.7M4 4v5h5M12 8v4.5l3 2',
  close: 'M6.5 6.5l11 11M17.5 6.5l-11 11',
  expand: 'M14 4h6v6M20 4l-6.5 6.5M10 20H4v-6M4 20l6.5-6.5',
  collapse: 'M19 10h-5V5M14 10l6-6M5 14h5v5M10 14l-6 6',
  panel: 'M4 5h16v14H4zM14.5 5v14',
  tree: 'M5 4v13.5h5M5 9.5h5M13 7h7M13 12.5h7M13 18h7',
  eye: 'M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12ZM12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6Z',
  code: 'M8.5 7.5 4 12l4.5 4.5M15.5 7.5 20 12l-4.5 4.5',
} as const;

export type GlyphName = keyof typeof paths;

/** A line icon drawn in the current text color. */
export function Glyph({ name }: { name: GlyphName }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
