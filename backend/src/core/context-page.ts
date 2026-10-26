import { AppError, position } from './errors.js';

/** Transport-neutral pagination for an owner's retained context, never a live stream. */
export interface ContextPageInput { offset?: number; limit?: number; revision?: number }
export interface ContextPage<T> { revision: number; offset: number; total: number; nextOffset: number | null; entries: T[] }
export function contextPageInput(input: ContextPageInput) {
  const offset = input.offset ?? 0, limit = input.limit ?? 50;
  position(offset); position(limit);
  if (limit < 1 || limit > 100) throw new AppError('invalid_input', 'limit must be between 1 and 100');
  if (input.revision !== undefined) position(input.revision);
  if (offset > 0 && input.revision === undefined) throw new AppError('invalid_input', 'revision is required for subsequent context pages');
  return { offset, limit, revision: input.revision };
}
export function checkContextPage(revision: number, total: number, input: ReturnType<typeof contextPageInput>): void {
  if (input.revision !== undefined && input.revision !== revision)
    throw new AppError('context_changed', 'Context changed; refresh to inspect the current context', 409);
  if (input.offset > total) throw new AppError('invalid_input', 'offset is beyond the context length');
}
