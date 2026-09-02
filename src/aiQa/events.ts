import type { AiQaEvent } from './types';

/** Parse complete SSE frames and retain an incomplete tail for the next read. */
export function parseSseChunk(buffer: string, onEvent: (event: AiQaEvent) => void): string {
  const frames = buffer.split(/\r?\n\r?\n/);
  const remainder = frames.pop() ?? '';
  for (const frame of frames) {
    const dataLines: string[] = [];
    let wireType = '';
    for (const line of frame.split(/\r?\n/)) {
      if (!line || line.startsWith(':')) continue;
      if (line.startsWith('event:')) wireType = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    }
    if (!dataLines.length) continue;
    const data = dataLines.join('\n');
    if (data === '[DONE]') { onEvent({ type: 'done', runId: 'provider', sequence: 0, payload: {} }); continue; }
    try {
      const raw = JSON.parse(data) as Record<string, unknown>;
      const type = typeof raw.type === 'string' ? raw.type : wireType || 'message.delta';
      const runId = typeof raw.run_id === 'string' ? raw.run_id : typeof raw.id === 'string' ? raw.id : 'provider';
      const sequence = typeof raw.sequence === 'number' ? raw.sequence : 0;
      const payload = raw.payload && typeof raw.payload === 'object' ? raw.payload as Record<string, unknown> : raw;
      onEvent({ type, runId, sequence, payload });
    } catch { /* tolerate provider keep-alive or non-JSON comments */ }
  }
  return remainder;
}
