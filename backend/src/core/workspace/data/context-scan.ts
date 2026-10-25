import type { Dirent } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { maxFileBytes, missing } from '../../text.js';
import { validSegment, maxContextSegments as maxSegments, maxContextPathLength as maxPathLength } from './paths.js';
import type { Problem } from './context-base.js';

export interface DiskFile { path: string; key: string; size: number; mtimeMs: number }
/** Shared file discovery for bootstrap and ongoing indexing. Never follows links. */
export async function scanContextFiles(directory: string): Promise<{ files: DiskFile[]; problems: Problem[] }> {
  const files: DiskFile[] = [];
  const problems: Problem[] = [];
  const visit = async (folder: string, prefix: string, segments: number): Promise<void> => {
    let entries: Dirent[];
    try { entries = await readdir(folder, { withFileTypes: true }); }
    catch (error) {
      if (missing(error)) return;
      throw error;
    }
    const visible = entries.filter(entry => !entry.name.startsWith('.'));
    const counts = new Map<string, number>();
    for (const entry of visible) counts.set(entry.name.toLowerCase(), (counts.get(entry.name.toLowerCase()) ?? 0) + 1);
    for (const entry of visible) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (counts.get(entry.name.toLowerCase())! > 1) {
        problems.push({ path, code: 'duplicate_path', message: 'Another name differs only in letter case' });
        continue;
      }
      if (!validSegment(entry.name) || segments + 1 > maxSegments || path.length > maxPathLength) {
        problems.push({ path, code: 'invalid_path', message: 'The name or path breaks the context path rules' });
        continue;
      }
      if (entry.isDirectory()) {
        await visit(join(folder, entry.name), path, segments + 1);
        continue;
      }
      if (!entry.isFile()) {
        problems.push({ path, code: 'not_file', message: 'Not a regular file' });
        continue;
      }
      try {
        const info = await lstat(join(folder, entry.name));
        if (info.size > maxFileBytes) problems.push({ path, code: 'too_large', message: `Larger than ${maxFileBytes} bytes` });
        else files.push({ path, key: path.toLowerCase(), size: info.size, mtimeMs: info.mtimeMs });
      } catch (error) {
        if (!missing(error)) throw error;
      }
    }
  };
  await visit(directory, '', 0);
  return { files, problems };
}
