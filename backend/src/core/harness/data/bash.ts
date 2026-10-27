import { AppError } from '../../errors.js';
export const commandTimeoutMs = 60000;
export const backgroundStartTimeoutMs = 10000;
export const commandOutputBytes = 50 * 1024;
export interface BashInput {
    command: string;
    cwd?: string;
    timeout?: number;
    background?: boolean;
    metadata?: Record<string, unknown>;
}
export interface CommandResult {
    output: string;
    exitCode: number | null;
    durationMs: number;
    truncated: boolean;
    timedOut: boolean;
    jobId?: number;
    shellRestarted?: boolean;
    error?: string;
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export function parseBashInput(value: unknown): BashInput {
    if (!object(value) || Object.keys(value).some(k => !['command', 'cwd', 'timeout', 'background', 'metadata'].includes(k)) || typeof value.command !== 'string' || !value.command.trim() || value.command.length > 20000 || value.command.includes('\0'))
        throw new AppError('invalid_input', 'Bash requires command and optional cwd, timeout, background and metadata');
    if (value.cwd !== undefined && (typeof value.cwd !== 'string' || !value.cwd || value.cwd.includes('\0')))
        throw new AppError('invalid_input', 'cwd must be a nonempty path');
    if (value.timeout !== undefined && (typeof value.timeout !== 'number' || !Number.isFinite(value.timeout) || value.timeout <= 0 || value.timeout > 2147483))
        throw new AppError('invalid_input', 'timeout must be positive seconds, at most 2147483');
    if (value.background !== undefined && typeof value.background !== 'boolean')
        throw new AppError('invalid_input', 'background must be boolean');
    if (value.metadata !== undefined) {
        if (!object(value.metadata) || Object.keys(value.metadata).length)
            throw new AppError('invalid_input', 'No Bash metadata fields are currently defined; git.scope is retired');
    }
    return value as unknown as BashInput;
}
