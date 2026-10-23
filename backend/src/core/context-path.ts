import { AppError } from './types.js';

export const maxContextSegments = 16;
export const maxContextPathLength = 512;
const segmentPattern = /^[A-Za-z0-9_-](?:[A-Za-z0-9 _.-]{0,126}[A-Za-z0-9_-])?$/;
export const validSegment = (name: string): boolean => segmentPattern.test(name);
/** A path relative to the single context root, never an absolute path or traversal. */
export function contextPath(value: string): string {
  const segments = value.split('/');
  if (!value || value.length > maxContextPathLength || segments.length > maxContextSegments) throw new AppError('invalid_path', `A context path has 1–${maxContextSegments} segments and at most ${maxContextPathLength} characters`);
  for (const segment of segments) if (!validSegment(segment)) throw new AppError('invalid_path', `Invalid context name "${segment}": use 1–128 letters, digits, spaces, dashes, underscores or dots without leading/trailing spaces or dots`);
  return value;
}
