import { builtinModels } from '@earendil-works/pi-ai/providers/all';
import { modelflareProvider } from './providers/modelflare.js';

/** All backend-owned providers are composed here before configuration or runtime starts. */
export function createBackendModels() {
  const models = builtinModels();
  models.setProvider(modelflareProvider(models));
  return models;
}
