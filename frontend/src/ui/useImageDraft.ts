import { useEffect, useRef, useState } from 'react';

export interface DraftImage { id: string; file: File; url: string }
export function imageInputError(files: readonly File[], currentCount: number): string | null {
  if (files.length + currentCount > 4) return 'Attach at most four pictures.';
  if (files.some(file => !['image/png', 'image/jpeg', 'image/webp'].includes(file.type))) return 'Choose PNG, JPEG or WebP pictures.';
  if (files.some(file => !file.size || file.size > 10 * 1024 * 1024)) return 'Each picture must be nonempty and at most 10 MiB.';
  return null;
}

/** URLs belong to the composer draft; removing/sending/unmounting releases them. */
export function useImageDraft() {
  const current = useRef<DraftImage[]>([]);
  const [images, setImages] = useState<DraftImage[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => () => { for (const image of current.current) URL.revokeObjectURL(image.url); }, []);
  function add(files: readonly File[]) {
    const problem = imageInputError(files, current.current.length);
    if (problem) { setError(problem); return; }
    const added = files.map(file => ({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file) }));
    current.current = [...current.current, ...added]; setImages(current.current); setError(null);
  }
  function remove(ids: readonly string[]) {
    const selected = new Set(ids);
    for (const image of current.current) if (selected.has(image.id)) URL.revokeObjectURL(image.url);
    current.current = current.current.filter(image => !selected.has(image.id)); setImages(current.current); setError(null);
  }
  return { images, error, add, remove };
}
