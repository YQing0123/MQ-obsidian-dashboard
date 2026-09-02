import { Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, DEFAULT_HOME_MODULES, HOME_LAYOUT_VERSION, DashboardSettings, DashboardSettingTab, type CountdownCardConfig } from './settings';
import { DashboardView, VIEW_TYPE } from './views/DashboardView';
import { KnowledgeWorkbenchView, KNOWLEDGE_WORKBENCH_VIEW_TYPE } from './views/KnowledgeWorkbenchView';
import { KnowledgeWorkbenchController } from './KnowledgeWorkbenchController';
import type { BoardStage } from './data/opportunityParser';

export default class Dashboard extends Plugin {
	declare settings: DashboardSettings;
	knowledgeWorkbench!: KnowledgeWorkbenchController;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.knowledgeWorkbench = new KnowledgeWorkbenchController(
			() => this.settings.knowledgeWorkbench,
			(message) => console.log('[Knowledge Workbench]', message),
			() => this.saveSettings(),
		);

		this.registerView(VIEW_TYPE, (leaf) => new DashboardView(leaf, this));
		this.registerView(KNOWLEDGE_WORKBENCH_VIEW_TYPE, (leaf) => new KnowledgeWorkbenchView(leaf, this));
		this.app.workspace.onLayoutReady(() => {
			void this.migrateLegacyDashboardViews();
			this.removeRetiredLocalWebAppLeaves();
		});

		this.addRibbonIcon('house', '工作台', () => {
			void this.activateView();
		});

		this.addCommand({
			id: 'open-dashboard',
			name: '打开工作台',
			callback: () => {
				void this.activateView();
			},
		});

		this.addCommand({
			id: 'open-knowledge-workbench',
			name: 'Open Knowledge Workbench',
			callback: () => { void this.openKnowledgeWorkbench('dashboard'); },
		});
		this.addCommand({ id: 'open-ai-qa', name: '打开 AI 问答', callback: () => { void this.openAiQa(); } });

		this.addSettingTab(new DashboardSettingTab(this.app, this));
		/* 服务由插件加载时自动启动；Workbench View 打开时仍会再次健康检查。 */
		if (this.settings.knowledgeWorkbench.enabled) void this.knowledgeWorkbench.ensureStarted();
	}

	onunload(): void { void this.knowledgeWorkbench?.stopOwnedProcess(); }

	async loadSettings(): Promise<void> {
		const loaded = ((await this.loadData()) ?? {}) as Partial<DashboardSettings> & {
			quickCapture?: { templateFolder?: string; templateFile?: string };
			diary?: { templateFolder?: string; templateFile?: string };
		};
		// ⚠️ 必须在 Object.assign 之前取原始版本号：合并后缺失字段会被默认值填成最新版，
		//    迁移判断就永远不会触发（老用户的错误比例将无法被纠正）。
		const storedLayoutVersion = typeof loaded.homeLayoutVersion === 'number' ? loaded.homeLayoutVersion : 0;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);
		this.settings.banner = { ...DEFAULT_SETTINGS.banner, ...(loaded.banner ?? {}) };
		this.settings.pomodoro = { ...DEFAULT_SETTINGS.pomodoro, ...(loaded.pomodoro ?? {}) };
		this.settings.knowledgeWorkbench = {
			...DEFAULT_SETTINGS.knowledgeWorkbench,
			...(loaded.knowledgeWorkbench ?? {}),
			extraRawScanPaths: Array.isArray(loaded.knowledgeWorkbench?.extraRawScanPaths)
				? loaded.knowledgeWorkbench!.extraRawScanPaths
				: [...DEFAULT_SETTINGS.knowledgeWorkbench.extraRawScanPaths],
		};
		this.settings.aiQa = {
			...DEFAULT_SETTINGS.aiQa,
			...(loaded.aiQa ?? {}),
			webSearch: { ...DEFAULT_SETTINGS.aiQa.webSearch, ...(loaded.aiQa?.webSearch ?? {}) },
			providers: Array.isArray(loaded.aiQa?.providers) ? loaded.aiQa!.providers : [],
			mcpServers: Array.isArray(loaded.aiQa?.mcpServers) ? loaded.aiQa!.mcpServers : [],
			deepResearchRounds: Math.min(5, Math.max(1, Number(loaded.aiQa?.deepResearchRounds) || 3)),
		};
		if (!this.settings.aiQa.mcpServers.some((server) => server.id === 'sag-knowledge')) {
			this.settings.aiQa.mcpServers.unshift({ id: 'sag-knowledge', displayName: 'SAG 知识库', transport: 'streamable-http', url: 'http://localhost:8000/mcp/', enabled: true, readOnlyByDefault: true, authKeychainId: 'mq-aiqa-mcp-sag-knowledge' });
		}
		for (const provider of this.settings.aiQa.providers) {
			provider.id = provider.id || provider.providerId || crypto.randomUUID();
			provider.providerId = provider.providerId || provider.id;
			provider.displayName = provider.displayName || provider.providerId;
			provider.baseUrl = provider.baseUrl || '';
			provider.protocol = provider.protocol === 'openai-responses' ? 'openai-responses' : 'openai-compatible';
			provider.models = Array.isArray(provider.models) ? provider.models.map((model) => ({ ...model, displayName: model.displayName || model.id, contextWindow: Number(model.contextWindow) || 128000, maxOutputTokens: Number(model.maxOutputTokens) || 8192 })) : [];
			provider.enabled = provider.enabled !== false;
			if (provider.apiKey && this.app.secretStorage) {
				provider.apiKeyKeychainId ||= `mq-aiqa-${provider.id.replace(/[^a-z0-9-]/gi, '').toLowerCase()}`;
				this.app.secretStorage.setSecret(provider.apiKeyKeychainId, provider.apiKey);
				delete provider.apiKey;
			}
		}
		const migrateModelRef = (value: unknown): { providerId: string; modelId: string } | undefined => {
			if (!value || typeof value !== 'object') return undefined;
			const ref = value as { providerId?: unknown; modelId?: unknown };
			return typeof ref.providerId === 'string' && typeof ref.modelId === 'string' ? { providerId: ref.providerId, modelId: ref.modelId } : undefined;
		};
		this.settings.aiQa.defaultModel = migrateModelRef(this.settings.aiQa.defaultModel);
		this.settings.aiQa.webModel = migrateModelRef(this.settings.aiQa.webModel);
		// 迁移：旧版「模板文件夹 + 模板文件名」合并为「模板文件（完整路径）」
		for (const key of ['quickCapture', 'diary'] as const) {
			const grp = loaded[key];
			if (grp && grp.templateFolder && grp.templateFile && !grp.templateFile.includes('/') && !grp.templateFile.endsWith('.md')) {
				(this.settings[key] as { templateFile: string }).templateFile = `${grp.templateFolder}/${grp.templateFile}`;
			}
		}
		// 归一化首页模块布局：旧版数据可能缺失 cols/rows 字段，导致所有卡片回退为 1:1
		// 且比例/顺序无法持久化。此处补全缺失字段、补齐新增模块，并按需执行版本迁移。
		this.normalizeHomeModules(storedLayoutVersion);
		this.normalizeCountdownCards(loaded.countdown);
		// 迁移看板阶段结构：旧数据用 kind(终态)，新结构用 hasInput(是否启用输入框)。
		this.normalizeBoardStages();
	}

	/**
	 * 将旧版单个 countdown（以及 Xove 早期的 countdown 数组）迁移为带唯一 ID 的卡片列表。
	 * 唯一 ID 让每张倒计时可以复用首页既有的独立排序与缩放机制，而不会互相覆盖布局。
	 */
	private normalizeCountdownCards(rawCountdown: unknown): void {
		const existing = this.settings.countdownCards;
		const rawList = Array.isArray(existing)
			? existing
			: Array.isArray(rawCountdown)
				? rawCountdown
				: [this.settings.countdown];
		const legacyOrder = this.settings.homeModules?.find((module) => module.id === 'countdown')?.order ?? 6;
		const usedIds = new Set<string>();
		const cards: CountdownCardConfig[] = [];
		for (const [index, raw] of rawList.entries()) {
			if (!raw || typeof raw !== 'object' || cards.length >= 5) continue;
			const item = raw as Partial<CountdownCardConfig>;
			let id = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `countdown-${index + 1}`;
			while (usedIds.has(id)) id = `${id}-${cards.length + 1}`;
			usedIds.add(id);
			cards.push({
				id,
				eventName: typeof item.eventName === 'string' && item.eventName.trim() ? item.eventName.trim() : '新年',
				targetDate: typeof item.targetDate === 'string' && item.targetDate ? item.targetDate : '2027-01-01',
				enabled: item.enabled !== false,
				order: typeof item.order === 'number' && Number.isFinite(item.order) ? item.order : legacyOrder + index,
				cols: typeof item.cols === 'number' && item.cols >= 1 && item.cols <= 4 ? Math.round(item.cols) : 1,
				rows: typeof item.rows === 'number' && item.rows >= 1 && item.rows <= 4 ? Math.round(item.rows) : 1,
			});
		}
		const changed = JSON.stringify(existing) !== JSON.stringify(cards);
		this.settings.countdownCards = cards;
		if (changed) void this.saveSettings();
	}

	/**
	 * 归一化 + 迁移首页模块布局，保证 homeModules 始终是一份完整可用的数据：
	 * 1. 缺失/损坏 → 直接用默认布局；
	 * 2. 补齐新增模块（老 data.json 不含新卡片时不会「丢卡」）；
	 * 3. 修正非法的 cols/rows/order/enabled；
	 * 4. 版本迁移：storedVersion < HOME_LAYOUT_VERSION 时，把 cols/rows 重置为最新默认值
	 *    （保留用户的显隐与排序）。此前比例功能存在 bug 从未真正落盘，故一次性纠正是安全的。
	 */
	private normalizeHomeModules(storedVersion: number): void {
		const defaults = new Map(DEFAULT_HOME_MODULES.map((m) => [m.id, m]));
		let hm = this.settings.homeModules;
		let changed = false;

		if (!Array.isArray(hm) || hm.length === 0) {
			hm = DEFAULT_HOME_MODULES.map((m) => ({ ...m }));
			this.settings.homeModules = hm;
			changed = true;
		}

		// 补齐 data.json 中缺失的模块（版本升级新增卡片时不丢卡）
		for (const d of DEFAULT_HOME_MODULES) {
			if (!hm.some((m) => m.id === d.id)) {
				hm.push({ ...d, order: hm.length });
				changed = true;
			}
		}

		const migrate = storedVersion < HOME_LAYOUT_VERSION;
		for (const m of hm) {
			const d = defaults.get(m.id);
			const dc = d?.cols ?? 1;
			const dr = d?.rows ?? 1;
			// 迁移：强制回到最新默认比例（仅比例，显隐/顺序保留）
			if (migrate && d) {
				if (m.cols !== dc || m.rows !== dr) { m.cols = dc; m.rows = dr; changed = true; }
			}
			if (typeof m.cols !== 'number' || !Number.isFinite(m.cols) || m.cols < 1 || m.cols > 4) { m.cols = dc; changed = true; }
			if (typeof m.rows !== 'number' || !Number.isFinite(m.rows) || m.rows < 1 || m.rows > 4) { m.rows = dr; changed = true; }
			if (typeof m.order !== 'number' || !Number.isFinite(m.order)) { m.order = 0; changed = true; }
			if (typeof m.enabled !== 'boolean') { m.enabled = true; changed = true; }
		}

		// order 去重并压实为 0..n-1，避免相同 order 导致排序不稳定（表现为「顺序时好时坏」）
		const sorted = [...hm].sort((a, b) => a.order - b.order);
		sorted.forEach((m, i) => {
			if (m.order !== i) { m.order = i; changed = true; }
		});

		if (this.settings.homeLayoutVersion !== HOME_LAYOUT_VERSION) {
			this.settings.homeLayoutVersion = HOME_LAYOUT_VERSION;
			changed = true;
		}
		if (changed) void this.saveSettings();
	}

	/**
	 * 迁移看板阶段结构（向后兼容旧 data.json）：
	 * 旧结构 BoardStage 含 kind(终态)，新结构改为 hasInput(是否在该阶段启用输入框)。
	 * 迁移规则：由旧 kind 推导 hasInput（终态 done/dropped → false，其余 → true），
	 * 随后删除 kind 字段，保证旧数据无缝升级且不丢失任何阶段。
	 */
	private normalizeBoardStages(): void {
		const defs = DEFAULT_SETTINGS.boardStages;
		let stages = this.settings.boardStages;
		let changed = false;

		if (!Array.isArray(stages) || stages.length === 0) {
			stages = defs.map((s) => ({ ...s }));
			this.settings.boardStages = stages;
			changed = true;
		}

		for (const st of stages) {
			if (!st || typeof st !== 'object') continue;
			const raw = st as BoardStage & { kind?: string };
			if ('kind' in raw) {
				// 旧数据：由 kind 推导 hasInput，再删除 kind
				if (typeof raw.hasInput !== 'boolean') {
					raw.hasInput = raw.kind === 'done' || raw.kind === 'dropped' ? false : true;
				}
				delete (raw as { kind?: string }).kind;
				changed = true;
			} else if (typeof raw.hasInput !== 'boolean') {
				raw.hasInput = true;
				changed = true;
			}
		}

		if (changed) void this.saveSettings();
	}

	/** 恢复首页默认布局（显隐 / 顺序 / 比例全部回到默认） */
	async resetHomeLayout(): Promise<void> {
		this.settings.homeModules = DEFAULT_HOME_MODULES.map((m) => ({ ...m }));
		this.settings.homeLayoutVersion = HOME_LAYOUT_VERSION;
		await this.saveSettings();
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/**
	 * This plugin used to share `dashboard-view` with Xove. Migrate only the
	 * pre-existing local view once, then persist the marker so future Xove views
	 * with that legacy type remain untouched.
	 */
	private async migrateLegacyDashboardViews(): Promise<void> {
		if (this.settings.legacyDashboardViewMigrated) return;
		const legacyLeaves = this.app.workspace.getLeavesOfType('dashboard-view');
		for (const leaf of legacyLeaves) {
			await leaf.setViewState({ type: VIEW_TYPE, active: leaf === this.app.workspace.activeLeaf });
		}
		this.settings.legacyDashboardViewMigrated = true;
		await this.saveSettings();
	}


	/** Remove inactive tabs left behind by the retired local-web-app experiment. */
	private removeRetiredLocalWebAppLeaves(): void {
		const retiredTypes = new Set(['mq-sag-knowledge-view', 'mq-deepseek-view']);
		const leaves: import('obsidian').WorkspaceLeaf[] = [];
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (retiredTypes.has(leaf.getViewState().type)) leaves.push(leaf);
		});
		leaves.forEach((leaf) => leaf.detach());
	}

	/**
	 * Switch Obsidian's own light/dark appearance.
	 *
	 * `vault.setConfig('theme', ...)` is an internal (undocumented) API — it is the
	 * only way to drive the global appearance from a plugin, so it is called
	 * defensively and the body classes are updated as a fallback in case the
	 * internal call is missing or renamed in a future Obsidian release.
	 */
	setObsidianTheme(mode: 'light' | 'dark'): void {
		try {
			const vault = this.app.vault as unknown as { setConfig?: (key: string, value: unknown) => void };
			// 'moonstone' = light, 'obsidian' = dark (Obsidian's internal naming).
			vault.setConfig?.('theme', mode === 'light' ? 'moonstone' : 'obsidian');
		} catch (err) {
			console.error('[Dashboard] failed to set Obsidian theme', err);
		}
		// Reflect immediately regardless of the internal API's behaviour.
		document.body.classList.toggle('theme-light', mode === 'light');
		document.body.classList.toggle('theme-dark', mode === 'dark');
		this.app.workspace.trigger('css-change');
	}

	/** Current effective Obsidian appearance. */
	currentObsidianTheme(): 'light' | 'dark' {
		return document.body.classList.contains('theme-light') ? 'light' : 'dark';
	}

	/** Refresh the header theme toggle (icon + tooltip) in every open dashboard view. */
	refreshThemeButtons(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
			const view = leaf.view;
			if (view instanceof DashboardView) view.refreshThemeButton();
		}
	}

	/** Push the current custom-title setting into any open dashboard view. */
	refreshDashboardTitle(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
			const view = leaf.view;
			if (view instanceof DashboardView) view.refreshTitle();
		}
	}

	/** Refresh task cards after their display preference changes. */
	refreshTodoHome(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
			const view = leaf.view;
			if (view instanceof DashboardView) {
				view.refreshTodo();
				view.refreshWeekly();
			}
		}
	}

	/** Push the persisted banner mode/image settings into open dashboard views. */
	refreshBanner(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
			const view = leaf.view;
			if (view instanceof DashboardView) view.refreshBanner();
		}
	}

	/** 设置页修改首页模块显隐/排序后，立即重建所有已打开的仪表盘首页 */
	refreshHome(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
			const view = leaf.view;
			if (view instanceof DashboardView) view.rebuildHome();
		}
	}

	/** 设置页修改看板开关/名称/阶段配置后，立即刷新所有已打开视图的导航与看板页（无需重启） */
	refreshNav(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
			const view = leaf.view;
			if (view instanceof DashboardView) view.refreshNav();
		}
	}

	/** Apply the performance setting without requiring a workspace reload. */
	refreshNoiseOverlays(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
			const view = leaf.view;
			if (view instanceof DashboardView) view.refreshNoiseOverlay();
		}
	}

	private async activateView(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE);
		if (existing.length > 0 && existing[0]) {
			void this.app.workspace.revealLeaf(existing[0]);
			return;
		}
		const leaf = this.app.workspace.getLeaf('tab');
		if (!leaf) return;
		await leaf.setViewState({ type: VIEW_TYPE, active: true });
		void this.app.workspace.revealLeaf(leaf);
	}

	async openKnowledgeWorkbench(page = 'dashboard'): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(KNOWLEDGE_WORKBENCH_VIEW_TYPE);
		let leaf = existing[0];
		if (!leaf) {
			leaf = this.app.workspace.getLeaf('tab');
			if (!leaf) return;
			await leaf.setViewState({ type: KNOWLEDGE_WORKBENCH_VIEW_TYPE, active: true });
		}
		await this.app.workspace.revealLeaf(leaf);
		const view = leaf.view;
		if (view instanceof KnowledgeWorkbenchView) view.setPage(page);
	}

	async openAiQa(): Promise<void> {
		let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
		if (!leaf) { await this.activateView(); leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]; }
		if (!leaf) return;
		await this.app.workspace.revealLeaf(leaf);
		if (leaf.view instanceof DashboardView) await leaf.view.showAiQa();
	}

	/** 重新加载工作台服务配置；只停止本插件自己创建的子进程。 */
	async restartKnowledgeWorkbench(): Promise<void> {
		await this.knowledgeWorkbench?.stopOwnedProcess();
		if (this.settings.knowledgeWorkbench.enabled) await this.knowledgeWorkbench.ensureStarted();
	}
}
