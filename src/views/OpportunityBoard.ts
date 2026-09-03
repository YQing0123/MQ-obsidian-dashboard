import { Menu, Modal } from 'obsidian';
import type { App } from 'obsidian';
import type { TaskItem } from '../data/taskParser';
import type { TaskStore } from '../data/taskStore';
import { OpportunityModal } from './OpportunityModal';
import {
	BoardItem, BoardFormData, BoardStage,
	sortBoardItems, migrateStatus,
	ensureOpportunityFile, parseOpportunitiesFile, writeOpportunitiesFile,
	createOpportunity, updateOpportunity, updateBoardItemStatus, toggleBoardItemStarred, deleteOpportunity,
	DEFAULT_BOARD_FILE,
} from '../data/opportunityParser';
import { UI_TEXT } from '../constants';

/** Host surface the OpportunityBoard needs from its owner view. */
export interface OpportunityHost {
	app: App;
	plugin: {
		settings: {
			opportunityFile: string;
			boardTitle: string;
			boardStages: BoardStage[];
			currentOppView: string;
			oppKanbanColumnWidth?: number;
			oppListColumnWidths?: Record<string, number>;
		};
		saveSettings(): Promise<void>;
	};
	boardEl: HTMLElement | null;
	currentPage: 'home' | 'project' | 'opportunity' | 'daily-report' | 'ai-qa';
	exitEditMode(): void;
	showToast(message: string, kind?: 'success' | 'error'): void;
	taskStore: TaskStore;
	openTaskEditModal(task: TaskItem): void;
	openTaskModal(defaultProject?: string, options?: { defaultTitle?: string; opportunityId?: string; onCreated?: (taskId: string) => void }): Promise<void>;
}

/** 通用看板（第三页）渲染器 — extracted from DashboardView. */
export class OpportunityBoard {
	private host: OpportunityHost;

	// Board state
	private currentItems: BoardItem[] = [];
	private selectedStatus: string = 'all';
	private showStarredOnly: boolean = false;
	private selectedDetailId: string | null = null;
	private draggedId: string | null = null;
	private mainEl: HTMLElement | null = null;
	private sortCol: string = '';
	private sortDir: 'asc' | 'desc' = 'asc';
	private refreshTimer: number | null = null;
	private cache: { at: number; items: BoardItem[] } | null = null;
	private currentTasks: TaskItem[] = [];

	constructor(host: OpportunityHost) {
		this.host = host;
	}

	/** 供顶部导航直接打开灵感新建弹窗。 */
	openCreateModal(): void {
		void this.openModal();
	}

	/** Debounced refresh of the board (250ms) to coalesce rapid vault events. */
	scheduleRefresh(): void {
		if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
		this.refreshTimer = window.setTimeout(() => {
			this.refreshTimer = null;
			void this.refreshBoard();
		}, 250);
	}

	/** Cancel pending work (view close). */
	dispose(): void {
		if (this.refreshTimer) { window.clearTimeout(this.refreshTimer); this.refreshTimer = null; }
	}

	private boardTitle(): string {
		return this.host.plugin.settings.boardTitle || '看板';
	}

	private boardPath(): string {
		return this.host.plugin.settings.opportunityFile || DEFAULT_BOARD_FILE;
	}

	/** 配置的阶段 label 列表（排序用） */
	private stageLabels(): string[] {
		return this.host.plugin.settings.boardStages.map((s) => s.label);
	}

	private stageByLabel(label: string): BoardStage | undefined {
		return this.host.plugin.settings.boardStages.find((s) => s.label === label);
	}

	private stageColor(label: string): string {
		const st = this.stageByLabel(label);
		return st ? st.color : 'var(--mq-ad-muted)';
	}

	private async loadItems(): Promise<BoardItem[]> {
		const now = Date.now();
		if (this.cache && now - this.cache.at < 300) return this.cache.items;
		const path = this.boardPath();
		const title = this.boardTitle();
		await ensureOpportunityFile(this.host.app, path, title);
		const items = await parseOpportunitiesFile(this.host.app, path, title);
		const sorted = sortBoardItems(items, this.stageLabels());
		this.cache = { at: now, items: sorted };
		return sorted;
	}

	private async saveItems(items: BoardItem[]): Promise<void> {
		const path = this.boardPath();
		await writeOpportunitiesFile(this.host.app, path, items, this.boardTitle());
		this.cache = { at: Date.now(), items: sortBoardItems(items, this.stageLabels()) };
	}

	async show(): Promise<void> {
		if (!this.host.boardEl) return;
		this.host.exitEditMode();
		const [items, tasks] = await Promise.all([this.loadItems(), this.host.taskStore.scanAllTasks()]);
		this.host.boardEl.empty();
		this.host.boardEl.removeClass('mq-ad-board');
		this.host.boardEl.removeClass('mq-po-board');
		this.host.boardEl.removeClass('mq-dr-board');
		this.host.boardEl.removeClass('mq-ai-qa-board');
		this.host.boardEl.addClass('mq-op-board');
		this.host.currentPage = 'opportunity';

		this.currentItems = items;
		this.currentTasks = tasks;
		this.selectedStatus = 'all';
		this.showStarredOnly = false;
		this.selectedDetailId = null;

		const container = this.host.boardEl.createDiv({ cls: 'mq-po-container mq-op-container' });
		const sidebar = container.createDiv({ cls: 'mq-po-sidebar mq-op-sidebar' });
		this.renderSidebar(sidebar);
		this.mainEl = container.createDiv({ cls: 'mq-po-main mq-op-main' });
		this.renderPanels();
	}

	private renderSidebar(sidebar: HTMLElement): void {
		sidebar.empty();
		const list = sidebar.createDiv({ cls: 'mq-po-sidebar__list' });
		const items = this.currentItems;
		const total = items.length;

		const allItem = list.createDiv({ cls: 'mq-po-sidebar__item' + (this.selectedStatus === 'all' && !this.showStarredOnly ? ' is-active' : '') });
		allItem.createSpan({ cls: 'mq-po-dot', attr: { style: 'background:var(--mq-ad-accent);color:var(--mq-ad-accent)' } });
		allItem.createSpan({ text: UI_TEXT.opAll });
		allItem.createSpan({ cls: 'mq-po-count', text: String(total) });
		allItem.addEventListener('click', () => {
			this.selectedStatus = 'all';
			this.showStarredOnly = false;
			this.selectedDetailId = null;
			this.renderSidebar(sidebar);
			this.renderPanels();
		});

		for (const st of this.host.plugin.settings.boardStages) {
			const count = items.filter((i) => i.status === st.label).length;
			const item = list.createDiv({ cls: 'mq-po-sidebar__item' + (this.selectedStatus === st.label ? ' is-active' : '') });
			item.createSpan({ cls: 'mq-po-dot', attr: { style: 'background:' + st.color + ';color:' + st.color } });
			item.createSpan({ text: st.label });
			item.createSpan({ cls: 'mq-po-count', text: String(count) });
			item.addEventListener('click', () => {
				this.selectedStatus = st.label;
				this.showStarredOnly = false;
				this.selectedDetailId = null;
				this.renderSidebar(sidebar);
				this.renderPanels();
			});
		}

		const starItem = list.createDiv({ cls: 'mq-po-sidebar__item' + (this.showStarredOnly ? ' is-active' : '') });
		starItem.createSpan({ cls: 'mq-po-dot', attr: { style: 'background:#eab308;color:#eab308' } });
		starItem.createSpan({ text: UI_TEXT.opRoadmap });
		starItem.createSpan({ cls: 'mq-po-count', text: String(items.filter((i) => i.starred).length) });
		starItem.addEventListener('click', () => {
			this.showStarredOnly = !this.showStarredOnly;
			this.selectedStatus = 'all';
			this.selectedDetailId = null;
			this.renderSidebar(sidebar);
			this.renderPanels();
		});
	}

	private renderPanels(): void {
		if (!this.mainEl) return;
		this.mainEl.empty();
		const items = this.filteredItems();
		const tabs = this.mainEl.createDiv({ cls: 'mq-po-tabs' });
		const tabDefs = [
			{ key: 'kanban', label: '▦ 看板' },
			{ key: 'list', label: '☰ 列表' },
		];
		const content = this.mainEl.createDiv({ cls: 'mq-po-content' });
		const panels: Record<string, HTMLElement> = {};
		const cur = this.host.plugin.settings.currentOppView || 'kanban';
		for (const td of tabDefs) {
			const btn = tabs.createEl('button', { cls: 'mq-po-tab' + (td.key === cur ? ' is-active' : ''), text: td.label });
			btn.dataset.view = td.key;
			panels[td.key] = content.createDiv({ cls: 'mq-po-panel' + (td.key === cur ? ' is-active' : ''), attr: { 'data-view': td.key } });
		}
		const newBtn = tabs.createEl('button', { cls: 'mq-po-add-btn mq-op-new-btn', text: '+ 新建' + this.boardTitle() });
		newBtn.addEventListener('click', (e) => { e.stopPropagation(); void this.createItem(); });
		this.renderPanel(cur, panels[cur]!, items);
		tabs.addEventListener('click', (e) => {
			const btn = (e.target as HTMLElement).closest('.mq-po-tab') as HTMLElement;
			if (!btn) return;
			const view = btn.dataset.view;
			if (!view) return;
			tabs.querySelectorAll('.mq-po-tab').forEach((t) => t.removeClass('is-active'));
			btn.addClass('is-active');
			Object.values(panels).forEach((p) => p.classList.remove('is-active'));
			if (panels[view]) panels[view].addClass('is-active');
			this.host.plugin.settings.currentOppView = view;
			void this.host.plugin.saveSettings();
			if (panels[view]) this.renderPanel(view, panels[view], this.filteredItems());
		});
	}

	private filteredItems(): BoardItem[] {
		let items = this.currentItems;
		if (this.showStarredOnly) items = items.filter((i) => i.starred);
		else if (this.selectedStatus !== 'all') items = items.filter((i) => i.status === this.selectedStatus);
		return items;
	}

	private renderPanel(key: string, panel: HTMLElement, items: BoardItem[]): void {
		panel.empty();
		if (key === 'kanban') this.renderKanban(panel, items);
		else if (key === 'list') this.renderList(panel, items);
	}

	/** 看板列：配置阶段 + 数据中出现的未知状态（防御性补列，避免历史数据被隐藏） */
	private activeStages(): BoardStage[] {
		const configured = this.host.plugin.settings.boardStages;
		const dataStatuses = Array.from(new Set(this.currentItems.map((i) => i.status)));
		const extra = dataStatuses.filter((s) => !configured.some((c) => c.label === s));
		return [
			...configured,
			...extra.map((label) => ({ id: label, label, color: 'var(--mq-ad-muted)', hasInput: false })),
		];
	}

	private opportunityKanbanColumnWidth(): number {
		const width = this.host.plugin.settings.oppKanbanColumnWidth;
		return typeof width === 'number' ? Math.max(200, Math.min(640, width)) : 230;
	}

	private setupOpportunityKanbanResize(board: HTMLElement, handle: HTMLElement): void {
		handle.addEventListener('mousedown', (e) => {
			e.preventDefault();
			e.stopPropagation();
			const startX = e.clientX;
			const startWidth = this.opportunityKanbanColumnWidth();
			const clamp = (x: number): number => Math.max(200, Math.min(640, Math.round(x)));
			const onMove = (move: MouseEvent): void => {
				board.style.setProperty('--mq-op-kanban-col-width', clamp(startWidth + move.clientX - startX) + 'px');
			};
			const onUp = (up: MouseEvent): void => {
				document.removeEventListener('mousemove', onMove);
				document.removeEventListener('mouseup', onUp);
				this.host.plugin.settings.oppKanbanColumnWidth = clamp(startWidth + up.clientX - startX);
				void this.host.plugin.saveSettings();
			};
			document.addEventListener('mousemove', onMove);
			document.addEventListener('mouseup', onUp);
		});
	}

	private compactTags(item: BoardItem): string {
		const text = item.tags.filter(Boolean).join('、');
		return text.length > 6 ? text.slice(0, 6) + '…' : text;
	}

	private renderKanban(panel: HTMLElement, items: BoardItem[]): void {
		const singleMode = this.selectedStatus !== 'all' && !this.showStarredOnly;
		const stages = singleMode ? this.activeStages().filter((s) => s.label === this.selectedStatus) : this.activeStages();
		const board = panel.createDiv({ cls: 'mq-po-kanban mq-op-kanban' + (singleMode ? ' mq-op-kanban--single' : '') });
		board.style.setProperty('--mq-op-kanban-col-width', this.opportunityKanbanColumnWidth() + 'px');

		if (singleMode) {
			const ordered = sortBoardItems(items, this.stageLabels());
			if (!this.selectedDetailId || !items.some((i) => i.id === this.selectedDetailId)) {
				this.selectedDetailId = ordered.length ? (ordered[0]?.id ?? null) : null;
			}
		}

		for (const st of stages) {
			const colEl = board.createDiv({ cls: 'mq-po-kanban__col mq-op-kanban__col' });
			colEl.dataset.status = st.label;
			this.setupOpportunityKanbanResize(board, colEl.createDiv({ cls: 'mq-op-kanban__resize', attr: { 'aria-label': '调整看板列宽度' } }));
			const hd = colEl.createDiv({ cls: 'mq-po-kanban__hd' });
			hd.createSpan({ text: st.label });
			const ct = items.filter((i) => i.status === st.label).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
			hd.createSpan({ cls: 'mq-po-kanban__count', text: String(ct.length) });
			if (ct.length === 0) colEl.createDiv({ cls: 'mq-op-empty-col' });

			ct.forEach((it) => {
				const card = colEl.createDiv({ cls: 'mq-po-kanban__card mq-op-card' + (singleMode && it.id === this.selectedDetailId ? ' is-selected' : '') });
				card.draggable = true;
				card.dataset.oppId = it.id;
				const chip = card.createDiv({ cls: 'mq-op-st' });
				chip.style.background = this.stageColor(it.status);
				chip.textContent = it.status;
				const title = card.createDiv({ cls: 'mq-op-card__title' });
				title.textContent = it.title;
				const desc = card.createDiv({ cls: 'mq-op-card__desc' });
				desc.textContent = it.notes || it.link || '';
				const meta = card.createDiv({ cls: 'mq-op-card__meta' });
				if (it.starred) meta.createSpan({ cls: 'mq-op-badge--roadmap', text: UI_TEXT.opRoadmap });
				const tags = this.compactTags(it);
				if (tags) meta.createSpan({ cls: 'mq-op-card__tags', text: tags, attr: { title: it.tags.join('、') } });
				card.addEventListener('click', () => {
					if (singleMode) {
						this.selectedDetailId = it.id;
						board.querySelectorAll('.mq-op-card').forEach((c) => c.removeClass('is-selected'));
						card.addClass('is-selected');
						const detail = board.querySelector('.mq-op-detail');
						if (detail instanceof HTMLElement) this.renderDetail(detail, it);
					} else {
						this.openModal(it);
					}
				});
				card.addEventListener('contextmenu', (e) => {
					e.preventDefault();
					const menu = new Menu();
					menu.addItem((m) => m.setTitle(UI_TEXT.edit).setIcon('pencil').onClick(() => this.openModal(it)));
					menu.addItem((m) => m.setTitle('转为任务').setIcon('list-plus').onClick(() => void this.convertToTask(it)));
					if (singleMode) menu.addItem((m) => m.setTitle('在右侧查看').setIcon('eye').onClick(() => {
						this.selectedDetailId = it.id;
						board.querySelectorAll('.mq-op-card').forEach((c) => c.removeClass('is-selected'));
						card.addClass('is-selected');
						const detail = board.querySelector('.mq-op-detail');
						if (detail instanceof HTMLElement) this.renderDetail(detail, it);
					}));
					menu.addItem((m) => m.setTitle('打开链接').setIcon('file-text').onClick(() => void this.openLink(it)));
					menu.addSeparator();
					for (const s of this.host.plugin.settings.boardStages) {
						menu.addItem((m) => m.setTitle('状态: ' + s.label).onClick(() => void this.setItemStatus(it, s.label)));
					}
					menu.addSeparator();
					menu.addItem((m) => m.setTitle(it.starred ? '取消星标' : '标记为星标').setIcon('flag').onClick(() => void this.setItemStarred(it, !it.starred)));
					menu.addItem((m) => m.setTitle(UI_TEXT.delete).setIcon('trash').onClick(() => void this.deleteItem(it)));
					menu.showAtMouseEvent(e);
				});
				card.addEventListener('dragstart', (e) => {
					this.draggedId = it.id;
					e.dataTransfer?.setData('text/opp-id', it.id);
					if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
					card.addClass('mq-po-kanban__card--dragging');
				});
				card.addEventListener('dragend', () => { this.draggedId = null; card.removeClass('mq-po-kanban__card--dragging'); });
				card.addEventListener('dragover', (e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; card.addClass('mq-op-card--drag-over'); });
				card.addEventListener('dragleave', () => card.removeClass('mq-op-card--drag-over'));
				card.addEventListener('drop', (e) => {
					e.preventDefault();
					e.stopPropagation();
					card.removeClass('mq-op-card--drag-over');
					const id = this.draggedId ?? e.dataTransfer?.getData('text/opp-id');
					this.draggedId = null;
					if (!id) return;
					void this.reorder(id, st.label, it.id);
				});
			});

			colEl.addEventListener('dragover', (e) => { e.preventDefault(); colEl.addClass('mq-po-kanban__col--drag-over'); });
			colEl.addEventListener('dragleave', () => colEl.removeClass('mq-po-kanban__col--drag-over'));
			colEl.addEventListener('drop', (e) => {
				e.preventDefault();
				colEl.removeClass('mq-po-kanban__col--drag-over');
				const id = this.draggedId ?? e.dataTransfer?.getData('text/opp-id');
				this.draggedId = null;
				if (!id) return;
				void this.reorder(id, st.label);
			});
		}

		if (singleMode) {
			const detail = board.createDiv({ cls: 'mq-op-detail' });
			const sel = items.find((i) => i.id === this.selectedDetailId) || sortBoardItems(items, this.stageLabels())[0];
			if (sel) this.renderDetail(detail, sel);
			else detail.createSpan({ text: '（该状态暂无条目）' });
		}
	}

	/** 手动排序：把 draggedId 放到 targetStatus 列中 beforeId 之前（省略 beforeId 则追加到末尾）。 */
	private async reorder(draggedId: string, targetStatus: string, beforeId?: string): Promise<void> {
		if (beforeId && beforeId === draggedId) return;
		const items = this.currentItems;
		const dragged = items.find((i) => i.id === draggedId);
		if (!dragged) return;
		const colItems = items
			.filter((i) => i.status === targetStatus && i.id !== draggedId)
			.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
		let insertIdx = colItems.length;
		if (beforeId) {
			const bi = colItems.findIndex((i) => i.id === beforeId);
			insertIdx = bi < 0 ? colItems.length : bi;
		}
		const reordered: BoardItem[] = [];
		let n = 0;
		for (let k = 0; k < colItems.length + 1; k++) {
			if (k === insertIdx) { reordered.push({ ...dragged, status: targetStatus, order: n }); n++; }
			if (k < colItems.length) { reordered.push({ ...colItems[k], order: n } as BoardItem); n++; }
		}
		const map = new Map(reordered.map((i) => [i.id, i]));
		const next = items.map((i) => map.get(i.id) ?? i);
		this.currentItems = sortBoardItems(next, this.stageLabels());
		await this.saveItems(this.currentItems);
		void this.refreshBoard();
	}

	/** 单状态模式下，右侧内联详情编辑器 */
	private renderDetail(container: HTMLElement, item: BoardItem): void {
		container.empty();
		const wrap = container.createDiv({ cls: 'mq-op-detail__inner' });
		wrap.createDiv({ cls: 'mq-op-detail__hd', text: this.boardTitle() + '详情' });

		const titleInput = wrap.createEl('input', { cls: 'mq-ad-modal-input', attr: { type: 'text' } });
		titleInput.value = item.title; titleInput.placeholder = this.boardTitle() + '名称';

		const statusSel = wrap.createEl('select', { cls: 'mq-ad-modal-input' });
		for (const s of this.host.plugin.settings.boardStages) {
			const o = statusSel.createEl('option', { value: s.label, text: s.label });
			if (s.label === item.status) o.selected = true;
		}

		const tagInput = wrap.createEl('input', { cls: 'mq-ad-modal-input', attr: { type: 'text' } });
		tagInput.value = (item.tags || []).join('、'); tagInput.placeholder = '标签，顿号/逗号分隔';

		const notes = wrap.createEl('textarea', { cls: 'mq-ad-modal-input', attr: { rows: '3' } });
		notes.value = item.notes || ''; notes.placeholder = '背景 / 备注';

		// 阶段输入框：仅渲染「启用输入框」的阶段，标题与阶段名一致联动
		const stageInputs: Array<{ label: string; area: HTMLTextAreaElement }> = [];
		for (const s of this.host.plugin.settings.boardStages) {
			if (!s.hasInput) continue;
			wrap.createDiv({ cls: 'mq-op-detail__stage-label', text: s.label });
			const area = wrap.createEl('textarea', { cls: 'mq-ad-modal-input', attr: { rows: '2', placeholder: '填写该阶段相关记录…' } });
			area.value = (item.stageNotes || {})[s.label] || '';
			stageInputs.push({ label: s.label, area });
		}

		const linkInput = wrap.createEl('input', { cls: 'mq-ad-modal-input', attr: { type: 'text' } });
		linkInput.value = item.link || ''; linkInput.placeholder = '链接双链，如 [[xxx-详情]]';

		const rmRow = wrap.createDiv({ cls: 'mq-op-detail__row' });
		const rmChk = rmRow.createEl('input', { attr: { type: 'checkbox' } });
		rmChk.checked = item.starred;
		rmRow.createSpan({ text: ' 星标（重要/待跟进）' });

		const openBtn = wrap.createEl('button', { cls: 'mq-op-detail__btn mq-op-detail__btn--ghost', text: '打开链接' });
		openBtn.addEventListener('click', () => void this.openLink({ ...item, link: linkInput.value }));

		const btnRow = wrap.createDiv({ cls: 'mq-op-detail__actions' });
		const saveBtn = btnRow.createEl('button', { cls: 'mq-op-detail__btn mq-op-detail__btn--primary', text: UI_TEXT.save });
		const delBtn = btnRow.createEl('button', { cls: 'mq-op-detail__btn mq-op-detail__btn--danger', text: UI_TEXT.delete });

		saveBtn.addEventListener('click', () => {
			// 汇总阶段输入框：保留「当前不可见阶段」的历史内容，覆盖可见阶段（留空=清空）
			const visibleLabels = new Set(this.host.plugin.settings.boardStages.filter((s) => s.hasInput).map((s) => s.label));
			const sn: Record<string, string> = {};
			for (const [k, v] of Object.entries(item.stageNotes || {})) {
				if (!visibleLabels.has(k)) sn[k] = v;
			}
			for (const si of stageInputs) {
				const v = si.area.value.trim();
				if (v) sn[si.label] = v;
			}
			void this.saveDetail(item, {
				title: titleInput.value.trim(),
				status: statusSel.value,
				tags: tagInput.value.split(/[，,、]/).map((t) => t.trim()).filter(Boolean),
				notes: notes.value.trim(),
				stageNotes: sn,
				link: linkInput.value.trim(),
				starred: rmChk.checked,
			});
		});
		delBtn.addEventListener('click', () => void this.deleteItem(item));
	}

	private async saveDetail(item: BoardItem, f: BoardFormData): Promise<void> {
		const path = this.boardPath();
		await updateOpportunity(this.host.app, path, item.id, {
			title: f.title, status: f.status, tags: f.tags, notes: f.notes, stageNotes: f.stageNotes, link: f.link, starred: f.starred,
		}, this.boardTitle());
		const idx = this.currentItems.findIndex((i) => i.id === item.id);
		if (idx >= 0) {
			const cur = this.currentItems[idx];
			if (cur) this.currentItems[idx] = { ...cur, ...f };
		}
		this.currentItems = sortBoardItems(this.currentItems, this.stageLabels());
		this.cache = { at: Date.now(), items: this.currentItems };
		this.host.showToast('已保存');
		void this.refreshBoard();
	}

	private renderList(panel: HTMLElement, items: BoardItem[]): void {
		const chips = panel.createDiv({ cls: 'mq-op-chips' });
		const mkChip = (label: string, active: boolean, onClick: () => void) => {
			const c = chips.createEl('button', { cls: 'mq-op-chip' + (active ? ' is-active' : ''), text: label });
			c.addEventListener('click', onClick);
		};
		mkChip('全部', this.selectedStatus === 'all' && !this.showStarredOnly, () => {
			this.selectedStatus = 'all'; this.showStarredOnly = false; this.rerenderSidebarAndPanels();
		});
		for (const st of this.host.plugin.settings.boardStages) {
			mkChip(st.label, this.selectedStatus === st.label, () => {
				this.selectedStatus = st.label; this.showStarredOnly = false; this.rerenderSidebarAndPanels();
			});
		}

		const tableWrap = panel.createDiv({ cls: 'mq-op-tb-wrap' });
		const table = tableWrap.createEl('table', { cls: 'mq-po-tb2 mq-op-tb mq-op-tb--resizable' });
		const thead = table.createEl('thead');
		const headRow = thead.createEl('tr');
		const cols: Array<{ key: string; label: string; sortable?: boolean }> = [
			{ key: 'title', label: '名称', sortable: true },
			{ key: 'status', label: '状态', sortable: true },
			{ key: 'tags', label: '标签' },
			{ key: 'createDate', label: '创建时间', sortable: true },
			{ key: 'starred', label: '星标', sortable: true },
			{ key: 'conversion', label: '任务转化' },
			{ key: 'actions', label: '操作' },
		];
		const colgroup = table.createEl('colgroup');
		for (const c of cols) {
			const col = colgroup.createEl('col');
			col.dataset.key = c.key;
			col.style.width = this.listColumnWidth(c.key) + 'px';
		}
		for (const c of cols) {
			const th = headRow.createEl('th', { text: c.label });
			if (c.sortable) th.addEventListener('click', () => this.sortList(c.key));
			const resize = th.createDiv({ cls: 'mq-op-tb__resize', attr: { 'aria-label': '调整' + c.label + '列宽度' } });
			this.setupListColumnResize(table, c.key, resize);
		}
		const tbody = table.createEl('tbody');
		for (const it of this.sortedList(items)) {
			const tr = tbody.createEl('tr');
			tr.createEl('td', { text: it.title, attr: { title: it.title } });
			const stTd = tr.createEl('td');
			const chip = stTd.createSpan({ cls: 'mq-op-st' });
			chip.style.background = this.stageColor(it.status);
			chip.textContent = it.status;
			const tagText = it.tags.join(', ');
			tr.createEl('td', { text: tagText || '-', attr: tagText ? { title: tagText } : {} });
			tr.createEl('td', { text: it.createDate || '-' });
			tr.createEl('td', { text: it.starred ? '★' : '-' });
			const related = this.relatedTasks(it);
			const conversion = tr.createEl('td');
			const conversionBtn = conversion.createEl('button', { cls: 'mq-op-conversion-count', text: String(related.length) });
			conversionBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				this.openRelatedTasksModal(it);
			});
			const actions = tr.createEl('td');
			const convertBtn = actions.createEl('button', { cls: 'mq-op-action-btn', text: '转为任务' });
			convertBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				void this.convertToTask(it);
			});
			tr.addEventListener('click', () => this.openModal(it));
		}
	}

	private listColumnWidth(key: string): number {
		const configured = this.host.plugin.settings.oppListColumnWidths?.[key];
		if (typeof configured === 'number') return Math.max(70, Math.min(480, configured));
		const defaults: Record<string, number> = {
			title: 240, status: 110, tags: 150, createDate: 120, starred: 76, conversion: 94, actions: 96,
		};
		return defaults[key] ?? 120;
	}

	private setupListColumnResize(table: HTMLTableElement, key: string, handle: HTMLElement): void {
		handle.addEventListener('mousedown', (e) => {
			e.preventDefault();
			e.stopPropagation();
			const startX = e.clientX;
			const startWidth = this.listColumnWidth(key);
			const clamp = (x: number): number => Math.max(70, Math.min(480, Math.round(x)));
			const col = table.querySelector(`col[data-key="${key}"]`) as HTMLTableColElement | null;
			const onMove = (move: MouseEvent): void => {
				if (col) col.style.width = clamp(startWidth + move.clientX - startX) + 'px';
			};
			const onUp = (up: MouseEvent): void => {
				document.removeEventListener('mousemove', onMove);
				document.removeEventListener('mouseup', onUp);
				const widths = { ...(this.host.plugin.settings.oppListColumnWidths || {}) };
				widths[key] = clamp(startWidth + up.clientX - startX);
				this.host.plugin.settings.oppListColumnWidths = widths;
				void this.host.plugin.saveSettings();
			};
			document.addEventListener('mousemove', onMove);
			document.addEventListener('mouseup', onUp);
		});
	}

	private rerenderSidebarAndPanels(): void {
		const sidebar = this.host.boardEl?.querySelector('.mq-op-sidebar') as HTMLElement | undefined;
		if (sidebar) this.renderSidebar(sidebar);
		this.renderPanels();
	}

	private sortList(key: string): void {
		if (this.sortCol === key) this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
		else { this.sortCol = key; this.sortDir = 'asc'; }
		const panel = this.mainEl?.querySelector('.mq-po-panel[data-view="list"]') as HTMLElement | undefined;
		if (panel) this.renderPanel('list', panel, this.filteredItems());
	}

	private sortedList(items: BoardItem[]): BoardItem[] {
		const col = this.sortCol;
		const dir = this.sortDir === 'asc' ? 1 : -1;
		const cellStr = (v: unknown): string => {
			if (typeof v === 'string') return v;
			if (typeof v === 'number' || typeof v === 'boolean') return String(v);
			return '';
		};
		return [...items].sort((a, b) => {
			let av: string; let bv: string;
			if (col === 'starred') { av = a.starred ? '1' : '0'; bv = b.starred ? '1' : '0'; }
			else { av = cellStr((a as unknown as Record<string, unknown>)[col] ?? ''); bv = cellStr((b as unknown as Record<string, unknown>)[col] ?? ''); }
			return av.localeCompare(bv, 'zh-CN') * dir;
		});
	}

	private async openModal(item?: BoardItem): Promise<void> {
		// 顶部导航可以在尚未打开看板时直接唤起新建弹窗，此时先加载一次已有记录以提供历史标签。
		const items = this.currentItems.length ? this.currentItems : await this.loadItems();
		const availableTags = [...new Set(items.flatMap((candidate) => candidate.tags || []))];
		const modal = new OpportunityModal({
			app: this.host.app,
			stages: this.host.plugin.settings.boardStages,
			title: this.boardTitle(),
			boardFile: this.boardPath(),
			editData: item,
			onSave: (data: BoardFormData) => { void this.onSave(data, item); },
			onConvertToTask: item ? () => void this.convertToTask(item) : undefined,
			availableTags,
		});
		modal.open();
	}

	private relatedTasks(item: BoardItem): TaskItem[] {
		const recordedIds = new Set(item.taskIds || []);
		return this.currentTasks.filter((task) =>
			recordedIds.has(task.id) || (task.opportunityIds || []).includes(item.id),
		);
	}

	private async convertToTask(item: BoardItem): Promise<void> {
		await this.host.openTaskModal(undefined, {
			defaultTitle: item.title,
			opportunityId: item.id,
			onCreated: (taskId) => { void this.linkTask(item, taskId); },
		});
	}

	private async linkTask(item: BoardItem, taskId: string): Promise<void> {
		const taskIds = Array.from(new Set([...(item.taskIds || []), taskId]));
		await updateOpportunity(this.host.app, this.boardPath(), item.id, { taskIds }, this.boardTitle());
		const index = this.currentItems.findIndex((candidate) => candidate.id === item.id);
		if (index >= 0 && this.currentItems[index]) {
			this.currentItems[index] = { ...this.currentItems[index], taskIds };
		}
		this.cache = { at: Date.now(), items: this.currentItems };
		this.host.showToast('已创建关联任务');
		void this.refreshBoard();
	}

	private openRelatedTasksModal(item: BoardItem): void {
		const tasks = this.relatedTasks(item);
		const host = this.host;
		const boardTitle = this.boardTitle();
		class RelatedTasksModal extends Modal {
			onOpen(): void {
				this.contentEl.addClass('mq-ad-task-modal', 'mq-op-related-modal');
				this.contentEl.createEl('h3', { cls: 'mq-ad-modal-title', text: boardTitle + '关联任务' });
				if (!tasks.length) {
					this.contentEl.createDiv({ cls: 'mq-op-related-empty', text: '暂未转化为任务' });
					return;
				}
				const list = this.contentEl.createDiv({ cls: 'mq-op-related-list' });
				for (const task of tasks) {
					const row = list.createEl('button', { cls: 'mq-op-related-task', text: task.content });
					row.addEventListener('click', () => {
						this.close();
						host.openTaskEditModal(task);
					});
				}
			}

			onClose(): void {
				this.contentEl.empty();
			}
		}
		new RelatedTasksModal(this.host.app).open();
	}

	private async openLink(it: BoardItem): Promise<void> {
		const link = (it.link || '').trim();
		if (!link) { this.host.showToast('该条目暂无链接'); return; }
		await this.host.app.workspace.openLinkText(link.replace(/^\[\[/, '').replace(/\]\]$/, ''), '', true);
	}

	private async onSave(data: BoardFormData, item?: BoardItem): Promise<void> {
		const path = this.boardPath();
		const title = this.boardTitle();
		if (item) {
			const patch: Partial<BoardItem> = {
				title: data.title, status: data.status, tags: data.tags, notes: data.notes, stageNotes: data.stageNotes, link: data.link, starred: data.starred,
			};
			await updateOpportunity(this.host.app, path, item.id, patch, title);
			const idx = this.currentItems.findIndex((i) => i.id === item.id);
			if (idx >= 0) {
				const cur = this.currentItems[idx];
				if (cur) this.currentItems[idx] = { ...cur, ...patch };
			}
		} else {
			const created = await createOpportunity(this.host.app, path, data, title);
			this.currentItems.push(created);
		}
		this.currentItems = sortBoardItems(this.currentItems, this.stageLabels());
		this.cache = { at: Date.now(), items: this.currentItems };
		this.host.showToast(item ? (this.boardTitle() + '已更新') : (this.boardTitle() + '已创建'));
		void this.refreshBoard();
	}

	private async createItem(): Promise<void> {
		this.openModal(undefined);
	}

	private async setItemStatus(item: BoardItem, status: string): Promise<void> {
		const path = this.boardPath();
		await updateBoardItemStatus(this.host.app, path, item.id, status, this.boardTitle());
		const idx = this.currentItems.findIndex((i) => i.id === item.id);
		if (idx >= 0) {
			const cur = this.currentItems[idx];
			if (cur) {
				// 只改状态；星标是独立的「重要 / 待跟进」标记，不随状态切换被清除
				this.currentItems[idx] = { ...cur, status };
			}
		}
		this.cache = { at: Date.now(), items: this.currentItems };
		this.host.showToast('状态已更新为「' + status + '」');
		void this.refreshBoard();
	}

	private async setItemStarred(item: BoardItem, val: boolean): Promise<void> {
		const path = this.boardPath();
		await toggleBoardItemStarred(this.host.app, path, item.id, val, this.boardTitle());
		const idx = this.currentItems.findIndex((i) => i.id === item.id);
		if (idx >= 0) {
			const cur = this.currentItems[idx];
			if (cur) this.currentItems[idx] = { ...cur, starred: val };
		}
		this.cache = { at: Date.now(), items: this.currentItems };
		void this.refreshBoard();
	}

	private async deleteItem(item: BoardItem): Promise<void> {
		const path = this.boardPath();
		await deleteOpportunity(this.host.app, path, item.id, this.boardTitle());
		this.currentItems = this.currentItems.filter((i) => i.id !== item.id);
		this.cache = { at: Date.now(), items: this.currentItems };
		this.host.showToast(this.boardTitle() + '已删除');
		void this.refreshBoard();
	}

	private async refreshBoard(): Promise<void> {
		if (this.host.currentPage !== 'opportunity') return;
		const [items, tasks] = await Promise.all([this.loadItems(), this.host.taskStore.scanAllTasks()]);
		if (this.host.currentPage !== 'opportunity' || !this.host.boardEl) return;
		this.currentItems = items;
		this.currentTasks = tasks;
		const sidebar = this.host.boardEl?.querySelector('.mq-op-sidebar') as HTMLElement | undefined;
		if (sidebar) this.renderSidebar(sidebar);
		this.renderPanels();
	}

}
