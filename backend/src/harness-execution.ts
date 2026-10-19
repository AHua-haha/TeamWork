import { lstat, mkdir, mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import { delimiter, dirname, join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { sha256 } from './text.js';

// These are execution resources, not member-owned project resources. Never inherit
// the backend's environment or expose the user's home as the command's HOME.
const homes = new Map<string, Promise<string>>();
let session: Promise<string> | undefined;
let hostTools: ReturnType<typeof toolchains> | undefined;
/** Called only after the backend has drained agent execution. */
export async function closeExecutionResources() {
  if (session) await rm(await session, { recursive: true, force: true });
  homes.clear(); session = undefined; hostTools = undefined;
}
const existing = async (paths: string[]) => {
  const result: string[] = [];
  for (const path of new Set(paths)) {
    try { result.push(path, await realpath(path)); } catch { /* Optional host toolchain. */ }
  }
  return [...new Set(result)];
};

async function toolchains() {
  const home = homedir();
  const paths = [...new Set([
    dirname(process.execPath), ...(process.env.PATH ?? '').split(delimiter).filter(path => path.startsWith('/')),
    '/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin', '/usr/local/sbin',
    join(home, '.local/bin'), join(home, '.cargo/bin'), join(home, '.bun/bin'),
    '/usr/bin', '/bin', '/usr/sbin', '/sbin',
  ])];
  const readable = await existing([
    '/bin', '/usr', '/sbin', '/opt', '/System', '/Library', '/Applications',
    '/private/etc', '/etc', '/private/var/select', '/var/select', '/dev',
    dirname(dirname(process.execPath)), ...paths,
    join(home, '.local/share/uv/python'), join(home, '.pyenv/versions'),
    join(home, '.rustup/toolchains'), join(home, 'Library/Python'),
  ]);
  // User package-manager shims can point outside PATH (pipx, uv tools, nvm).
  // Only known installation trees can grant additional host read access.
  const installationRoots = ['.local/share/uv/tools', '.local/pipx/venvs', 'pipx/venvs', '.nvm/versions', '.pyenv/versions', '.rustup/toolchains'].map(path => join(home, path) + '/');
  for (const path of paths.filter(path => path.startsWith(home + '/'))) {
    const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isSymbolicLink()) continue;
      try {
        const target = await realpath(join(path, entry.name));
        if (!installationRoots.some(path => target.startsWith(path))) continue;
        if (!(await lstat(target)).isFile()) continue;
        const parent = dirname(target);
        readable.push(['bin', 'sbin'].includes(parent.split('/').at(-1)!) ? dirname(parent) : parent);
      } catch { /* Broken optional shim. */ }
    }
  }
  return { paths, readable: [...new Set(readable)] };
}

/** Stable within this backend session; caches never enter project Git or personal HOME. */
export async function executionResources(root: string) {
  let opening = homes.get(root);
  if (!opening) {
    session ??= mkdtemp(join(tmpdir(), 'rsi-execution-')).then(path => realpath(path));
    opening = session.then(async base => {
      const home = join(base, sha256(root).slice(0, 24));
      await mkdir(home, { recursive: true, mode: 0o700 });
      await Promise.all(['.cache', '.config', '.local/share', '.npm'].map(path => mkdir(join(home, path), { recursive: true })));
      return home;
    });
    homes.set(root, opening);
    void opening.catch(() => { if (homes.get(root) === opening) homes.delete(root); });
  }
  hostTools ??= toolchains();
  const [home, tools] = await Promise.all([opening, hostTools]);
  return {
    home, readable: [...tools.readable, home],
    environment(area: string, scratch: string): NodeJS.ProcessEnv {
      return {
        PATH: [area, join(home, '.local/bin'), ...tools.paths].join(delimiter), HOME: home,
        LANG: 'en_US.UTF-8', TMPDIR: scratch,
        XDG_CACHE_HOME: join(home, '.cache'), XDG_CONFIG_HOME: join(home, '.config'), XDG_DATA_HOME: join(home, '.local/share'),
        npm_config_cache: join(home, '.npm'), UV_CACHE_DIR: join(home, '.cache/uv'),
        // Node >=24 needs this opt-in to use the proxy variables injected by SRT.
        NODE_USE_ENV_PROXY: '1',
      };
    },
  };
}
