/** One inspected operational migration. Run only with the backend stopped and its .env loaded. */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, openSync } from 'node:fs';
import { chmod, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MySqlStore } from '../../../backend/src/database.js';
import { ConfigService } from '../../../backend/src/config.js';
import { WorkspaceService } from '../../../backend/src/workspace.js';
import { TeamSystem } from '../../../backend/src/team-system.js';
import { builtinModels } from '../../../backend/node_modules/@earendil-works/pi-ai/dist/providers/all.js';

const task = dirname(fileURLToPath(import.meta.url));
const plan = JSON.parse(await readFile(join(task,'plan.json'),'utf8'));
const source = plan.workspace as string, id = plan.workspaceId as string;
const application = resolve(task,'../../..');
const backup = join(application,'.run/private-migration-backups/personal-todo-2026-10-19');
const privateRepository = join(source,'.rsi/harness/repository.git');
const implementation = 'e41dcf1074560f9c44c7c8df6c1ad1c275abb58f';
const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const git = (...args: string[]) => execFileSync('git',['-C',source,...args],{encoding:'utf8'}).trim();
const oldGit = (...args: string[]) => execFileSync('git',['--git-dir',privateRepository,...args],{encoding:'utf8'}).trim();
const store = new MySqlStore(process.env.DATABASE_URL!);
const config = new ConfigService(store,builtinModels(),[],process.env.CONFIG_ENCRYPTION_KEY);
const workspaces = new WorkspaceService(store,config), team = new TeamSystem(store,workspaces,config);
const stableTables = ['agents','runs','messages','config_records','workspace_models','members','member_activation','chat_settings','chat_exchanges','chat_messages','chat_runs','chat_clock','chat_entries','chat_changes','chat_delivery'];
async function databaseFingerprint() {
  const result: Record<string,{rows:number;sha256:string}> = {};
  for (const table of stableTables) {
    const [rows] = await store.pool.query(`SELECT * FROM ${table}`);
    const values = (rows as object[]).map(row=>JSON.stringify(row)).sort();
    result[table]={rows:values.length,sha256:digest(JSON.stringify(values))};
  }
  return result;
}
async function files(root:string):Promise<Record<string,string>> {
  const result:Record<string,string>={};
  async function visit(path:string) {
    for(const entry of await readdir(join(root,path),{withFileTypes:true})) {
      const next=path?`${path}/${entry.name}`:entry.name;
      assert.ok(!entry.isSymbolicLink(),'Unexpected link '+next);
      if(entry.isDirectory()) await visit(next); else if(entry.isFile()) result[next]=digest(await readFile(join(root,next)));
    }
  }
  await visit('');return result;
}
try {
  await store.acquireRuntime(()=>{});
  assert.equal((await store.getWorkspace(id))?.directory,source);
  const members=await store.listMembers(id);
  assert.equal(members.filter(m=>m.value.retiredAt===null).length,4);
  for(const member of members) assert.notEqual((await store.getState(member.id)).run?.status,'running');
  assert.equal(git('for-each-ref','--format=%(refname)'),'');
  assert.equal(git('ls-files','--stage'),'');
  assert.equal((await readFile(join(source,'.git/HEAD'),'utf8')).trim(),plan.projectGit.head);
  const stableBefore=await databaseFingerprint(), frontendBefore=await files(join(source,'frontend'));
  const refsBefore=oldGit('for-each-ref','--format=%(refname) %(objectname)','refs/harness/scopes/','refs/harness/designs/');
  const legacyBefore=await files(join(source,'.rsi/harness/worktrees'));
  execFileSync('python3',[join(task,'import-files.py'),join(task,'plan.json'),'--dry-run']);
  await mkdir(dirname(backup),{recursive:true,mode:0o700});
  await chmod(dirname(backup),0o700);
  await mkdir(backup,{mode:0o700}); // A repeated application must not replace its backup.
  execFileSync('tar',['-czf',join(backup,'project.tar.gz'),'-C',dirname(source),'personal-todo']);
  await chmod(join(backup,'project.tar.gz'),0o600);
  const url=new URL(process.env.DATABASE_URL!);
  const fd=openSync(join(backup,'database.sql'),'wx',0o600);
  try {
    const result=spawnSync('docker',['exec','-e','MYSQL_PWD','backend-mysql-1','mysqldump','--single-transaction','--skip-lock-tables','--no-tablespaces','--set-gtid-purged=OFF','-u',decodeURIComponent(url.username),url.pathname.slice(1)],{env:{...process.env,MYSQL_PWD:decodeURIComponent(url.password)},stdio:['ignore',fd,'pipe']});
    assert.equal(result.status,0,result.stderr?.toString());
  } finally { closeSync(fd); }
  assert.ok((await stat(join(backup,'database.sql'))).size>0);
  await writeFile(join(backup,'before.json'),JSON.stringify({stableBefore,frontendBefore,refsBefore,legacyBefore},null,2),{mode:0o600});
  store.assertRuntime();
  execFileSync('python3',[join(task,'import-files.py'),join(task,'plan.json'),'--apply']);
  // This project has an unborn branch and empty index. Reuse the existing semantic history,
  // preserving commit IDs and all untracked/unstaged shared frontend work.
  execFileSync('git',['-C',source,'fetch','--no-tags','--no-write-fetch-head',privateRepository,implementation],{stdio:'pipe'});
  const branch=git('symbolic-ref','HEAD');
  git('update-ref',branch,implementation,'0'.repeat(40));
  git('read-tree',implementation); // index only; never checks out or overwrites working files.
  for(const change of plan.changes) {
    const bytes=await readFile(join(source,change.path));
    assert.equal(digest(bytes),change.sourceSha256);
  }
  assert.deepEqual(await files(join(source,'frontend')),frontendBefore);
  assert.equal(git('diff','--name-only','HEAD','--','backend'),'');
  assert.equal(git('diff','--cached','--name-only'),'');
  const environments=[];
  for(const member of members.filter(m=>m.value.retiredAt===null)) {
    const environment=await team.harness.environment(member.id);
    assert.equal(environment.root,source);
    for(const part of environment.parts) await environment.history.checkpoint(member.id,part,source,{type:'harness',memberId:member.id},'Migrate existing files to shared workspace');
    environments.push({memberId:member.id,name:member.value.name,directory:environment.root});
  }
  const current=await team.currentConfiguration(id);
  assert.equal(current.status.valid,true,JSON.stringify(current.status.issues));
  assert.equal(current.activation.hasChanges,false,'Migration must not activate or replace the accepted source');
  assert.equal(oldGit('for-each-ref','--format=%(refname) %(objectname)','refs/harness/scopes/','refs/harness/designs/'),refsBefore);
  assert.deepEqual(await files(join(source,'.rsi/harness/worktrees')),legacyBefore);
  assert.deepEqual(await databaseFingerprint(),stableBefore);
  await writeFile(join(backup,'after.json'),JSON.stringify({stableAfter:await databaseFingerprint(),environments,frontendAfter:await files(join(source,'frontend'))},null,2),{mode:0o600});
  const report={time:new Date().toISOString(),workspaceId:id,directory:source,backup,importedFiles:plan.changes.length,conflicts:0,implementationHead:git('rev-parse','HEAD'),implementationCommits:git('rev-list','--count','HEAD'),implementationTrackedFiles:git('ls-files').split('\n').filter(Boolean).length,environments,frontendPreserved:true,stableDatabasePreserved:true,approvalRefsPreserved:true,legacyFilesPreserved:true,pendingMembers:current.status.hasPending,activationChanged:current.activation.hasChanges};
  await writeFile(join(task,'result.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
} finally { await team.runner.close();await workspaces.close();await store.close(); }
