export type DiscussionReference = { kind: 'design'; path: string } | { kind: 'member'; memberId: string; name: string };
export const referenceLabel = (ref: DiscussionReference) => ref.kind === 'design' ? `Design · ${ref.path}` : `Member · ${ref.name}`;
export function discussionInput(text: string, ref: DiscussionReference | null): string {
  if (!ref) return text;
  const reference = ref.kind === 'design' ? `Regarding design .context/${ref.path}:` : `Regarding team member ${ref.name} (member ID ${ref.memberId}):`;
  return `${reference}\n\n${text}`;
}

export interface Discussion { reference: DiscussionReference | null; clear(): void; sent(reference: DiscussionReference): void }
