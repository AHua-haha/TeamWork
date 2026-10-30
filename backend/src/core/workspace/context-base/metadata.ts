import {parseDocument} from 'yaml';
import {AppError} from '../../errors.js';
import type {ConsumerMetadata} from '../data/context-index.js';
import {relativeProjectPath} from './filesystem.js';

export const emptyConsumerMetadata = (): ConsumerMetadata => ({summary: null, include: []});
export function parseConsumerMetadata(header: string | null): ConsumerMetadata {
  if (header === null) return emptyConsumerMetadata();
  const document = parseDocument(header,{uniqueKeys:true,stringKeys:true});
  if (document.errors.length) throw new AppError('invalid_metadata',document.errors.map(error=>error.message).join('; '));
  let value: unknown;
  try {value = document.toJS({maxAliasCount:0});}
  catch {throw new AppError('invalid_metadata','README metadata aliases cannot be expanded');}
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('invalid_metadata','README metadata must be a mapping');
  const data = value as Record<string,unknown>;
  if (data.summary !== undefined && (typeof data.summary !== 'string' || !data.summary.trim())) throw new AppError('invalid_metadata','summary must be a nonempty string');
  if (data.include !== undefined && (!Array.isArray(data.include) || data.include.some(path=>typeof path !== 'string'))) throw new AppError('invalid_metadata','include must list project-root-relative file or directory paths');
  return {summary: typeof data.summary === 'string' ? data.summary.trim() : null, include: [...new Set(((data.include ?? []) as string[]).map(relativeProjectPath))]};
}

/** Consumer loading verifies that references have not changed since metadata refresh. */
export function metadataHeader(text: string): string | null {
  const content = text.replace(/^\uFEFF/,'');
  const match = /^---\r?\n([\s\S]*?)(?:^|\n)---\r?(?:\n|$)/m.exec(content);
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) return null;
  if (!match || match.index !== 0) throw new AppError('invalid_metadata','README metadata is unterminated');
  return match[1]!;
}
