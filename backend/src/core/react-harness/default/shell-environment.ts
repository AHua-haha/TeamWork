import {delimiter, dirname} from 'node:path';
import {homedir} from 'node:os';
/** Preserve native host tooling without inheriting backend database/provider credentials. */
export function hostShellEnvironment(): NodeJS.ProcessEnv {
  const names = new Set(['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'TERM', 'COLORTERM']);
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => names.has(name) || name.startsWith('LC_')));
  return {...env, HOME: env.HOME || homedir(), PATH: [dirname(process.execPath), env.PATH || '/usr/bin:/bin'].join(delimiter), TERM: env.TERM || 'dumb'};
}
