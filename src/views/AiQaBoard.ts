import { Component, MarkdownRenderer, Menu, Notice, normalizePath, setIcon, TFile, type App } from 'obsidian';
import type Dashboard from '../main';
import { AiQaSessionStore } from '../aiQa/store';
import { streamOpenAi } from '../aiQa/transport';
import { AiQaMcpClient } from '../aiQa/mcp';
import type { AiQaAttachment, AiQaCitation, AiQaMessage, AiQaSession, AiQaStep } from '../aiQa/types';
import type { AiQaMcpServer } from '../settings';

export interface AiQaBoardHost {
  app: App;
  plugin: Dashboard;
  boardEl: HTMLElement | null;
  currentPage: 'home' | 'project' | 'opportunity' | 'daily-report' | 'ai-qa';
  exitEditMode(): void;
}

type ModelRef = { providerId: string; modelId: string };
type SearchHit = { file: TFile; excerpt: string; score: number };
type SagSource = { id: string; name: string; documents?: number; chunks?: number };
type SagHit = { sourceId?: string; title: string; excerpt: string; score?: number };

function modelKey(ref: ModelRef): string { return `${ref.providerId}::${ref.modelId}`; }
function escapeHtml(value: string): string { const el = document.createElement('div'); el.textContent = value; return el.innerHTML; }
function formatTime(value: number): string { return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); }
function trimToContext(messages: Array<{ role: string; content: unknown }>, contextWindow: number, maxOutputTokens: number): Array<{ role: string; content: unknown }> {
  const budget = Math.max(4_000, (Math.max(8_000, contextWindow || 128_000) - Math.max(256, maxOutputTokens || 8_192)) * 4);
  const size = (content: unknown) => typeof content === 'string' ? content.length : JSON.stringify(content).length;
  let total = messages.reduce((sum, item) => sum + size(item.content), 0);
  const kept = [...messages];
  while (total > budget && kept.length > 2) { const removed = kept.splice(0, 2); total -= removed.reduce((sum, item) => sum + size(item.content), 0); }
  return kept;
}

/** Dashboard-native implementation of the SAG conversation workspace pattern. */
export class AiQaBoard {
  private readonly host: AiQaBoardHost;
  private readonly store: AiQaSessionStore;
  private sessions: AiQaSession[] = [];
  private active: AiQaSession | null = null;
  private messages: AiQaMessage[] = [];
  private transcript: HTMLElement | null = null;
  private history: HTMLElement | null = null;
  private titleEl: HTMLElement | null = null;
  private input: HTMLTextAreaElement | null = null;
  private modelSelect: HTMLSelectElement | null = null;
  private reasoningSelect: HTMLSelectElement | null = null;
  private modeSelect: HTMLSelectElement | null = null;
  private webToggle: HTMLInputElement | null = null;
  private attachmentList: HTMLElement | null = null;
  private sendButton: HTMLButtonElement | null = null;
  private stopButton: HTMLButtonElement | null = null;
  private statusEl: HTMLElement | null = null;
  private scopeSummary: HTMLElement | null = null;
  private scopePanel: HTMLElement | null = null;
  private sagSources: SagSource[] = [];
  private selectedSourceIds: string[] = [];
  private abort?: AbortController;
  private pendingFiles: File[] = [];
  private persistTimer: number | null = null;
  private renderVersion = 0;
  private renderedComponents: Component[] = [];

  constructor(host: AiQaBoardHost) { this.host = host; this.store = new AiQaSessionStore(host.app, host.plugin.settings.aiQa.sessionFolder || 'AI问答'); }

  dispose(): void {
    this.abort?.abort(); this.abort = undefined;
    if (this.persistTimer !== null) window.clearTimeout(this.persistTimer);
    this.renderedComponents.forEach((component) => component.unload()); this.renderedComponents = [];
    this.pendingFiles = [];
  }

  async show(): Promise<void> {
    const root = this.host.boardEl; if (!root) return;
    this.host.exitEditMode(); root.empty(); root.removeClass('mq-ad-board', 'mq-po-board', 'mq-op-board', 'mq-dr-board'); root.addClass('mq-ai-qa-board'); this.host.currentPage = 'ai-qa';
    this.mount(root); await this.refreshSessions();
  }

  private mount(root: HTMLElement): void {
    const style = root.createEl('style');
    style.textContent = `
      .mq-ai-qa-board{display:grid;grid-template-columns:248px minmax(0,1fr);height:min(760px,calc(100vh - 170px));min-height:560px;background:var(--background-primary);border:1px solid var(--background-modifier-border);border-radius:12px;overflow:hidden;color:var(--text-normal)}
      .mq-ai-qa-board .qa-side{display:flex;flex-direction:column;background:var(--background-secondary);border-right:1px solid var(--background-modifier-border);min-width:0}
      .mq-ai-qa-board .qa-side-head{padding:17px 14px 12px;border-bottom:1px solid var(--background-modifier-border)}
      .mq-ai-qa-board .qa-brand{display:flex;align-items:center;gap:9px;font-size:15px;font-weight:650;letter-spacing:.01em}.mq-ai-qa-board .qa-brand-mark{display:grid;place-items:center;width:28px;height:28px;border-radius:8px;background:var(--interactive-accent);color:var(--text-on-accent)}
      .mq-ai-qa-board .qa-new{display:flex;align-items:center;gap:8px;width:100%;margin-top:14px;padding:9px 11px;border:1px solid var(--background-modifier-border);border-radius:8px;background:var(--background-primary);font-size:13px;cursor:pointer}.mq-ai-qa-board .qa-new:hover{border-color:var(--interactive-accent);color:var(--interactive-accent)}
      .mq-ai-qa-board .qa-history{flex:1;overflow:auto;padding:10px 8px}.mq-ai-qa-board .qa-history-label{padding:4px 8px 7px;color:var(--text-muted);font-size:11px;text-transform:uppercase;letter-spacing:.08em}.mq-ai-qa-board .qa-history-item{display:flex;align-items:center;gap:7px;width:100%;padding:9px 8px;margin:2px 0;border:0;border-radius:7px;background:transparent;color:var(--text-normal);text-align:left;cursor:pointer}.mq-ai-qa-board .qa-history-item:hover{background:var(--background-modifier-hover)}.mq-ai-qa-board .qa-history-item.is-active{background:color-mix(in srgb,var(--interactive-accent) 14%,transparent);color:var(--interactive-accent)}.mq-ai-qa-board .qa-history-item .qa-history-copy{min-width:0;flex:1}.mq-ai-qa-board .qa-history-title{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}.mq-ai-qa-board .qa-history-time{display:block;margin-top:3px;color:var(--text-muted);font-size:10px}
      .mq-ai-qa-board .qa-main{display:flex;flex-direction:column;min-width:0;background:var(--background-primary)}.mq-ai-qa-board .qa-header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 22px;border-bottom:1px solid var(--background-modifier-border)}.mq-ai-qa-board .qa-title-wrap{min-width:0}.mq-ai-qa-board .qa-title{margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:16px;font-weight:650}.mq-ai-qa-board .qa-subtitle{margin-top:4px;color:var(--text-muted);font-size:11px}.mq-ai-qa-board .qa-header-actions{display:flex;gap:4px}.mq-ai-qa-board .qa-icon{display:grid;place-items:center;width:30px;height:30px;border:0;border-radius:7px;background:transparent;color:var(--text-muted);cursor:pointer}.mq-ai-qa-board .qa-icon:hover{background:var(--background-modifier-hover);color:var(--text-normal)}
      .mq-ai-qa-board .qa-transcript{flex:1;overflow:auto;padding:24px clamp(14px,5vw,72px)}.mq-ai-qa-board .qa-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;min-height:280px;text-align:center;color:var(--text-muted)}.mq-ai-qa-board .qa-empty-mark{display:grid;place-items:center;width:44px;height:44px;margin-bottom:13px;border-radius:12px;background:color-mix(in srgb,var(--interactive-accent) 14%,transparent);color:var(--interactive-accent)}.mq-ai-qa-board .qa-empty strong{color:var(--text-normal);font-size:17px}.mq-ai-qa-board .qa-empty span{max-width:420px;margin-top:7px;font-size:12px;line-height:1.7}
      .mq-ai-qa-board .qa-message{max-width:850px;margin:0 auto 24px}.mq-ai-qa-board .qa-message.qa-user{display:flex;justify-content:flex-end}.mq-ai-qa-board .qa-user-bubble{max-width:min(720px,90%);padding:11px 14px;border-radius:12px 12px 3px 12px;background:var(--interactive-accent);color:var(--text-on-accent);font-size:13px;line-height:1.65;white-space:pre-wrap}.mq-ai-qa-board .qa-ai-row{display:flex;gap:11px}.mq-ai-qa-board .qa-ai-avatar{display:grid;flex:0 0 auto;place-items:center;width:28px;height:28px;border-radius:8px;background:var(--background-secondary-alt);color:var(--interactive-accent)}.mq-ai-qa-board .qa-ai-content{min-width:0;flex:1}.mq-ai-qa-board .qa-ai-label{margin:3px 0 8px;color:var(--text-muted);font-size:11px}.mq-ai-qa-board .qa-markdown{font-size:13px;line-height:1.75}.mq-ai-qa-board .qa-markdown p{margin:0 0 10px}.mq-ai-qa-board .qa-markdown p:last-child{margin-bottom:0}.mq-ai-qa-board .qa-markdown pre{overflow:auto;padding:10px;border-radius:7px;background:var(--background-secondary);font-size:12px}.mq-ai-qa-board .qa-markdown code{font-family:var(--font-monospace)}.mq-ai-qa-board .qa-markdown a{color:var(--text-accent)}
      .mq-ai-qa-board .qa-steps{margin:0 0 11px;border:1px solid var(--background-modifier-border);border-radius:8px;background:var(--background-secondary)}.mq-ai-qa-board .qa-steps summary{padding:8px 10px;color:var(--text-muted);font-size:11px;cursor:pointer}.mq-ai-qa-board .qa-step{display:flex;align-items:flex-start;gap:8px;padding:7px 10px;border-top:1px solid var(--background-modifier-border);font-size:11px}.mq-ai-qa-board .qa-step-dot{width:7px;height:7px;margin-top:4px;border-radius:50%;background:var(--text-muted)}.mq-ai-qa-board .qa-step-dot.active{background:var(--interactive-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--interactive-accent) 17%,transparent)}.mq-ai-qa-board .qa-step-dot.error{background:var(--text-error)}.mq-ai-qa-board .qa-step-detail{display:block;margin-top:2px;color:var(--text-muted)}
      .mq-ai-qa-board .qa-citations{display:flex;flex-wrap:wrap;gap:6px;margin-top:11px}.mq-ai-qa-board .qa-citation{display:inline-flex;align-items:center;gap:5px;max-width:250px;padding:5px 8px;border:1px solid var(--background-modifier-border);border-radius:6px;background:var(--background-secondary);color:var(--text-muted);font-size:11px;cursor:pointer}.mq-ai-qa-board .qa-citation:hover{border-color:var(--interactive-accent);color:var(--interactive-accent)}
      .mq-ai-qa-board .qa-scope{margin:7px 9px 0;border-top:1px solid var(--background-modifier-border);padding-top:6px}.mq-ai-qa-board .qa-scope summary{display:flex;align-items:center;gap:5px;padding:4px 2px;color:var(--text-muted);font-size:11px;cursor:pointer;list-style:none}.mq-ai-qa-board .qa-scope summary::-webkit-details-marker{display:none}.mq-ai-qa-board .qa-scope summary:before{content:'+';display:inline-grid;place-items:center;width:15px;height:15px;border:1px solid var(--background-modifier-border);border-radius:4px;color:var(--interactive-accent);font-size:13px}.mq-ai-qa-board .qa-scope[open] summary:before{content:'-'} .mq-ai-qa-board .qa-scope-panel{display:flex;flex-direction:column;gap:3px;padding:4px 0 7px}.mq-ai-qa-board .qa-scope-row{display:flex;align-items:flex-start;gap:6px;padding:4px 2px;color:var(--text-muted);font-size:11px;cursor:pointer}.mq-ai-qa-board .qa-scope-row:hover{color:var(--text-normal)}.mq-ai-qa-board .qa-scope-row input{margin:2px 0 0;accent-color:var(--interactive-accent)}.mq-ai-qa-board .qa-scope-meta{display:block;margin-left:21px;color:var(--text-faint);font-size:10px}
      .mq-ai-qa-board .qa-error{margin-top:8px;padding:8px 10px;border-left:3px solid var(--text-error);border-radius:4px;background:color-mix(in srgb,var(--text-error) 8%,transparent);color:var(--text-error);font-size:12px}.mq-ai-qa-board .qa-actions{display:flex;gap:4px;margin-top:8px}.mq-ai-qa-board .qa-actions button{padding:3px 7px;border:0;border-radius:5px;background:transparent;color:var(--text-muted);font-size:11px;cursor:pointer}.mq-ai-qa-board .qa-actions button:hover{background:var(--background-modifier-hover);color:var(--text-normal)}
      .mq-ai-qa-board .qa-composer{padding:12px clamp(14px,5vw,72px) 14px;border-top:1px solid var(--background-modifier-border)}.mq-ai-qa-board .qa-composer-box{border:1px solid var(--background-modifier-border);border-radius:10px;background:var(--background-secondary);box-shadow:0 3px 12px color-mix(in srgb,var(--background-modifier-box-shadow) 28%,transparent)}.mq-ai-qa-board .qa-attachments{display:flex;flex-wrap:wrap;gap:6px;padding:9px 11px 0}.mq-ai-qa-board .qa-attachment{display:flex;align-items:center;gap:5px;max-width:220px;padding:5px 7px;border:1px solid var(--background-modifier-border);border-radius:6px;background:var(--background-primary);font-size:11px}.mq-ai-qa-board .qa-attachment span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.mq-ai-qa-board .qa-attachment button{border:0;background:transparent;color:var(--text-muted);cursor:pointer}.mq-ai-qa-board .qa-input{display:block;width:100%;min-height:70px;max-height:180px;padding:11px 12px;border:0;resize:vertical;background:transparent;color:var(--text-normal);font-size:13px;line-height:1.6;outline:none}.mq-ai-qa-board .qa-input::placeholder{color:var(--text-faint)}.mq-ai-qa-board .qa-composer-bar{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 9px;border-top:1px solid var(--background-modifier-border)}.mq-ai-qa-board .qa-controls{display:flex;align-items:center;flex-wrap:wrap;gap:5px;min-width:0}.mq-ai-qa-board .qa-control,.mq-ai-qa-board .qa-select{height:28px;padding:0 8px;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--text-muted);font-size:11px}.mq-ai-qa-board .qa-control:hover,.mq-ai-qa-board .qa-select:hover{background:var(--background-modifier-hover);color:var(--text-normal)}.mq-ai-qa-board .qa-select{max-width:190px;border-color:var(--background-modifier-border);background:var(--background-primary)}.mq-ai-qa-board .qa-online{display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 8px;border-radius:6px;color:var(--text-muted);font-size:11px;cursor:pointer}.mq-ai-qa-board .qa-online:has(input:checked){background:color-mix(in srgb,var(--interactive-accent) 13%,transparent);color:var(--interactive-accent)}.mq-ai-qa-board .qa-online input{accent-color:var(--interactive-accent)}.mq-ai-qa-board .qa-send{display:grid;place-items:center;width:32px;height:32px;border:0;border-radius:8px;background:var(--interactive-accent);color:var(--text-on-accent);cursor:pointer}.mq-ai-qa-board .qa-send:disabled{opacity:.45;cursor:not-allowed}.mq-ai-qa-board .qa-status{padding:0 11px 8px;color:var(--text-muted);font-size:10px}.mq-ai-qa-board .qa-status.error{color:var(--text-error)}
      @media(max-width:760px){.mq-ai-qa-board{grid-template-columns:1fr;height:auto;min-height:650px}.mq-ai-qa-board .qa-side{max-height:180px;border-right:0;border-bottom:1px solid var(--background-modifier-border)}.mq-ai-qa-board .qa-history{display:flex;gap:4px;overflow-x:auto}.mq-ai-qa-board .qa-history-label{display:none}.mq-ai-qa-board .qa-history-item{min-width:145px}.mq-ai-qa-board .qa-header{padding:13px 15px}.mq-ai-qa-board .qa-transcript,.mq-ai-qa-board .qa-composer{padding-left:13px;padding-right:13px}.mq-ai-qa-board .qa-composer-bar{align-items:flex-end}.mq-ai-qa-board .qa-select{max-width:145px}}
    `;
    const side = root.createDiv({ cls: 'qa-side' });
    const sideHead = side.createDiv({ cls: 'qa-side-head' });
    const brand = sideHead.createDiv({ cls: 'qa-brand' }); const mark = brand.createSpan({ cls: 'qa-brand-mark' }); setIcon(mark, 'sparkles'); brand.createSpan({ text: 'AI 问答' });
    const add = sideHead.createEl('button', { cls: 'qa-new' }); setIcon(add.createSpan(), 'plus'); add.createSpan({ text: '新建问答' }); add.addEventListener('click', () => void this.newSession());
    this.history = side.createDiv({ cls: 'qa-history' });
    const main = root.createDiv({ cls: 'qa-main' });
    const header = main.createDiv({ cls: 'qa-header' }); const titleWrap = header.createDiv({ cls: 'qa-title-wrap' }); this.titleEl = titleWrap.createEl('h2', { cls: 'qa-title', text: 'AI 问答' }); titleWrap.createDiv({ cls: 'qa-subtitle', text: '内嵌会话工作区 · 流式输出与证据可追溯' });
    const headerActions = header.createDiv({ cls: 'qa-header-actions' }); const clear = headerActions.createEl('button', { cls: 'qa-icon', attr: { 'aria-label': '清空当前会话' } }); setIcon(clear, 'trash-2'); clear.addEventListener('click', () => void this.clearSession());
    this.transcript = main.createDiv({ cls: 'qa-transcript' });
    const composer = main.createDiv({ cls: 'qa-composer' }); const box = composer.createDiv({ cls: 'qa-composer-box' }); this.attachmentList = box.createDiv({ cls: 'qa-attachments' });
    this.input = box.createEl('textarea', { cls: 'qa-input', placeholder: '输入问题，Enter 发送，Shift + Enter 换行；可粘贴图片或拖入文件' });
    this.input.addEventListener('paste', (event) => this.handlePaste(event)); this.input.addEventListener('drop', (event) => { event.preventDefault(); this.addFiles(Array.from(event.dataTransfer?.files ?? [])); }); this.input.addEventListener('dragover', (event) => event.preventDefault()); this.input.addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); void this.submit(); } });
    const bar = box.createDiv({ cls: 'qa-composer-bar' }); const controls = bar.createDiv({ cls: 'qa-controls' });
    const fileButton = controls.createEl('label', { cls: 'qa-control', attr: { title: '添加文件' } }); setIcon(fileButton.createSpan(), 'paperclip'); fileButton.createSpan({ text: '附件' }); const fileInput = fileButton.createEl('input', { type: 'file', attr: { multiple: 'true' } }); fileInput.style.display = 'none'; fileInput.addEventListener('change', () => { this.addFiles(Array.from(fileInput.files ?? [])); fileInput.value = ''; });
    const modeLabel = controls.createSpan({ text: '模式' }); modeLabel.style.cssText = 'font-size:11px;color:var(--text-muted);margin-left:4px'; this.modeSelect = controls.createEl('select', { cls: 'qa-select', attr: { 'aria-label': '问答模式' } }); this.modeSelect.createEl('option', { value: 'normal', text: '普通问答' }); this.modeSelect.createEl('option', { value: 'deep', text: '深度研究' }); this.modeSelect.addEventListener('change', () => { if (this.active) { this.active.mode = this.modeSelect!.value as 'normal' | 'deep'; void this.persist(); } });
    this.webToggle = controls.createEl('input', { type: 'checkbox' }); const online = controls.createEl('label', { cls: 'qa-online' }); online.appendChild(this.webToggle); online.createSpan({ text: '联网' }); this.webToggle.disabled = !this.host.plugin.settings.aiQa.webModel; this.webToggle.addEventListener('change', () => { if (this.active) { this.active.webEnabled = this.webToggle!.checked; void this.persist(); } });
    const mcp = controls.createEl('button', { cls: 'qa-control' }); setIcon(mcp.createSpan(), 'wrench'); mcp.createSpan({ text: 'MCP' }); mcp.addEventListener('click', () => void this.inspectMcp());
    this.modelSelect = controls.createEl('select', { cls: 'qa-select', attr: { 'aria-label': '选择模型' } }); this.modelSelect.addEventListener('change', () => this.renderReasoningOptions());
    this.reasoningSelect = controls.createEl('select', { cls: 'qa-select', attr: { 'aria-label': '思考强度' } });
    this.sendButton = bar.createEl('button', { cls: 'qa-send', attr: { 'aria-label': '发送' } }); setIcon(this.sendButton, 'send'); this.sendButton.addEventListener('click', () => void this.submit()); this.stopButton = bar.createEl('button', { cls: 'qa-send', attr: { 'aria-label': '停止生成' } }); setIcon(this.stopButton, 'square'); this.stopButton.style.display = 'none'; this.stopButton.addEventListener('click', () => this.abort?.abort());
    const scope = box.createEl('details', { cls: 'qa-scope' }); this.scopeSummary = scope.createEl('summary', { text: '知识库：全部' }); this.scopePanel = scope.createDiv({ cls: 'qa-scope-panel' }); scope.addEventListener('toggle', () => { if (scope.open && !this.sagSources.length) void this.loadSagSources(); });
    this.statusEl = composer.createDiv({ cls: 'qa-status' });
    this.renderModelOptions(); this.renderReasoningOptions(); this.renderAttachments(); this.renderScope(); void this.loadSagSources();
  }

  private async refreshSessions(): Promise<void> {
    this.sessions = await this.store.list(); this.renderHistory();
    if (this.active && this.sessions.some((item) => item.id === this.active?.id)) { this.syncSessionControls(); return; }
    if (this.sessions[0]) await this.selectSession(this.sessions[0]); else await this.newSession();
  }
  private renderHistory(): void {
    if (!this.history) return; this.history.empty(); this.history.createDiv({ cls: 'qa-history-label', text: '历史会话' });
    if (!this.sessions.length) { this.history.createDiv({ cls: 'qa-history-time', text: '暂无历史记录', attr: { style: 'padding:8px' } }); return; }
    for (const session of this.sessions) { const button = this.history.createEl('button', { cls: `qa-history-item${session.id === this.active?.id ? ' is-active' : ''}` }); setIcon(button.createSpan(), 'message-circle'); const copy = button.createDiv({ cls: 'qa-history-copy' }); copy.createSpan({ cls: 'qa-history-title', text: session.title || '新问答' }); copy.createSpan({ cls: 'qa-history-time', text: formatTime(session.updatedAt) }); button.addEventListener('click', () => void this.selectSession(session)); }
  }
  private async newSession(): Promise<void> {
    this.abort?.abort(); const now = Date.now(); this.active = { id: crypto.randomUUID(), title: '新问答', createdAt: now, updatedAt: now, archived: false, webEnabled: false, mode: 'normal', sourceIds: [] }; this.selectedSourceIds = []; this.messages = []; await this.persist(); this.syncSessionControls(); this.renderHistory(); this.renderMessages(); this.renderScope(); this.input?.focus();
  }
  private async selectSession(session: AiQaSession): Promise<void> { const saved = await this.store.read(session.id); if (!saved) return; this.abort?.abort(); this.active = saved.session; this.selectedSourceIds = [...(saved.session.sourceIds ?? [])]; this.messages = saved.messages ?? []; this.syncSessionControls(); this.renderHistory(); this.renderMessages(); this.renderScope(); }
  private syncSessionControls(): void { if (!this.active) return; if (this.titleEl) this.titleEl.textContent = this.active.title || 'AI 问答'; if (this.modeSelect) this.modeSelect.value = this.active.mode || 'normal'; if (this.active.model && this.modelSelect) this.modelSelect.value = modelKey(this.active.model); this.renderReasoningOptions(); if (this.webToggle) this.webToggle.checked = Boolean(this.active.webEnabled); this.renderAttachments(); this.renderScope(); }

  private renderModelOptions(): void {
    if (!this.modelSelect) return; this.modelSelect.empty(); const settings = this.host.plugin.settings.aiQa; const refs: ModelRef[] = [];
    for (const provider of settings.providers.filter((item) => item.enabled)) for (const model of provider.models) { const ref = { providerId: provider.id, modelId: model.id }; refs.push(ref); this.modelSelect.createEl('option', { value: modelKey(ref), text: `${provider.displayName || provider.id} · ${model.displayName || model.id}` }); }
    const preferred = this.active?.model ?? settings.defaultModel ?? refs[0]; if (preferred) this.modelSelect.value = modelKey(preferred); this.renderReasoningOptions();
  }
  private currentModel(): { ref: ModelRef; provider: NonNullable<Dashboard['settings']['aiQa']['providers'][number]>; model: NonNullable<Dashboard['settings']['aiQa']['providers'][number]['models'][number]> } | null {
    const value = this.modelSelect?.value; if (!value) return null; const [providerId, ...rest] = value.split('::'); const modelId = rest.join('::'); const provider = this.host.plugin.settings.aiQa.providers.find((item) => item.id === providerId); const model = provider?.models.find((item) => item.id === modelId); return provider && model ? { ref: { providerId, modelId }, provider, model } : null;
  }
  private renderReasoningOptions(): void { if (!this.reasoningSelect) return; this.reasoningSelect.empty(); const options = this.currentModel()?.model.reasoningEfforts?.length ? this.currentModel()!.model.reasoningEfforts! : ['low', 'medium', 'high']; this.reasoningSelect.createEl('option', { value: '', text: '默认思考' }); options.forEach((item) => this.reasoningSelect!.createEl('option', { value: item, text: `思考：${item}` })); }

  private renderAttachments(): void { if (!this.attachmentList) return; this.attachmentList.empty(); for (const [index, file] of this.pendingFiles.entries()) { const chip = this.attachmentList.createDiv({ cls: 'qa-attachment' }); setIcon(chip.createSpan(), file.type.startsWith('image/') ? 'image' : 'file-text'); chip.createSpan({ text: file.name }); const remove = chip.createEl('button', { attr: { 'aria-label': `移除 ${file.name}` } }); setIcon(remove, 'x'); remove.addEventListener('click', () => { this.pendingFiles.splice(index, 1); this.renderAttachments(); }); } }
  private addFiles(files: File[]): void { const accepted = files.filter((file) => file.size <= 15 * 1024 * 1024).slice(0, 8); if (accepted.length < files.length) new Notice('单个附件不能超过 15MB，最多保留 8 个附件'); this.pendingFiles.push(...accepted); this.renderAttachments(); }
  private handlePaste(event: ClipboardEvent): void { const files = Array.from(event.clipboardData?.files ?? []); if (files.length) { event.preventDefault(); this.addFiles(files); } }

  private async searchVault(query: string, rounds = 1): Promise<SearchHit[]> {
    const terms = [...new Set(query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((term) => term.length > 1))].slice(0, 8); if (!terms.length) return [];
    const files = this.host.app.vault.getMarkdownFiles().slice(0, 300); const hits: SearchHit[] = []; const documents: Array<{ file: TFile; text: string }> = [];
    for (const file of files) { try { documents.push({ file, text: await this.host.app.vault.cachedRead(file) }); } catch { /* skip unreadable notes */ } }
    for (let round = 0; round < Math.max(1, Math.min(5, rounds)); round++) for (const { file, text } of documents) { const lower = text.toLowerCase(); const score = terms.reduce((sum, term) => sum + (lower.split(term).length - 1), 0); if (!score) continue; const existing = hits.find((hit) => hit.file.path === file.path); if (existing) { existing.score += score / (round + 2); continue; } const index = Math.max(0, lower.indexOf(terms.find((term) => lower.includes(term)) ?? terms[0])); hits.push({ file, score: score / (round + 1), excerpt: text.slice(Math.max(0, index - 90), Math.min(text.length, index + 360)).replace(/\s+/g, ' ').trim() }); }
    return hits.sort((a, b) => b.score - a.score).slice(0, 5);
  }
  private sagServer(): AiQaMcpServer | null { return this.host.plugin.settings.aiQa.mcpServers.find((item) => item.id === 'sag-knowledge' && item.enabled) ?? null; }
  private mcpClient(server: AiQaMcpServer): AiQaMcpClient {
    const storage = (this.host.app as unknown as { secretStorage?: { getSecret: (id: string) => string | null } }).secretStorage;
    const value = server.authKeychainId && storage ? storage.getSecret(server.authKeychainId) : '';
    const token = value?.trim();
    return new AiQaMcpClient(server, token ? { Authorization: /^Bearer\s/i.test(token) ? token : `Bearer ${token}` } : {});
  }
  private mcpText(value: unknown): string {
    if (typeof value === 'string') return value;
    if (!value || typeof value !== 'object') return value == null ? '' : JSON.stringify(value);
    const item = value as { content?: Array<{ text?: string }>; structuredContent?: unknown; result?: unknown };
    if (Array.isArray(item.content)) { const text = item.content.map((part) => part.text ?? '').filter(Boolean).join('\n'); if (text) return text; }
    if (item.structuredContent !== undefined) return this.mcpText(item.structuredContent);
    if (item.result !== undefined) return this.mcpText(item.result);
    return JSON.stringify(value, null, 2);
  }
  private parseSagSources(value: unknown): SagSource[] {
    const text = this.mcpText(value); const sources: SagSource[] = [];
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^-\s*(.*?)\s*(?:（source_id=([^）]+)）|\(source_id=([^,)]+)(?:,\s*(\d+)\s*文档)?(?:,\s*(\d+)\s*分块)?\))(?:\s*[·|]\s*(\d+)\s*文档)?(?:\s*[·|]\s*(\d+)\s*分块)?/u);
      if (match) sources.push({ name: match[1].trim(), id: (match[2] ?? match[3]).trim(), documents: match[4] ? Number(match[4]) : match[6] ? Number(match[6]) : undefined, chunks: match[5] ? Number(match[5]) : match[7] ? Number(match[7]) : undefined });
    }
    return sources;
  }
  private renderScope(): void {
    if (!this.scopePanel || !this.scopeSummary) return;
    const selected = new Set(this.selectedSourceIds); this.scopeSummary.textContent = selected.size ? `知识库：${selected.size} 个范围` : '知识库：全部'; this.scopePanel.empty();
    if (!this.sagServer()) { this.scopePanel.createDiv({ cls: 'qa-scope-meta', text: '未配置 SAG 知识库 MCP 服务' }); return; }
    if (!this.sagSources.length) { this.scopePanel.createDiv({ cls: 'qa-scope-meta', text: '展开后加载可用知识库' }); return; }
    const all = this.scopePanel.createEl('label', { cls: 'qa-scope-row' }); const allInput = all.createEl('input', { type: 'checkbox' }); allInput.checked = selected.size === 0; all.createSpan({ text: '全部知识库' }); allInput.addEventListener('change', () => { this.selectedSourceIds = []; if (this.active) { this.active.sourceIds = []; void this.persist(); } this.renderScope(); });
    for (const source of this.sagSources) { const row = this.scopePanel.createEl('label', { cls: 'qa-scope-row' }); const checkbox = row.createEl('input', { type: 'checkbox' }); checkbox.checked = selected.has(source.id); const copy = row.createDiv(); copy.createSpan({ text: source.name }); const meta = [source.documents ? `${source.documents} 文档` : '', source.chunks ? `${source.chunks} 分块` : ''].filter(Boolean).join(' · '); if (meta) copy.createSpan({ cls: 'qa-scope-meta', text: meta }); checkbox.addEventListener('change', () => { const next = new Set(this.selectedSourceIds); if (checkbox.checked) next.add(source.id); else next.delete(source.id); this.selectedSourceIds = [...next]; if (this.active) { this.active.sourceIds = [...this.selectedSourceIds]; void this.persist(); } this.renderScope(); }); }
  }
  private async loadSagSources(): Promise<void> {
    const server = this.sagServer(); if (!server) { this.renderScope(); return; }
    try { const result = await this.mcpClient(server).callTool('list_sources', {}); this.sagSources = this.parseSagSources(result); this.renderScope(); } catch { this.sagSources = []; this.renderScope(); }
  }
  private async searchSagKnowledge(query: string): Promise<SagHit[]> {
    const server = this.sagServer(); if (!server || !query.trim()) return [];
    const sourceIds = this.selectedSourceIds.length ? this.selectedSourceIds : [undefined]; const hits: SagHit[] = [];
    for (const sourceId of sourceIds) {
      try { const result = await this.mcpClient(server).callTool('search', { query, top_k: 8, ...(sourceId ? { source_id: sourceId } : {}) }); const text = this.mcpText(result); const chunks = text.split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean); for (const chunk of chunks.slice(0, 8)) hits.push({ sourceId, title: sourceId ? (this.sagSources.find((item) => item.id === sourceId)?.name ?? 'SAG 知识库') : 'SAG 知识库', excerpt: chunk.slice(0, 700) }); } catch { /* keep local retrieval available when SAG is offline */ }
    }
    return hits.slice(0, 12);
  }
  private async attachmentData(file: File): Promise<AiQaAttachment> { const id = crypto.randomUUID(); const base = normalizePath(`${this.host.plugin.settings.aiQa.sessionFolder}/attachments/${this.active!.id}`); if (!this.host.app.vault.getAbstractFileByPath(base)) { await this.host.app.vault.createFolder(normalizePath(this.host.plugin.settings.aiQa.sessionFolder)); await this.host.app.vault.createFolder(normalizePath(`${this.host.plugin.settings.aiQa.sessionFolder}/attachments`)); await this.host.app.vault.createFolder(base); } const path = normalizePath(`${base}/${id}-${file.name}`); await this.host.app.vault.createBinary(path, await file.arrayBuffer()); return { id, name: file.name, mimeType: file.type || 'application/octet-stream', size: file.size, path, text: file.type.startsWith('text/') || /\.(md|txt|csv|json)$/i.test(file.name) ? await file.text() : undefined }; }
  private async imageDataUrl(file: File): Promise<string> { const bytes = new Uint8Array(await file.arrayBuffer()); let binary = ''; const chunk = 0x8000; for (let index = 0; index < bytes.length; index += chunk) binary += String.fromCharCode(...bytes.subarray(index, index + chunk)); return `data:${file.type || 'image/png'};base64,${btoa(binary)}`; }
  private schedulePersist(): void { if (this.persistTimer !== null) window.clearTimeout(this.persistTimer); this.persistTimer = window.setTimeout(() => { this.persistTimer = null; void this.persist(); }, 350); }
  private async persist(): Promise<void> { if (!this.active) return; this.active.updatedAt = Date.now(); await this.store.write({ session: this.active, messages: this.messages }); }

  private async renderMarkdown(target: HTMLElement, content: string): Promise<void> { const component = new Component(); component.load(); this.renderedComponents.push(component); try { await MarkdownRenderer.renderMarkdown(content || '正在生成…', target, '', component); } catch { target.textContent = content; } }
  private renderMessages(): void {
    if (!this.transcript) return; const version = ++this.renderVersion; this.renderedComponents.forEach((component) => component.unload()); this.renderedComponents = []; this.transcript.empty();
    if (!this.messages.length) { const empty = this.transcript.createDiv({ cls: 'qa-empty' }); const icon = empty.createDiv({ cls: 'qa-empty-mark' }); setIcon(icon, 'sparkles'); empty.createEl('strong', { text: '开始一个新的问答会话' }); empty.createSpan({ text: '普通问答适合快速查证；深度研究会展示检索与联网过程，并将引用保留在回答下方。' }); return; }
    for (const message of this.messages) {
      const row = this.transcript.createDiv({ cls: `qa-message ${message.role === 'user' ? 'qa-user' : ''}` });
      if (message.role === 'user') { const bubble = row.createDiv({ cls: 'qa-user-bubble' }); bubble.textContent = message.content.replace(/\n?\n?\[(?:SAG 知识库|本地知识库)证据\][\s\S]*$/u, ''); this.renderAttachmentBadges(row, message.attachments); continue; }
      const aiRow = row.createDiv({ cls: 'qa-ai-row' }); const avatar = aiRow.createDiv({ cls: 'qa-ai-avatar' }); setIcon(avatar, message.role === 'tool' ? 'wrench' : 'sparkles'); const content = aiRow.createDiv({ cls: 'qa-ai-content' }); content.createDiv({ cls: 'qa-ai-label', text: message.role === 'tool' ? 'MCP 工具' : 'AI' });
      if (message.steps?.length) { const details = content.createEl('details', { cls: 'qa-steps' }); if (message.delivery === 'streaming') details.open = true; details.createEl('summary', { text: message.delivery === 'streaming' ? '正在处理请求…' : `已完成 ${message.steps.length} 个步骤` }); for (const step of message.steps) { const line = details.createDiv({ cls: 'qa-step' }); const dot = line.createSpan({ cls: `qa-step-dot ${step.status}` }); const text = line.createDiv(); text.createSpan({ text: step.label }); if (step.detail) text.createSpan({ cls: 'qa-step-detail', text: step.detail }); } }
      const markdown = content.createDiv({ cls: 'qa-markdown' }); void this.renderMarkdown(markdown, message.content).then(() => { if (version !== this.renderVersion) return; });
      if (message.error) content.createDiv({ cls: 'qa-error', text: message.error }); this.renderCitations(content, message.citations); const actions = content.createDiv({ cls: 'qa-actions' }); const copy = actions.createEl('button', { text: '复制' }); copy.addEventListener('click', async () => { await navigator.clipboard.writeText(message.content); new Notice('回答已复制'); });
      const retrySource = this.messages[this.messages.indexOf(message) - 1]; if (retrySource?.role === 'user' && message.delivery !== 'streaming') { const retry = actions.createEl('button', { text: '重新回答' }); retry.addEventListener('click', () => { if (this.input) { this.input.value = retrySource.content; this.input.focus(); } }); }
    }
    this.transcript.scrollTop = this.transcript.scrollHeight;
  }
  private renderAttachmentBadges(parent: HTMLElement, attachments?: AiQaAttachment[]): void { if (!attachments?.length) return; const line = parent.createDiv({ cls: 'qa-citations' }); attachments.forEach((file) => line.createSpan({ cls: 'qa-citation', text: `附件 · ${file.name}` })); }
  private renderCitations(parent: HTMLElement, citations?: AiQaCitation[]): void { if (!citations?.length) return; const line = parent.createDiv({ cls: 'qa-citations' }); citations.forEach((citation, index) => { const button = line.createEl('button', { cls: 'qa-citation' }); setIcon(button.createSpan(), citation.kind === 'external' ? 'globe-2' : citation.kind === 'tool' ? 'wrench' : 'file-text'); button.createSpan({ text: `[${index + 1}] ${citation.title}` }); button.addEventListener('click', () => { if (citation.url) window.open(citation.url, '_blank'); else if (citation.source) void this.host.app.workspace.openLinkText(citation.source, ''); }); }); }

  private async inspectMcp(): Promise<void> { const server = this.host.plugin.settings.aiQa.mcpServers.find((item) => item.enabled); if (!server) { new Notice('请先在插件设置中启用 MCP 服务'); return; } try { const tools = await this.mcpClient(server).listTools(); const menu = new Menu(); tools.forEach((tool) => menu.addItem((item) => item.setTitle(tool.name).setIcon('wrench').onClick(() => void this.callMcp(server, tool.name)))); menu.showAtPosition({ x: 300, y: 300 }, this.host.boardEl?.ownerDocument); } catch (error) { new Notice(`MCP 连接失败：${error instanceof Error ? error.message : String(error)}`); } }
  private async callMcp(server: AiQaMcpServer, name: string): Promise<void> { try { const result = await this.mcpClient(server).callTool(name, {}); if (!this.active) return; this.messages.push({ id: crypto.randomUUID(), sessionId: this.active.id, role: 'tool', content: this.mcpText(result), createdAt: Date.now(), delivery: 'complete', steps: [{ id: crypto.randomUUID(), kind: 'tool', label: `${server.displayName} · ${name}`, status: 'done' }], citations: [{ title: server.displayName, source: name, kind: 'tool' }] }); await this.persist(); this.renderMessages(); } catch (error) { new Notice(`MCP 调用失败：${error instanceof Error ? error.message : String(error)}`); } }

  private async clearSession(): Promise<void> { if (!this.active || this.abort) return; this.messages = []; this.active.title = '新问答'; await this.persist(); this.syncSessionControls(); this.renderMessages(); this.renderHistory(); }
  private setBusy(busy: boolean): void { if (this.sendButton) this.sendButton.style.display = busy ? 'none' : 'grid'; if (this.stopButton) this.stopButton.style.display = busy ? 'grid' : 'none'; if (this.input) this.input.disabled = busy; }

  private async submit(): Promise<void> {
    const query = this.input?.value.trim() ?? ''; if ((!query && !this.pendingFiles.length) || !this.active || this.abort) return;
    let selected = this.currentModel();
    if (this.webToggle?.checked && this.host.plugin.settings.aiQa.webModel) {
      const webRef = this.host.plugin.settings.aiQa.webModel;
      const webProvider = this.host.plugin.settings.aiQa.providers.find((item) => item.id === webRef.providerId);
      const webModel = webProvider?.models.find((item) => item.id === webRef.modelId);
      if (webProvider && webModel) selected = { ref: webRef, provider: webProvider, model: webModel };
    }
    if (!selected) { new Notice('请先在设置中配置并启用一个模型'); return; }
    const storage = (this.host.app as unknown as { secretStorage?: { getSecret: (id: string) => string | null } }).secretStorage; const apiKey = selected.provider.apiKeyKeychainId && storage ? storage.getSecret(selected.provider.apiKeyKeychainId) : selected.provider.apiKey ?? '';
    if (!apiKey) { new Notice('当前模型没有可用 API Key，请在设置中重新保存'); return; }
    const pending = this.pendingFiles.splice(0); this.renderAttachments(); this.setBusy(true); this.statusEl?.removeClass('error'); if (this.statusEl) this.statusEl.textContent = '正在准备上下文…';
    try {
      const imagePayloads = await Promise.all(pending.map((file) => file.type.startsWith('image/') ? this.imageDataUrl(file) : Promise.resolve(null))); const attachments = await Promise.all(pending.map((file) => this.attachmentData(file))); const rounds = this.active.mode === 'deep' ? Math.min(5, Math.max(1, this.host.plugin.settings.aiQa.deepResearchRounds)) : 1;
      if (this.statusEl) this.statusEl.textContent = this.selectedSourceIds.length ? `正在检索 SAG 知识库（${this.selectedSourceIds.length} 个范围）…` : '正在检索 SAG 知识库…';
      const sagHits = await this.searchSagKnowledge(query); const hits = await this.searchVault(query, rounds);
      const citations: AiQaCitation[] = [...sagHits.map((hit) => ({ title: hit.title, source: 'SAG 知识库', excerpt: hit.excerpt, kind: 'internal' as const, score: hit.score })), ...hits.map((hit) => ({ title: hit.file.basename, source: hit.file.path, excerpt: hit.excerpt, kind: 'internal' as const, score: hit.score }))];
      const sagEvidence = sagHits.length ? `\n\n[SAG 知识库证据]\n${sagHits.map((hit, index) => `[S${index + 1}] ${hit.title}\n${hit.excerpt}`).join('\n\n')}` : '';
      const evidence = hits.length ? `\n\n[本地知识库证据]\n${hits.map((hit, index) => `[${index + 1}] ${hit.file.path}\n${hit.excerpt}`).join('\n\n')}` : '';
      const textAttachments = attachments.filter((item) => item.text).map((item) => `\n\n[附件 ${item.name}]\n${item.text}`).join('');
      const content = query + textAttachments + sagEvidence + evidence; const user: AiQaMessage = { id: crypto.randomUUID(), sessionId: this.active.id, role: 'user', content, createdAt: Date.now(), delivery: 'complete', attachments }; const steps: AiQaStep[] = [...(this.sagServer() ? [{ id: crypto.randomUUID(), kind: 'retrieval' as const, label: sagHits.length ? `SAG 知识库检索命中 ${sagHits.length} 条` : 'SAG 知识库未命中', status: 'done' as const, count: sagHits.length }] : []), ...Array.from({ length: rounds }, (_, index) => ({ id: crypto.randomUUID(), kind: index === rounds - 1 ? 'retrieval' as const : 'thinking' as const, label: rounds > 1 ? `研究轮次 ${index + 1}/${rounds} · ${index === rounds - 1 ? '汇总本地证据' : '分析检索方向'}` : hits.length ? `本地知识库检索命中 ${hits.length} 篇` : '本地知识库未命中', status: 'done' as const, count: index === rounds - 1 ? hits.length : undefined }))]; const assistant: AiQaMessage = { id: crypto.randomUUID(), sessionId: this.active.id, role: 'assistant', content: '', createdAt: Date.now(), delivery: 'streaming', steps: [...steps, { id: crypto.randomUUID(), kind: 'answer', label: '正在整理回答', status: 'active' }], citations };
      this.messages.push(user, assistant); this.active.model = selected.ref; this.active.title = this.active.title === '新问答' ? query.replace(/\s+/g, ' ').slice(0, 42) || '新问答' : this.active.title; this.input!.value = ''; this.syncSessionControls(); this.renderHistory(); this.renderMessages(); this.schedulePersist();
      this.abort = new AbortController(); if (this.statusEl) this.statusEl.textContent = `${this.active.mode === 'deep' ? '深度研究' : '普通问答'} · ${selected.model.displayName || selected.model.id}`;
      const messages = trimToContext(this.messages.filter((item) => item.role !== 'tool').map((item) => ({ role: item.role, content: item === user && imagePayloads.some(Boolean) ? [{ type: 'text', text: item.content }, ...imagePayloads.filter((value): value is string => Boolean(value)).map((url) => ({ type: 'image_url', image_url: { url } }))] : item.content })), selected.model.contextWindow, selected.model.maxOutputTokens);
      await streamOpenAi({ provider: selected.provider, apiKey, model: selected.model.id, maxOutputTokens: selected.model.maxOutputTokens, reasoningEffort: this.reasoningSelect?.value || undefined, messages, webEnabled: Boolean(this.webToggle?.checked), supportsTools: selected.model.supportsTools, signal: this.abort.signal }, (event) => { if (event.type === 'message.delta' && typeof event.payload.delta === 'string') { assistant.content += event.payload.delta; assistant.steps = assistant.steps?.map((step) => step.kind === 'answer' ? { ...step, status: 'active' } : step); this.renderMessages(); this.schedulePersist(); } else if (event.type === 'run.failed') { assistant.error = typeof event.payload.error === 'string' ? event.payload.error : '模型请求失败'; } });
      assistant.delivery = 'complete'; assistant.steps = assistant.steps?.map((step) => ({ ...step, status: step.status === 'error' ? 'error' : 'done' })); if (this.statusEl) this.statusEl.textContent = `已完成 · ${formatTime(Date.now())}`;
    } catch (error) { const assistant = this.messages[this.messages.length - 1]; if (assistant?.role === 'assistant') { assistant.delivery = this.abort?.signal.aborted ? 'cancelled' : 'failed'; assistant.error = this.abort?.signal.aborted ? '已停止生成' : error instanceof Error ? error.message : String(error); assistant.steps = assistant.steps?.map((step) => ({ ...step, status: assistant.delivery === 'failed' ? 'error' : 'done' })); } if (this.statusEl) { this.statusEl.textContent = assistant?.error ?? '请求已停止'; this.statusEl.addClass('error'); } }
    finally { await this.persist(); this.abort = undefined; this.setBusy(false); this.renderMessages(); this.renderHistory(); }
  }
}
