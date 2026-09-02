import { normalizePath, type App, TFile } from 'obsidian';
import type { AiQaMessage, AiQaSession } from './types';

interface SessionFile { session: AiQaSession; messages: AiQaMessage[]; }

export class AiQaSessionStore {
  private writes = new Map<string, Promise<void>>();
  constructor(private readonly app: App, private readonly folder: string) {}
  private path(id: string): string { return normalizePath(`${this.folder}/sessions/${id}.json`); }
  async list(): Promise<AiQaSession[]> {
    const folder = this.app.vault.getAbstractFileByPath(normalizePath(`${this.folder}/sessions`));
    if (!folder || !('children' in folder)) return [];
    const rows: AiQaSession[] = [];
    for (const child of (folder as { children: unknown[] }).children) if (child instanceof TFile && child.extension === 'json') {
      try { const parsed = JSON.parse(await this.app.vault.read(child)) as SessionFile; if (parsed.session && !parsed.session.archived) rows.push(parsed.session); } catch { /* ignore one damaged history entry */ }
    }
    return rows.sort((a, b) => b.updatedAt - a.updatedAt);
  }
  async read(id: string): Promise<SessionFile | null> { const file = this.app.vault.getAbstractFileByPath(this.path(id)); if (!(file instanceof TFile)) return null; try { return JSON.parse(await this.app.vault.read(file)) as SessionFile; } catch { return null; } }
  async write(value: SessionFile): Promise<void> {
    const id = value.session.id;
    const previous = this.writes.get(id) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(async () => {
      await this.ensureFolder();
      const path = this.path(id); const file = this.app.vault.getAbstractFileByPath(path); const content = JSON.stringify(value, null, 2);
      if (file instanceof TFile) await this.app.vault.modify(file, content); else await this.app.vault.create(path, content);
    });
    this.writes.set(id, next);
    await next;
    if (this.writes.get(id) === next) this.writes.delete(id);
  }
  private async ensureFolder(): Promise<void> { for (const path of [this.folder, `${this.folder}/sessions`]) if (!this.app.vault.getAbstractFileByPath(normalizePath(path))) await this.app.vault.createFolder(normalizePath(path)); }
}
