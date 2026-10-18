import { execFile } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { partOwns, type HarnessPart } from './harness-history.js';
import { AppError } from './types.js';

export interface ProjectEntry { path: string; mode: string; bytes: Buffer }
/** Native project Git, one shared index. Scope authority is checked before native mutations. */
export class ProjectGit {
  constructor(private readonly root: string) {}
  private async run(args: string[], input?: string): Promise<Buffer> {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
    Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'Harness', GIT_AUTHOR_EMAIL: 'harness@localhost', GIT_COMMITTER_NAME: 'Harness', GIT_COMMITTER_EMAIL: 'harness@localhost' });
    return new Promise((resolveResult, reject) => {
      const child = execFile('git', ['-C', this.root, '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'core.attributesFile=/dev/null', ...args], { env, encoding: 'buffer', maxBuffer: 128 * 1024 * 1024, timeout: 60_000 }, (error, stdout, stderr) => {
        if (error) reject(new AppError('project_git_error', stderr.toString().trim() || error.message, 409)); else resolveResult(stdout);
      });
      child.stdin?.on('error', () => {}); child.stdin?.end(input);
    });
  }
  async candidates(): Promise<string[] | null> {
    try {
      if (!(await lstat(join(this.root,'.git'))).isDirectory()) return null;
      await lstat(join(this.root,'.git','HEAD'));
    }
    catch(error) { if((error as NodeJS.ErrnoException).code==='ENOENT') return null; throw error; }
    return (await this.run(['ls-files','--cached','--others','--exclude-standard','-z'])).toString().split('\0').filter(Boolean);
  }
  async open(): Promise<void> {
    try {
      const info = await lstat(join(this.root, '.git'));
      if (!info.isDirectory() || info.isSymbolicLink()) throw new AppError('invalid_path', 'Project Git requires a repository directory at the workspace root');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await this.run(['init', '.']);
    }
    const top = (await this.run(['rev-parse', '--show-toplevel'])).toString().trim();
    if (resolve(top) !== resolve(this.root)) throw new AppError('invalid_path', 'Git repository must belong to this workspace');
  }
  async execute(part: HarnessPart, argv: string[], cwd: string, checkpoint: (message: string) => Promise<unknown>, accepted: (files: ProjectEntry[], message: string, revision: string) => Promise<void>): Promise<string> {
    await this.open();
    const [command, ...args] = argv;
    if (!command || !['status','diff','add','rm','log','show','restore','commit'].includes(command) || argv.some(a => /[\u0000-\u001f]/.test(a))) throw new AppError('command_denied', 'Use scoped Git status/diff/add/rm/log/show/restore/commit', 403);
    const scope = [...part.paths.map(p => p === '.' ? ':/' : `:(top,literal)${p}`), ...part.exclude.map(p => `:(top,exclude,icase)${p}`), ':(top,exclude,icase)**/.git/**'];
    const selected = (values: string[]) => values.flatMap(value => {
      const path = relative(this.root, resolve(cwd, value)) || '.';
      if (isAbsolute(path) || path === '..' || path.startsWith('../') || value.startsWith(':') || value.includes('\\')) throw new AppError('access_denied', 'Git path is outside this implementation scope', 403);
      const owned = partOwns(part,path) ? [path] : part.paths.filter(p=>path==='.'||p.startsWith(path+'/'));
      if(!owned.length) throw new AppError('access_denied','Git path is outside this implementation scope',403);
      return owned.map(p=>p==='.'?':/':`:(top,literal)${p}`);
    }).concat(part.exclude.map(p => `:(top,exclude,icase)${p}`));
    const allow = (options: string[]) => { if (args.some(a => !options.includes(a))) throw new AppError('command_denied', 'Unsupported Git options', 403); };
    const text = async (values: string[]) => (await this.run(values)).toString();
    if (command === 'status') { allow(['--short','-s','--porcelain','--porcelain=v1','--branch','-b']); return text(['status', ...args, '--', ...scope]); }
    if (command === 'diff') { allow(['--cached','--staged','--stat','--name-only','--name-status']); return text(['diff','--no-ext-diff','--no-textconv',...args,'--',...scope]); }
    if (command === 'log') {
      if (args.some(a => !['--all','--oneline'].includes(a) && !/^-(?:\d+|n\d+)$/.test(a) && !/^--max-count=\d+$/.test(a))) throw new AppError('command_denied','Unsupported Git log options',403);
      return text(['log',...args.filter(a=>a!=='--all'),'HEAD','--',...scope]);
    }
    if (command === 'show') {
      if (args.length > 1 || (args[0] && args[0] !== 'HEAD' && !/^[0-9a-f]{40}$/.test(args[0]))) throw new AppError('command_denied','Show HEAD or one full project revision',403);
      return text(['show','--no-ext-diff','--no-textconv',args[0] ?? 'HEAD','--',...scope]);
    }
    if (command === 'add') {
      const requested = args.filter(a=>!['--','-A','--all'].includes(a));
      if (requested.some(a=>a.startsWith('-'))) throw new AppError('command_denied','Use git add [-A] -- <paths>',403);
      if(requested.length) selected(requested);
      const wanted=requested.length ? requested.map(p=>relative(this.root,resolve(cwd,p))||'.') : part.paths;
      const candidates=(await text(['ls-files','--cached','--others','--exclude-standard','-z'])).split('\0').filter(Boolean);
      const paths=[...new Set(candidates)].filter(path=>partOwns(part,path)&&wanted.some(p=>p==='.'||path===p||path.startsWith(p+'/')));
      if(!paths.length) return '';
      return (await this.run(['add','-A','--pathspec-from-file=-','--pathspec-file-nul'], paths.map(p=>`:(top,literal)${p}`).join('\0')+'\0')).toString();
    }
    if (command === 'rm' || command === 'restore') {
      let source='HEAD', staged=false, worktree=false;
      const requested: string[]=[];
      for(let i=0;i<args.length;i++) {
        const arg=args[i]!;
        if(arg==='--') { requested.push(...args.slice(i+1)); break; }
        if(command==='restore' && arg.startsWith('--source=')) source=arg.slice(9);
        else if(command==='restore' && arg==='--staged') staged=true;
        else if(command==='restore' && arg==='--worktree') worktree=true;
        else if(command==='rm' && ['-r','-f','--force'].includes(arg)) continue;
        else if(arg.startsWith('-')) throw new AppError('command_denied','Unsupported Git restore/remove options',403);
        else requested.push(arg);
      }
      if(!requested.length) throw new AppError('invalid_input','Name implementation paths');
      const paths=selected(requested);
      if(source!=='HEAD'&&!/^[0-9a-f]{40}$/.test(source)) throw new AppError('invalid_revision','Use HEAD or a full project revision');
      if(command==='rm'||worktree||!staged) await checkpoint('Before project Git '+command);
      const result = command==='rm' ? await text(['rm',...args.filter(a=>['-r','-f','--force'].includes(a)),'--',...paths]) : await text(['restore',`--source=${source}`,...(staged?['--staged']:[]),...(worktree?['--worktree']:[]),'--',...paths]);
      if(command==='rm'||worktree||!staged) await checkpoint('After project Git '+command);
      return result;
    }
    if(args.length!==2||args[0]!=='-m'||!args[1]?.trim()||args[1].length>1000) throw new AppError('invalid_input','Use git commit -m "meaningful intent"');
    const changed=(await text(['diff','--cached','--name-only','--no-renames','-z'])).split('\0').filter(Boolean);
    if(!changed.length) throw new AppError('nothing_to_commit','No staged changes');
    if(changed.some(path=>!partOwns(part,path))) throw new AppError('access_denied','Shared index contains staged changes outside your implementation scope; preserve them and ask their owner to commit or unstage them',403);
    const entries: ProjectEntry[]=[];
    const index=(await text(['ls-files','--stage','-z'])).split('\0').filter(Boolean);
    for(const row of index) {
      const [header,...rest]=row.split('\t'), [mode,,stage]=header!.split(' '), path=rest.join('\t');
      if(!partOwns(part,path)) continue;
      if(stage!=='0'||!['100644','100755'].includes(mode!)) throw new AppError('invalid_path','Implementation index has an unresolved or unsupported entry');
      entries.push({path,mode:mode!,bytes:await this.run(['show',`:${path}`])});
    }
    const result=await text(['commit','-m',args[1]!]);
    const revision=(await text(['rev-parse','HEAD'])).trim();
    await accepted(entries,args[1]!,revision);
    return result;
  }
}
