
import { AppError } from './errors.js';

import { invalid, object, jsonValue } from './validation.js';
export { validateMessage, validateEntries, validateRun } from './agent/message-validation.js';

export function encode(value: unknown): string {
  jsonValue(value);
  return JSON.stringify({ version: 1, data: value });
}

export function decode<T>(raw: unknown, validate: (value: unknown) => void): T {
  try {
    const envelope: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
    object(envelope);
    if (envelope.version !== 1 || !('data' in envelope)) invalid('Unsupported record schema version');
    jsonValue(envelope.data);
    validate(envelope.data);
    return envelope.data as T;
  } catch (error) {
    throw new AppError('corrupt_data', `Cannot deserialize stored record: ${error instanceof Error ? error.message : 'invalid data'}`, 500);
  }
}

export { validateAuthor, validateChangeRecord } from './workspace/context-validation.js';
