import type { AiQaProvider } from '../settings';
import { parseSseChunk } from './events';
import type { AiQaEvent } from './types';

export interface AiQaRequest {
  provider: AiQaProvider;
  apiKey: string;
  model: string;
  messages: Array<{ role: string; content: unknown }>;
  reasoningEffort?: string;
  webEnabled?: boolean;
  supportsTools?: boolean;
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

export function normalizeOpenAiBaseUrl(input: string): string {
  let base = input.trim().replace(/\/+$/, '').replace(/\/(?:chat\/completions|responses|models)$/i, '');
  if (!base) return base;
  try {
    const url = new URL(base);
    // Most OpenAI-compatible gateways expose /v1, while custom paths such as
    // /openai/v1 must be preserved exactly as entered.
    if (!/\/v\d+(?:\/|$)/i.test(url.pathname) && (url.pathname === '' || url.pathname === '/') && (url.protocol === 'https:' || url.protocol === 'http:')) url.pathname = '/v1';
    return url.toString().replace(/\/$/, '');
  } catch { return base; }
}

function readText(payload: Record<string, unknown>): string {
  if (typeof payload.delta === 'string') return payload.delta;
  if (typeof payload.text === 'string') return payload.text;
  if (typeof payload.output_text_delta === 'string') return payload.output_text_delta;
  const choices = payload.choices;
  if (Array.isArray(choices)) {
    const delta = choices[0] && typeof choices[0] === 'object' ? (choices[0] as Record<string, unknown>).delta : undefined;
    if (delta && typeof delta === 'object' && typeof (delta as Record<string, unknown>).content === 'string') return (delta as Record<string, string>).content;
    const text = choices[0] && typeof choices[0] === 'object' ? (choices[0] as Record<string, unknown>).text : undefined;
    if (typeof text === 'string') return text;
  }
  return '';
}

function errorBody(status: number, body: string): Error {
  let detail = body.trim();
  try {
    const parsed = JSON.parse(detail) as Record<string, unknown>;
    const error = parsed.error;
    detail = typeof error === 'object' && error && typeof (error as Record<string, unknown>).message === 'string'
      ? String((error as Record<string, unknown>).message) : typeof parsed.message === 'string' ? parsed.message : detail;
  } catch { /* keep provider text */ }
  const hint = status === 404 ? ' 请检查 API 地址是否为提供方的 OpenAI 根地址，并确认协议模式。' : status === 401 ? ' 请检查 API Key。' : '';
  return new Error(`模型请求失败 (${status})${detail ? `：${detail.slice(0, 240)}` : ''}${hint}`);
}

function nodeStreamRequest(url: string, body: string, apiKey: string, signal?: AbortSignal): Promise<Response> {
  return new Promise((resolve, reject) => {
    try {
      const nodeRequire = typeof require === 'function' ? require : undefined;
      const target = new URL(url); const client = nodeRequire?.(target.protocol === 'https:' ? 'https' : 'http');
      if (!client) return reject(new Error('当前 Obsidian 不支持 Node 流式网络通道'));
      const request = client.request({ protocol: target.protocol, hostname: target.hostname, port: target.port || undefined, path: `${target.pathname}${target.search}`, method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', Authorization: `Bearer ${apiKey}` } });
      let status = 0; let headers: Record<string, string> = {}; let settled = false; let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
      const stream = new ReadableStream<Uint8Array>({ start(next) { controller = next; } });
      const fail = (error: unknown) => { if (settled) return; settled = true; controller?.error(error); reject(error); };
      request.on('response', (response: { statusCode?: number; headers?: Record<string, string | string[]>; on: Function }) => {
        status = response.statusCode ?? 0; headers = Object.fromEntries(Object.entries(response.headers ?? {}).map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : String(value)]));
        if (!settled) { settled = true; resolve(new Response(stream, { status, headers })); }
        response.on('data', (chunk: Buffer | Uint8Array) => controller?.enqueue(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk)));
        response.on('end', () => controller?.close());
        response.on('error', fail);
      });
      request.on('error', fail);
      const abort = () => { try { request.abort(); } catch { /* already closed */ } reject(new DOMException('The operation was aborted', 'AbortError')); };
      if (signal?.aborted) return abort(); signal?.addEventListener('abort', abort, { once: true });
      request.write(body); request.end();
    } catch (error) { reject(error); }
  });
}

/** Stream OpenAI Chat Completions or Responses into one native-SAG-like event shape. */
export async function streamOpenAi(request: AiQaRequest, onEvent: (event: AiQaEvent) => void): Promise<void> {
  const base = normalizeOpenAiBaseUrl(request.provider.baseUrl);
  if (!base) throw new Error('模型 API 地址为空');
  const responses = request.provider.protocol === 'openai-responses';
  const url = `${base}/${responses ? 'responses' : 'chat/completions'}`;
  const body = responses ? {
    model: request.model,
    stream: true,
    input: request.messages,
    ...(request.maxOutputTokens ? { max_output_tokens: request.maxOutputTokens } : {}),
    ...(request.reasoningEffort ? { reasoning: { effort: request.reasoningEffort } } : {}),
    ...(request.webEnabled && request.supportsTools !== false ? { tools: [{ type: 'web_search_preview' }] } : {}),
  } : {
    model: request.model,
    stream: true,
    messages: request.messages,
    ...(request.maxOutputTokens ? { max_tokens: request.maxOutputTokens } : {}),
    ...(request.reasoningEffort ? { reasoning_effort: request.reasoningEffort } : {}),
    ...(request.webEnabled && request.supportsTools !== false ? { tools: [{ type: 'web_search_preview' }] } : {}),
  };
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', Authorization: `Bearer ${request.apiKey}` },
      body: JSON.stringify(body),
      signal: request.signal,
    });
  } catch (error) {
    if (request.signal?.aborted) throw error;
    try { response = await nodeStreamRequest(url, JSON.stringify(body), request.apiKey, request.signal); }
    catch (fallbackError) { throw new Error(`${error instanceof Error ? error.message : String(error)}；Node 流式回退失败：${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`); }
  }
  if (!response.ok) throw errorBody(response.status, await response.text());
  if (!response.body) throw new Error('模型未返回流式响应');
  const runId = crypto.randomUUID();
  let sequence = 0;
  let terminal = false;
  const emit = (type: string, payload: Record<string, unknown> = {}) => onEvent({ type, runId, sequence: sequence++, payload });
  emit('run.started');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const handle = (event: AiQaEvent) => {
    const text = readText(event.payload);
    if (text) emit('message.delta', { delta: text });
    const type = event.type.toLowerCase();
    if (type === 'response.completed' || type === 'response.done' || type === 'message.completed' || type === 'run.completed' || type === 'done') { if (!terminal) emit('run.completed', event.payload); terminal = true; }
    if (type === 'response.failed' || type === 'run.failed') { terminal = true; emit('run.failed', event.payload); }
  };
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      buffer += decoder.decode(next.value, { stream: true });
      buffer = parseSseChunk(buffer, handle);
    }
    buffer += decoder.decode();
    if (buffer.trim()) parseSseChunk(`${buffer}\n\n`, handle);
  } finally { reader.releaseLock(); }
  if (!terminal) emit('run.completed');
}
