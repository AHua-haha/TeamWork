import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Workspace, WorkspaceClient, WorkspaceModels, WorkspaceInput, WorkspaceInitialization } from '../../shared/backend-client/index.js';
import { BackendError } from '../../shared/backend-client/index.js';
import { errorText } from './FileTree.js';
import { WorkspaceModelsEditor } from './WorkspaceModelsEditor.js';
import { workspaceModelsError } from './workspace-model-state.js';

/** A modal in the providers-dialog style, portaled so panel transforms and clipping do not affect it. */
export function Dialog({ eyebrow, title, busy, onClose, children }: { eyebrow: string; title: string; busy: boolean; onClose(): void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => previous?.focus();
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
      if (event.key !== 'Tab') return;
      const focusable = ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled])');
      if (!focusable?.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);
  return createPortal(<div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div className="provider-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
      <div className="dialog-heading"><div><div className="eyebrow">{eyebrow}</div><h2 id={titleId}>{title}</h2></div>
        <button type="button" className="dialog-close" aria-label="Close dialog" disabled={busy} onClick={onClose}>×</button></div>
      {children}
    </div>
  </div>, document.body);
}

/** Runs a dialog's submit action, keeping it open with the backend's message when the action fails. */
function useSubmit(action: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    setBusy(true); setError(null);
    try { await action(); }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  };
  return { busy, error, submit };
}

export function CreateWorkspaceDialog({ client, onCreated, onClose }: { client: WorkspaceClient; onCreated(workspace: Workspace): void; onClose(): void }) {
  const [name, setName] = useState('');
  const [directory, setDirectory] = useState('');
  const [adopt, setAdopt] = useState(false);
  const [models, setModels] = useState<WorkspaceModels>({ models: [], defaultModel: null });
  const [cleanup, setCleanup] = useState<{input: WorkspaceInput; review: WorkspaceInitialization} | null>(null);
  const modelError = workspaceModelsError(models);
  const { busy, error, submit } = useSubmit(async () => {
    if (cleanup) {
      try { onCreated(await client.createWorkspace({...cleanup.input, cleanupRevision: cleanup.review.cleanupRevision!})); }
      catch (cause) {
        if (cause instanceof BackendError && cause.code === 'cleanup_required') setCleanup(null);
        throw cause;
      }
      return;
    }
    if (modelError) throw new Error(modelError);
    const input = {name: name.trim(), directory: directory.trim(), adopt, models};
    const review = await client.inspectInitialization({directory: input.directory, adopt});
    if (review.cleanupRevision) { setCleanup({input: {...input, directory: review.directory}, review}); return; }
    onCreated(await client.createWorkspace(input));
  });
  return <Dialog eyebrow="WORKSPACE" title="New workspace" busy={busy} onClose={onClose}>
    <form onSubmit={event => void submit(event)}>
      {error && <div className="form-error" role="alert">{error}</div>}
      {cleanup ? <>
        <p className="dialog-message">This folder contains existing member or runtime metadata. Clean up these paths and initialize a fresh lead?</p>
        <p><code>{cleanup.review.directory}</code></p>
        <ul>{cleanup.review.cleanupPaths.map(path => <li key={path}><code>{path}</code></li>)}</ul>
        <p className="workspace-model-hint">Existing files under .rsi/context/ and project source files will be preserved. Missing root context files will be added. The listed metadata will be discarded.</p>
        <div className="dialog-actions">
          <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="button" className="text-button" disabled={busy} onClick={() => setCleanup(null)}>Back</button>
          <button type="submit" className="primary-button danger-button" disabled={busy}>{busy ? 'Initializing…' : 'Clean up and initialize'}</button>
        </div>
      </> : <>
      <label>Name<input autoFocus required maxLength={200} value={name} disabled={busy} onChange={event => setName(event.target.value)} placeholder="Billing service" /></label>
      <label>Folder<input required maxLength={1024} value={directory} disabled={busy} onChange={event => setDirectory(event.target.value)} placeholder="Absolute folder path" spellCheck={false} />
        <small>An absolute path on the machine running the backend. Workspaces cannot overlap.</small></label>
      <label className="check-line"><input type="radio" name="workspace-folder" checked={!adopt} disabled={busy} onChange={() => setAdopt(false)} />Create a new folder</label>
      <label className="check-line"><input type="radio" name="workspace-folder" checked={adopt} disabled={busy} onChange={() => setAdopt(true)} />Use an existing folder</label>
      <WorkspaceModelsEditor value={models} onChange={setModels} disabled={busy} />
      {modelError && <p className="workspace-model-hint">{modelError}</p>}
      <div className="dialog-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Cancel</button>
        <button type="submit" className="primary-button" disabled={busy || !!modelError}>{busy ? 'Creating…' : 'Create workspace'}</button></div>
      </>}
    </form>
  </Dialog>;
}

export function WorkspaceModelsDialog({ client, workspaceId, onSaved, onClose }: { client: WorkspaceClient; workspaceId: string; onSaved(): void; onClose(): void }) {
  const [value, setValue] = useState<WorkspaceModels>({ models: [], defaultModel: null });
  const [revision, setRevision] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let current = true; setRevision(null); setLoadError(null);
    client.workspaceModels(workspaceId).then(record => { if (current) { setValue(record.value); setRevision(record.revision); setIssues(record.issues); } }, cause => { if (current) setLoadError(errorText(cause)); });
    return () => { current = false; };
  }, [client, workspaceId, reload]);
  const modelError = workspaceModelsError(value);
  const { busy, error, submit } = useSubmit(async () => {
    if (modelError || revision === null) throw new Error(modelError ?? 'Wait for workspace models');
    await client.updateWorkspaceModels(workspaceId, revision, value); onSaved();
  });
  return <Dialog eyebrow="WORKSPACE" title="Workspace models" busy={busy} onClose={onClose}>
    <form onSubmit={e => void submit(e)}>
      {loadError && <p className="form-error" role="alert">{loadError}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {issues.length > 0 && <p className="workspace-model-hint">{issues.join('; ')}</p>}
      {revision === null ? <p>Loading workspace models…</p> : <WorkspaceModelsEditor value={value} onChange={setValue} disabled={busy} />}
      {modelError && revision !== null && <p className="workspace-model-hint">{modelError}</p>}
      <p className="workspace-model-hint">A lead without a model will be initialized when you save a default.</p>
      <button type="button" className="text-button" disabled={busy} onClick={() => setReload(n => n + 1)}>Reload saved settings</button>
      <div className="dialog-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" className="primary-button" disabled={busy || revision === null || !!modelError}>{busy ? 'Saving…' : 'Save workspace models'}</button></div>
    </form>
  </Dialog>;
}

/** Asks for a path, preselecting the file name so typing replaces it. */
export function PathDialog({ eyebrow, title, label, initial, hint, action, onSubmit, onClose }: {
  eyebrow: string; title: string; label: string; initial: string; hint: string; action: string; onSubmit(path: string): Promise<void>; onClose(): void;
}) {
  const [path, setPath] = useState(initial);
  const input = useRef<HTMLInputElement>(null);
  const { busy, error, submit } = useSubmit(() => onSubmit(path.trim()));
  useEffect(() => {
    const start = initial.lastIndexOf('/') + 1;
    const dot = initial.lastIndexOf('.');
    input.current?.focus();
    input.current?.setSelectionRange(start, dot > start ? dot : initial.length);
  }, [initial]);
  return <Dialog eyebrow={eyebrow} title={title} busy={busy} onClose={onClose}>
    <form onSubmit={event => void submit(event)}>
      {error && <div className="form-error" role="alert">{error}</div>}
      <label>{label}<input ref={input} required value={path} disabled={busy} onChange={event => setPath(event.target.value)} spellCheck={false} /><small>{hint}</small></label>
      <div className="dialog-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Cancel</button>
        <button type="submit" className="primary-button" disabled={busy || !path.trim()}>{busy ? 'Working…' : action}</button></div>
    </form>
  </Dialog>;
}

export function ConfirmDialog({ eyebrow, title, message, action, onConfirm, onClose }: {
  eyebrow: string; title: string; message: ReactNode; action: string; onConfirm(): Promise<void> | void; onClose(): void;
}) {
  const { busy, error, submit } = useSubmit(async () => { await onConfirm(); });
  return <Dialog eyebrow={eyebrow} title={title} busy={busy} onClose={onClose}>
    {error && <div className="form-error" role="alert">{error}</div>}
    <p className="dialog-message">{message}</p>
    <div className="dialog-actions"><button type="button" className="secondary-button" autoFocus disabled={busy} onClick={onClose}>Cancel</button>
      <button type="button" className="primary-button danger-button" disabled={busy} onClick={() => void submit()}>{busy ? 'Working…' : action}</button></div>
  </Dialog>;
}
