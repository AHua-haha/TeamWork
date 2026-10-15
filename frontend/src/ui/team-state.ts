import type { Member, Team } from '../client/workspace-client.js';

/** How often the team is read again while team work is active. */
export const pollIntervalMs = 3000;

export function findLead(team: Team | null): Member | null {
  return team?.members.find(member => member.lead) ?? null;
}

/** Whether the team is read on a timer: only while team work is active. */
export function shouldPoll(running: boolean): boolean {
  return running;
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
