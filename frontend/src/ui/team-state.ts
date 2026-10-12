import type { AgentConfig, AgentSettings } from '../client/config-client.js';
import type { Member, MemberFields, Team } from '../client/workspace-client.js';

/** How often the team is read again while the lead's run is active, so Working follows who is being called. */
export const pollIntervalMs = 3000;

export function findLead(team: Team | null): Member | null {
  return team?.members.find(member => member.lead) ?? null;
}

/** The lead's record in the shape of an agent config, so the composer controls need no second code path. */
export function leadConfig(member: Member): AgentConfig {
  return { id: member.memberId, revision: member.revision, value: { name: member.name, ...member.settings }, issues: member.issues };
}

/** Composer edits preserve the lead's team identity and harness. */
export function leadFields(member: Member, value: AgentSettings): MemberFields {
  const { name: _name, ...settings } = value;
  return { name: member.name, role: member.role, responsibility: member.responsibility, harness: member.harness, settings };
}

/** Whether the team is read on a timer: only while the lead's run is active. */
export function shouldPoll(leadRunning: boolean): boolean {
  return leadRunning;
}

export type MemberStatus = { label: 'Working' | 'Idle' | 'Cannot run'; reasons: string[] };

export function memberStatus(member: Member): MemberStatus {
  if (member.running) return { label: 'Working', reasons: [] };
  if (!member.ready) return { label: 'Cannot run', reasons: member.issues };
  return { label: 'Idle', reasons: [] };
}

/** The name of the model a member has selected, or null. The connection ID tells models of different connections apart. */
export function modelText(member: Member): string | null {
  const { connectionId, modelId } = member.settings;
  return connectionId && modelId ? `${modelId} · ${connectionId}` : null;
}
