import type { AiQaModel, AiQaProvider, AiQaSettings } from '../settings';

export interface AiQaSession { id: string; title: string; createdAt: number; updatedAt: number; archived: boolean; model?: { providerId: string; modelId: string }; webEnabled: boolean; mode: 'normal' | 'deep'; sourceIds?: string[]; }
export interface AiQaAttachment { id: string; name: string; mimeType: string; size: number; path: string; text?: string; }
export interface AiQaCitation { title: string; source: string; url?: string; excerpt?: string; kind?: 'internal' | 'external' | 'tool'; score?: number; }
export interface AiQaStep { id: string; kind: 'thinking' | 'retrieval' | 'web' | 'tool' | 'answer'; label: string; detail?: string; status: 'pending' | 'active' | 'done' | 'error'; count?: number; elapsedMs?: number; }
export interface AiQaMessage { id: string; sessionId: string; role: 'user' | 'assistant' | 'tool'; content: string; createdAt: number; delivery: 'pending' | 'streaming' | 'complete' | 'failed' | 'cancelled'; attachments?: AiQaAttachment[]; citations?: AiQaCitation[]; steps?: AiQaStep[]; error?: string; }
export interface AiQaEvent { type: string; runId: string; sequence: number; payload: Record<string, unknown>; }
export interface AiQaRuntimeConfig { settings: AiQaSettings; saveSettings: () => Promise<void>; }
export type { AiQaModel, AiQaProvider, AiQaSettings };
