import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MySqlStore } from '../../../backend/src/database.js';
const task=dirname(fileURLToPath(import.meta.url));
const result=JSON.parse(await readFile(join(task,'result.json'),'utf8'));
const before=JSON.parse(await readFile(join(result.backup,'before.json'),'utf8'));
const store=new MySqlStore(process.env.DATABASE_URL!);
const digest=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
async function files(root:string) {
  const out:Record<string,string>={};
  async function visit(path:string) {for(const file of await readdir(join(root,path),{withFileTypes:true})) {
    const next=path?`${path}/${file.name}`:file.name;
    if(file.isDirectory())await visit(next);else if(file.isFile())out[next]=digest(await readFile(join(root,next)));
  }}
  await visit('');return out;
}
async function get(path:string) {
  const response=await fetch('http://127.0.0.1:3000'+path);
  assert.equal(response.status,200,path);return response.json();
}
try {
  const prefix=`/workspaces/${result.workspaceId}`;
  const team=await get(prefix+'/team');assert.equal(team.members.length,4);
  const directories=[];
  for(const member of team.members) {
    assert.equal(member.running,false);
    const info=await get(prefix+`/team/members/${member.memberId}/harness`);
    assert.equal(info.directory,result.directory);
    directories.push({name:member.name,directory:info.directory});
  }
  const current=await get(prefix+'/team/configuration/current');
  assert.equal(current.status.valid,true,JSON.stringify(current.status.issues));
  assert.equal(current.status.hasPending,false);
  assert.equal(current.activation.hasChanges,false);
  const chat=await get(prefix+'/team/chat');
  assert.equal(chat.position,61);assert.ok(chat.runs.every((item:any)=>item.run.status!=='running'));
  for(const [table,baseline] of Object.entries(before.stableBefore)) {
    assert.match(table,/^[a-z_]+$/);
    const [rows]=await store.pool.query(`SELECT * FROM ${table}`);
    const values=(rows as object[]).map(row=>JSON.stringify(row)).sort();
    assert.deepEqual({rows:values.length,sha256:digest(JSON.stringify(values))},baseline,`${table} changed`);
  }
  assert.deepEqual(await files(join(result.directory,'frontend')),before.frontendBefore);
  assert.deepEqual(await files(join(result.directory,'.rsi/harness/worktrees')),before.legacyBefore);
  const plan=JSON.parse(await readFile(join(task,'plan.json'),'utf8'));
  for(const file of plan.changes)assert.equal(digest(await readFile(join(result.directory,file.path))),file.sourceSha256);
  const report={time:new Date().toISOString(),workspaceId:result.workspaceId,backendReady:true,frontendReady:(await fetch('http://127.0.0.1:5273/')).status===200,sharedDirectories:directories,members:4,chatPosition:chat.position,stableTablesPreserved:Object.keys(before.stableBefore),pendingMembers:false,activationChanges:false,importedHashesVerified:plan.changes.length,frontendUnchanged:true,legacyFilesUnchanged:true,modelCalls:0};
  await writeFile(join(task,'verification.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
} finally {await store.close();}
