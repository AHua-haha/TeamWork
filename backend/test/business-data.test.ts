import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TeamExecutionData } from '../src/core/team/data/execution.js';

test('Team data keeps finalizing jobs and a successor admission independent',()=>{
  const data=new TeamExecutionData();data.admitted('member','old','exchange','workspace');
  data.published('member');assert.equal(data.isRunning('member'),false);assert.equal(data.workspaceBusy('workspace'),true);
  data.admitted('member','next','exchange','workspace');data.settled('member','old');
  assert.equal(data.activeRun('member')!.runId,'next');assert.equal(data.workspaceJobs('workspace').length,1);
  const copy=data.activeRun('member')!;copy.runId='mutated';assert.equal(data.activeRun('member')!.runId,'next');
  data.settled('member','next');assert.equal(data.workspaceBusy('workspace'),false);
});
