export function HomePage({ onAddWorkspace, onNewConversation, creating, allowCreation }: {
  onAddWorkspace(): void;
  onNewConversation(): void;
  creating: boolean;
  allowCreation: boolean;
}) {
  return <div className="welcome-page"><div className="welcome-mark">✳</div><div className="eyebrow">PROJECTS</div><h1>What would you like to work on?</h1>
    <p>Add a workspace to work on a project with its team, or start a conversation with no workspace.</p>
    <div className="welcome-actions"><button type="button" className="primary-button" onClick={onAddWorkspace}>＋ Add workspace</button>
      <button type="button" className="secondary-button" disabled={creating || !allowCreation} onClick={onNewConversation}>＋ New conversation</button></div></div>;
}
