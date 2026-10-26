import type { ModelOptions } from '../../shared/backend-client/index.js';
import type { ModelReference, WorkspaceModels } from '../../shared/backend-client/index.js';

export const workspaceModelKey = (value: ModelReference) => JSON.stringify([value.connectionId, value.modelId]);
export const modelReference = ({ connectionId, modelId }: ModelReference): ModelReference => ({ connectionId, modelId });
export function addWorkspaceModel(value: WorkspaceModels, model: ModelOptions): WorkspaceModels {
  if (value.models.some(m => workspaceModelKey(m) === workspaceModelKey(model))) return value;
  return { models: [...value.models, model], defaultModel: value.defaultModel ?? modelReference(model) };
}
export function removeWorkspaceModel(value: WorkspaceModels, model: ModelReference): WorkspaceModels {
  const key = workspaceModelKey(model);
  return { models: value.models.filter(m => workspaceModelKey(m) !== key), defaultModel: value.defaultModel && workspaceModelKey(value.defaultModel) === key ? null : value.defaultModel };
}
export function workspaceModelsError(value: WorkspaceModels): string | null {
  if (!value.models.length || value.models.length > 50) return 'Choose 1–50 workspace models.';
  if (!value.defaultModel || !value.models.some(m => workspaceModelKey(m) === workspaceModelKey(value.defaultModel!))) return 'Choose a default from the workspace models.';
  if (new Set(value.models.map(workspaceModelKey)).size !== value.models.length) return 'Each provider/model pair can be added once.';
  for (const model of value.models) {
    if (!model.connectionId || !model.modelId) return 'Each model needs a provider connection and model ID.';
    if (model.temperature !== undefined && (!Number.isFinite(model.temperature) || model.temperature < 0 || model.temperature > 2)) return 'Temperature must be between 0 and 2.';
    for (const field of ['maxTokens', 'contextBudget'] as const) if (model[field] !== undefined && (!Number.isSafeInteger(model[field]) || model[field]! < 1)) return 'Token limits must be positive whole numbers.';
  }
  return null;
}
