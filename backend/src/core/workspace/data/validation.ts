import type { Author, ChangeRecord } from './context-base.js';
import { identity } from '../../agent/data/model.js';
import { invalid, object } from '../../validation.js';

export function validateAuthor(value: unknown): asserts value is Author {
  object(value);
  if (value.type === 'lead') {
    identity(value.memberId, 'memberId');
    identity(value.runId, 'runId');
    return;
  }
  if (value.type !== 'user' && value.type !== 'external') invalid('Unknown change author');
}

export function validateChangeRecord(value: unknown): asserts value is ChangeRecord {
  object(value);
  if (!Number.isSafeInteger(value.seq) || typeof value.time !== 'number' || !Array.isArray(value.files)) invalid('Invalid change record');
  validateAuthor(value.author);
  if (value.reason !== null && typeof value.reason !== 'string') invalid('Invalid change reason');
  for (const file of value.files) {
    object(file);
    if (!['create', 'update', 'move', 'delete'].includes(String(file.action)) || typeof file.path !== 'string') invalid('Invalid changed file');
    if ((file.fromPath !== null && typeof file.fromPath !== 'string') || (file.revision !== null && typeof file.revision !== 'string')) invalid('Invalid changed file');
  }
}
