import { useCallback, useEffect, useRef, useState } from 'react';
import type { ContextFeed, DesignCatalog, WorkspaceClient } from '../client/workspace-client.js';

export interface DesignsState extends DesignCatalog {
  loading: boolean; error: string | null; generation: number; refresh(): Promise<void>;
}
/** Current semantic design catalog shared by Design and Team. It never uses member identity for discovery. */
export function useDesigns(client: WorkspaceClient, workspaceId: string, feed: ContextFeed | null): DesignsState {
  const [state, setState] = useState<Omit<DesignsState, 'refresh'>>({ designs: [], truncated: false, loading: true, error: null, generation: 0 });
  const requests = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++requests.current;
    setState(current => ({ ...current, loading: true }));
    try {
      const catalog = await client.designs(workspaceId);
      if (request === requests.current) setState(current => ({ ...catalog, generation: current.generation + 1, loading: false, error: null }));
    } catch (cause) {
      if (request === requests.current) setState(current => ({ ...current, loading: false, error: cause instanceof Error ? cause.message : 'Designs could not be loaded' }));
    }
  }, [client, workspaceId]);
  useEffect(() => {
    void refresh();
    const focus = () => { void refresh(); };
    window.addEventListener('focus', focus);
    return () => { requests.current++; window.removeEventListener('focus', focus); };
  }, [refresh]);
  useEffect(() => {
    let timer: number | undefined;
    const stop = feed?.onRecord(record => {
      if (!record.files.some(file => file.path.startsWith('user/') || file.fromPath?.startsWith('user/'))) return;
      timer ??= window.setTimeout(() => { timer = undefined; void refresh(); }, 150);
    });
    return () => { stop?.(); window.clearTimeout(timer); };
  }, [feed, refresh]);
  return { ...state, refresh };
}
