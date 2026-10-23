import { AppError } from '../agent/types.js';

/** Operator-owned startup setting; never read from agent/member configuration. */
export function harnessPermissionsEnabled(value: string | undefined): boolean {
  if (value === undefined || value === 'true') return true;
  if (value === 'false') return false;
  throw new AppError('invalid_config', 'RSI_HARNESS_PERMISSIONS_ENABLED must be true or false', 500);
}
