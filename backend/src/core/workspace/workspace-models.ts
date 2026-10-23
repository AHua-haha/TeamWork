import { emptyRunSettings, keys, obj, validateRunSettings, type ModelOptions, type RunSettings } from '../team/config.js';
import { AppError } from '../agent/types.js';

export interface ModelReference { connectionId: string; modelId: string }
export interface WorkspaceModels { models: ModelOptions[]; defaultModel: ModelReference | null }
export interface StoredWorkspaceModels { revision: number; value: WorkspaceModels }
export interface WorkspaceModelsView extends StoredWorkspaceModels { issues: string[] }
export const emptyWorkspaceModels = (): WorkspaceModels => ({ models: [], defaultModel: null });
export const sameModel = (a: ModelReference | null, b: ModelReference | null) => !!a && !!b && a.connectionId === b.connectionId && a.modelId === b.modelId;
export function workspaceModels(value: unknown, allowEmpty = false): WorkspaceModels {
  const data = obj(value, 'Workspace models'); keys(data, ['models', 'defaultModel']);
  if (!Array.isArray(data.models) || data.models.length > 50 || (!allowEmpty && !data.models.length)) throw new AppError('invalid_config', 'Choose 1–50 workspace models');
  const models = validateRunSettings({ ...emptyRunSettings, modelOptions: data.models }).modelOptions;
  if (!models.length && data.defaultModel === null && allowEmpty) return emptyWorkspaceModels();
  const ref = obj(data.defaultModel, 'Default model'); keys(ref, ['connectionId', 'modelId']);
  const selected = models.find(m => m.connectionId === ref.connectionId && m.modelId === ref.modelId);
  if (!selected) throw new AppError('invalid_config', 'The default must be one of the workspace models');
  return { models, defaultModel: { connectionId: selected.connectionId, modelId: selected.modelId } };
}
export function modelRunSettings(model: ModelOptions): RunSettings {
  return { ...emptyRunSettings, connectionId: model.connectionId, modelId: model.modelId, modelOptions: [{ ...model }] };
}
export function defaultRunSettings(value: WorkspaceModels): RunSettings {
  const selected = value.models.find(m => sameModel(m, value.defaultModel));
  if (!selected) throw new AppError('invalid_config', 'Configure a default model in workspace model settings', 409);
  return modelRunSettings(selected);
}
