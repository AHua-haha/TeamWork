import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { delimiter, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { sha256 } from '../foundation/text.js';

const areas = new Map<string, Promise<string>>();
let session: Promise<string> | undefined;
/** One writable temporary area per workspace; no permission to sibling areas. */
export async function executionResources(root: string) {
  let opening = areas.get(root);
  if (!opening) {
    session ??= mkdtemp(join(process.platform === 'darwin' ? '/tmp' : tmpdir(), 'rsi-execution-')).then(path => realpath(path));
    opening = session.then(async base => {
      const area = join(base, sha256(root).slice(0, 24));
      await mkdir(area, { recursive: true, mode: 0o700 });
      return area;
    });
    areas.set(root, opening);
    void opening.catch(() => areas.delete(root));
  }
  const area = await opening;
  return {
    area,
    async shell() {
      const home = await mkdtemp(join(area, 'shell-'));
      await Promise.all(['tmp', '.cache', '.config', '.local/share', '.local/bin', '.npm'].map(p => mkdir(join(home, p), { recursive: true })));
      const env: NodeJS.ProcessEnv = {
        PATH: [join(home, '.local/bin'), dirname(process.execPath), process.env.PATH ?? '/usr/bin:/bin'].join(delimiter),
        HOME: home, TMPDIR: join(home, 'tmp'), LANG: 'en_US.UTF-8', TERM: 'dumb',
        XDG_CACHE_HOME: join(home, '.cache'), XDG_CONFIG_HOME: join(home, '.config'), XDG_DATA_HOME: join(home, '.local/share'),
        npm_config_cache: join(home, '.npm'), UV_CACHE_DIR: join(home, '.cache/uv'), NODE_USE_ENV_PROXY: '1',
      };
      return { home, env };
    },
  };
}
export async function closeExecutionResources() {
  if (session) await rm(await session, { recursive: true, force: true });
  areas.clear(); session = undefined;
}
