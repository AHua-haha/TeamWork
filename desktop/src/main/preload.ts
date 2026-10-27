import { contextBridge, ipcRenderer } from 'electron';

const apiBase = ipcRenderer.sendSync('desktop:get-api-base') as unknown;
if (typeof apiBase === 'string') contextBridge.exposeInMainWorld('desktopAPI', Object.freeze({ apiBase }));
