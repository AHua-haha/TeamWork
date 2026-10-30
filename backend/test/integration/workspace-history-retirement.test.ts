import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {CoreData} from '../../src/core/data.js';
import {encode} from '../../src/core/codec.js';
import {MySqlStorage} from '../../src/storage/mysql.js';
import {WorkspaceService} from '../../src/core/workspace/workspace.js';
import {testModels,testModelValidator} from '../memory-store.js';
const databaseUrl=process.env.TEST_DATABASE_URL;
if(!databaseUrl)throw new Error('Set TEST_DATABASE_URL to a disposable MySQL database');
async function isolated(run:(store:CoreData,url:string)=>Promise<void>){
 const admin=new MySqlStorage(databaseUrl!),name='retire_'+randomUUID().replaceAll('-',''),url=new URL(databaseUrl!);url.pathname='/'+name;
 await admin.pool.query(`CREATE DATABASE ${name}`);
 const store=new CoreData(new MySqlStorage(url.toString()));
 try{await store.migrate();await run(store,url.toString());}finally{await store.close();await admin.pool.query(`DROP DATABASE ${name}`);await admin.close();}
}

test('retirement drops all context SQL/history and old design baselines while preserving member acceptance, Agent/Team history and context files',()=>isolated(async(store,url)=>{
 const folder=await realpath(await mkdtemp(join(tmpdir(),'context-retire-'))),service=new WorkspaceService(store.workspaces,testModelValidator);
 try{
  const workspace=await service.create({name:'Project',directory:join(folder,'project'),models:testModels(),adopt:false});
  const lead=(await store.team.listMembers(workspace.workspaceId))[0]!;
  const membersBefore=await store.team.listMembers(workspace.workspaceId),activationBefore=await store.team.getMemberActivation(workspace.workspaceId);
  const baseline=(await store.workspaces.getMemberBaseline(workspace.workspaceId))!;
  const agent=await store.agents.createAgent();
  const run=await store.agents.startRun(agent.agentId,{role:'user',content:'Keep private message history',timestamp:1});
  await store.agents.finishRun(agent.agentId,run.runId,'completed');
  const agentBefore=await store.agents.getContext(agent.agentId),agentHistory=await store.agents.followSnapshot(agent.agentId);
  await store.team.publishChat({workspaceId:workspace.workspaceId,text:'Keep shared message history',author:{type:'user'},recipients:[]});
  const groupBefore=await store.team.readGroupContext(workspace.workspaceId,0);
  const file=join(workspace.directory,'.rsi/project/_ctx/DESIGN.md'),contentBefore=await readFile(file,'utf8');
  await store.pool.query('CREATE TABLE workspace_git_baselines (workspace_id VARCHAR(64) PRIMARY KEY,data JSON NOT NULL)');
  await store.pool.execute('INSERT INTO workspace_git_baselines (workspace_id,data) VALUES (?,?)',[workspace.workspaceId,encode({time:1,design:{old:'Obsolete full document'},members:baseline.members})]);
  await store.pool.execute('DELETE FROM workspace_member_baselines WHERE workspace_id=?',[workspace.workspaceId]);
  for(const table of ['context_files','context_versions','context_records','context_blobs']){
    await store.pool.query(`CREATE TABLE ${table} (workspace_id VARCHAR(64),content TEXT)`);
    await store.pool.execute(`INSERT INTO ${table} (workspace_id,content) VALUES (?,?)`,[workspace.workspaceId,'Obsolete file history']);
  }
  await store.pool.query('ALTER TABLE workspaces ADD COLUMN seq BIGINT UNSIGNED NOT NULL DEFAULT 12');
  await store.workspaces.migrate();await store.workspaces.migrate();
  const reopened=new CoreData(new MySqlStorage(url));
  try{
    const [tables]=await reopened.pool.query<any[]>('SHOW TABLES');const names=tables.map(row=>String(Object.values(row)[0]));
    for(const table of ['context_files','context_versions','context_records','context_blobs','workspace_git_baselines'])assert.ok(!names.includes(table),table);
    const [columns]=await reopened.pool.query<any[]>('SHOW COLUMNS FROM workspaces');assert.ok(!columns.some(row=>row.Field==='seq'));
    assert.deepEqual(await reopened.workspaces.getMemberBaseline(workspace.workspaceId),baseline);
    assert.deepEqual(await reopened.workspaces.getWorkspace(workspace.workspaceId),workspace);
    assert.deepEqual(await reopened.team.listMembers(workspace.workspaceId),membersBefore);
    assert.deepEqual(await reopened.team.getMemberActivation(workspace.workspaceId),activationBefore);
    assert.deepEqual(await reopened.agents.getContext(agent.agentId),agentBefore);
    assert.deepEqual(await reopened.agents.followSnapshot(agent.agentId),agentHistory);
    assert.deepEqual(await reopened.team.readGroupContext(workspace.workspaceId,0),groupBefore);
    assert.equal(await readFile(file,'utf8'),contentBefore);
    assert.ok(baseline.members[lead.value.configuration!.path]);
  }finally{await reopened.close();}
 }finally{await service.close();await rm(folder,{recursive:true,force:true});}
}));

test('an unreadable old member baseline refuses retirement before deleting the original tables',()=>isolated(async store=>{
 await store.pool.query('CREATE TABLE workspace_git_baselines (workspace_id VARCHAR(64) PRIMARY KEY,data JSON NOT NULL)');
 await store.pool.execute('INSERT INTO workspace_git_baselines VALUES (?,?)',['unknown',JSON.stringify({version:99,data:{members:{keep:'Preserve'}}})]);
 await store.pool.query('CREATE TABLE context_blobs (content TEXT)');await store.pool.query("INSERT INTO context_blobs VALUES ('Keep until baseline is understood')");
 await assert.rejects(store.workspaces.migrate(),error=>(error as {code?:string}).code==='corrupt_data');
 const [rows]=await store.pool.query<any[]>('SELECT content FROM context_blobs');assert.equal(rows[0].content,'Keep until baseline is understood');
 const [old]=await store.pool.query<any[]>('SELECT data FROM workspace_git_baselines');assert.equal(old[0].data.version,99);
}));
