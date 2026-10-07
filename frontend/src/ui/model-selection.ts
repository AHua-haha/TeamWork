import type { AgentSettings, ConfigRecord, ConnectionView, ModelChoice, ModelOptions, ReasoningLevel, SentReasoningLevel } from '../client/config-client.js';

export interface ModelEntry {
  connection: ConfigRecord<ConnectionView>;
  model: ModelChoice;
}
export type ModelSettings = Omit<ModelOptions, 'connectionId' | 'modelId'>;
export type SettingField = keyof ModelSettings;

export function modelKey(entry: ModelEntry): string {
  return `${entry.connection.id}/${entry.model.modelId}`;
}

export function selectedModel(entries: ModelEntry[], settings: AgentSettings | null): ModelEntry | undefined {
  return entries.find(entry => entry.connection.id === settings?.connectionId && entry.model.modelId === settings.modelId);
}

/** Selecting a model changes only the selection; every model keeps its own settings entry. */
export function selectModel(settings: AgentSettings, entry: ModelEntry): AgentSettings {
  return { ...settings, connectionId: entry.connection.id, modelId: entry.model.modelId };
}

const matches = (options: ModelOptions, entry: ModelEntry) => options.connectionId === entry.connection.id && options.modelId === entry.model.modelId;

/** This conversation's saved settings for one model; omitted fields use the model defaults. */
export function modelSettings(settings: AgentSettings, entry: ModelEntry): ModelSettings {
  const { connectionId: _connectionId, modelId: _modelId, ...rest } = settings.modelOptions.find(options => matches(options, entry)) ?? { connectionId: '', modelId: '' };
  return rest;
}

/** Replaces one model's settings, leaving other models' entries untouched. An entry with no values is removed. */
export function withModelSettings(settings: AgentSettings, entry: ModelEntry, values: ModelSettings): AgentSettings {
  const defined = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) as ModelSettings;
  const others = settings.modelOptions.filter(options => !matches(options, entry));
  const modelOptions = Object.keys(defined).length
    ? [...others, { connectionId: entry.connection.id, modelId: entry.model.modelId, ...defined }]
    : others;
  return { ...settings, modelOptions };
}

export function effectiveReasoning(model: ModelChoice, values: ModelSettings): ReasoningLevel | null {
  return values.reasoning ?? model.defaultReasoning;
}

/** The level Pi sends for a scale level when this model clamps it to another supported level; otherwise undefined. */
export function clampedTo(model: ModelChoice, level: ReasoningLevel | null): SentReasoningLevel | undefined {
  const sent = level ? model.reasoningSentAs[level] : undefined;
  return sent !== level ? sent : undefined;
}

/** Number of rarely changed values (output, temperature, context budget) set away from the model default. */
export function customizedCount(values: ModelSettings): number {
  return [values.maxTokens, values.temperature, values.contextBudget].filter(value => value !== undefined).length;
}

/** Saved values that do not fit the model; the user must change them before a run. */
export function misfits(model: ModelChoice, values: ModelSettings): Partial<Record<SettingField, string>> {
  const result: Partial<Record<SettingField, string>> = {};
  if (values.reasoning !== undefined && !model.reasoningLevels.includes(values.reasoning)) result.reasoning = 'This model does not support reasoning';
  if (values.maxTokens !== undefined && values.maxTokens > model.maxTokens) result.maxTokens = `Exceeds this model's ${model.maxTokens.toLocaleString()} limit`;
  if (values.contextBudget !== undefined && values.contextBudget > model.contextWindow) result.contextBudget = `Exceeds this model's ${model.contextWindow.toLocaleString()} context window`;
  if (values.temperature !== undefined && (values.temperature < 0 || values.temperature > 2)) result.temperature = 'Must be between 0 and 2';
  return result;
}
