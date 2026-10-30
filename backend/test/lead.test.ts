import {resolveAssignment} from '../src/core/team/member-workspace.js';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {test} from 'node:test';
import {withTeam} from './team-fixture.js';

test('lead sees new filesystem design parts after refresh while member-file edits still require activation',()=>withTeam(async f=>{
 await mkdir(join(f.directory,'src/new'),{recursive:true});
 await mkdir(join(f.directory,'.rsi/project/src/new/_ctx'),{recursive:true});
 const assignment=(await f.team.service.get(f.workspaceId,f.lead.memberId)).designScope;
 await writeFile(join(f.directory,'.rsi/project/src/new/_ctx/DESIGN.md'),'New design');
 await mkdir(join(f.directory,'.rsi/members/Example'),{recursive:true});
 await writeFile(join(f.directory,'.rsi/members/Example/member.json'),'{"name":"Example"}');
 assert.equal((await resolveAssignment(f.team.designs,f.workspaceId,assignment)).working.length,1);
 await f.team.designs.refresh(f.workspaceId);
 assert.deepEqual((await resolveAssignment(f.team.designs,f.workspaceId,assignment)).working.flatMap(d=>d.implementation),['.','src/new']);
 assert.equal((await f.team.service.team(f.workspaceId)).members.length,1);
}));
