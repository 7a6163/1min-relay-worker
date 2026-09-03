/**
 * Types for 1min.ai Models API responses and cached model data
 */

export interface OneMinModelEntry {
  modelId: string;
  name: string;
  provider: string;
  /** "ACTIVE" | "DISABLED" — anything other than ACTIVE is rejected upstream */
  status: string;
  /** ISO timestamp; a date already in the past means the model is gone */
  deprecationDate?: string | null;
  features: string[];
  modality: { INPUT: string[]; OUTPUT: string[] };
  creditMetadata: Record<string, unknown>;
}

export interface OneMinModelsAPIResponse {
  models: OneMinModelEntry[];
}

export interface CachedModelData {
  chatModelIds: string[];
  imageModelIds: string[];
  visionModelIds: string[];
  codeInterpreterModelIds: string[];
  speechModelIds?: string[];
  ttsModelIds?: string[];
  entries: OneMinModelEntry[];
  fetchedAt: number;
}
