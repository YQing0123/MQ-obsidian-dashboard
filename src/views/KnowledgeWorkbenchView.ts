import { ItemView, WorkspaceLeaf } from 'obsidian';
import type Dashboard from '../main';

export const KNOWLEDGE_WORKBENCH_VIEW_TYPE = 'knowledge-workbench-view';

export class KnowledgeWorkbenchView extends ItemView {
	private frame: HTMLIFrameElement | null = null;
	private pendingPage = 'dashboard';

	constructor(leaf: WorkspaceLeaf, private readonly plugin: Dashboard) {
		super(leaf);
	}

	getViewType(): string { return KNOWLEDGE_WORKBENCH_VIEW_TYPE; }
	getDisplayText(): string { return '知识工作台'; }
	getIcon(): string { return 'library-big'; }

	setPage(page: string): void {
		this.pendingPage = page || 'dashboard';
		if (this.frame) this.frame.src = this.plugin.knowledgeWorkbench.getUrl(this.pendingPage);
	}

	async onOpen(): Promise<void> {
		this.containerEl.empty();
		this.containerEl.addClass('knowledge-workbench-view');
		const shell = this.containerEl.createDiv({ cls: 'knowledge-workbench-view__shell' });
		const status = shell.createDiv({ cls: 'knowledge-workbench-view__status', text: '正在启动知识工作台服务…' });
		const ok = await this.plugin.knowledgeWorkbench.ensureStarted();
		if (!ok) {
			status.empty();
			status.createEl('strong', { text: '知识工作台服务启动失败' });
			status.createEl('p', { text: this.plugin.knowledgeWorkbench.error || '请检查 Node 路径、服务目录和端口配置。' });
			const retry = status.createEl('button', { cls: 'mod-cta', text: '重试启动' });
			retry.addEventListener('click', () => { void this.onOpen(); });
			return;
		}
		status.remove();
		this.frame = shell.createEl('iframe', {
			cls: 'knowledge-workbench-view__frame',
			attr: {
				title: '知识工作台',
				loading: 'eager',
				allow: 'clipboard-read; clipboard-write',
				referrerpolicy: 'no-referrer',
			},
		});
		this.frame.src = this.plugin.knowledgeWorkbench.getUrl(this.pendingPage);
	}

	onClose(): Promise<void> {
		this.frame = null;
		this.containerEl.empty();
		return Promise.resolve();
	}
}
