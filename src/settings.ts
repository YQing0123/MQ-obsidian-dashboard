import { App, Notice, PluginSettingTab, Setting, TFile, TFolder, requestUrl } from 'obsidian';
import Dashboard from './main';
import type { BoardStage } from './data/opportunityParser';
import { normalizeOpenAiBaseUrl } from './aiQa/transport';

export type BannerLeftStat = 'totalNotes' | 'tagsCount' | 'totalLinks' | 'newThisMonth' | 'newThisWeek' | 'totalTasks' | 'doneTasks' | 'pendingTasks';
export type BannerCenterStat = 'streak' | 'taskCompletion' | 'connectivity' | 'newThisWeek';
export type BannerRightStat = 'taskCompletion' | 'overdueRate' | 'connectivity' | 'orphanRate' | 'avgLinksPerNote';

export interface BannerStatsConfig {
	showDetails?: boolean;
	showLeft?: boolean;
	showCenter?: boolean;
	showRight?: boolean;
	leftStat?: BannerLeftStat;
	centerStat?: BannerCenterStat;
	rightStats?: BannerRightStat[];
	blur?: number;
	darkness?: number;
	accent?: string;
}

export interface BannerSettings {
	imageDataUrl: string | null;
	offsetY: number;
	mode?: 'poster' | 'stats';
	statsConfig?: BannerStatsConfig;
}

export interface QuickCaptureSettings {
	storagePath: string;
	namingPattern: string;
	templateFile: string;
}

export interface DiarySettings {
	storagePath: string;
	namingPattern: string;
	templateFile: string;
}

export interface KnowledgeWorkbenchSettings {
	enabled: boolean;
	serverRoot: string;
	nodePath: string;
	host: string;
	port: number;
	vaultRoot: string;
	extraRawScanPaths: string[];
}

export type AiQaProtocol = 'openai-compatible' | 'openai-responses';
export interface AiQaModel { id: string; displayName: string; contextWindow: number; maxOutputTokens: number; supportsVision?: boolean; supportsTools?: boolean; reasoningEfforts?: string[]; }
export interface AiQaProvider { id: string; providerId: string; displayName: string; baseUrl: string; protocol: AiQaProtocol; apiKeyKeychainId?: string; apiKey?: string; models: AiQaModel[]; enabled: boolean; }
export interface AiQaMcpServer { id: string; displayName: string; transport: 'streamable-http' | 'stdio'; url?: string; command?: string; args?: string[]; enabled: boolean; allowedTools?: string[]; readOnlyByDefault: boolean; authKeychainId?: string; headers?: Record<string, string>; }
export interface AiQaSettings { providers: AiQaProvider[]; defaultModel?: { providerId: string; modelId: string }; webModel?: { providerId: string; modelId: string }; deepResearchRounds: number; sessionFolder: string; mcpServers: AiQaMcpServer[]; }

/** 倒计时卡片自定义事件：事件名称与目标日期 */
export interface CountdownSettings {
	/** 事件名称，如「高考」「新年」；文案显示「距离 {eventName} 还有」 */
	eventName: string;
	/** 目标日期，ISO yyyy-mm-dd；非法或留空时回退到「下一年 1 月 1 日」 */
	targetDate: string;
}

/** 首页中一张可独立移动、缩放和编辑的倒计时卡片。 */
export interface CountdownCardConfig extends CountdownSettings {
	id: string;
	enabled: boolean;
	order: number;
	cols?: number;
	rows?: number;
}

/** 首页番茄计时配置；计时记录由当前插件单独保存。 */
export interface PomodoroSettings {
	pomodoroWorkMinutes: number;
	pomodoroShortBreakMinutes: number;
	pomodoroLongBreakMinutes: number;
	pomodoroLongBreakInterval: number;
	pomodoroDailyGoal: number;
	pomodoroAutoStartBreak: boolean;
	pomodoroSoundEnabled: boolean;
}

export interface PomodoroRecord { timestamp: string; activity: string; duration: number; interruptions?: number; breakMinutes?: number; breakCompleted?: boolean; }
export interface PomodoroSession { date: string; completed: number; records: PomodoroRecord[]; }
export interface PomodoroTag { name: string; pinned: boolean; }

/** 通用看板的一个阶段（看板列）— 结构定义见 src/data/opportunityParser.ts 的 BoardStage */
export type { BoardStage } from './data/opportunityParser';

export interface DashboardSettings {
	banner: BannerSettings;
	quickCapture: QuickCaptureSettings;
	diary: DiarySettings;
	knowledgeWorkbench: KnowledgeWorkbenchSettings;
	todoSourceFolder: string;
	/** 在 TODO 卡片中保留当天完成的任务，便于回顾。 */
	todoShowCompleted: boolean;
	/** 任务编辑弹窗是否显示项目归属、类型与父任务。 */
	taskDetailMode: 'detail' | 'compact';
	projectsFolder: string;
	currentPoView: string;
	poProjectOrder: string[];
	poTaskOrder: string[];
	theme: 'auto' | 'dark' | 'light';
	dashboardTitle: string;
	npdpStages: string[];
	npdpMaxStage: number;
	npdpProgressFilter?: number;
	poGanttStatusFilter?: string[];
	poGanttScale?: 'day' | 'week' | 'month' | 'quarter';
	/** 项目看板所有状态列共享宽度（像素）。 */
	poKanbanColumnWidth?: number;
	/** 甘特图左侧任务树宽度（像素）。 */
	poGanttLabelWidth?: number;
	boardEnabled: boolean;
	boardTitle: string;
	boardStages: BoardStage[];
	opportunityFile: string;
	currentOppView: string;
	/** 灵感看板所有状态列共享宽度（像素）。 */
	oppKanbanColumnWidth?: number;
	/** 灵感列表各列宽度（像素，按列 key 存储）。 */
	oppListColumnWidths?: Record<string, number>;
	/** 首页模块显隐与排序：每个模块一个开关 + 顺序权重 + 比例；重置见「恢复默认布局」 */
	homeModules?: HomeModuleConfig[];
	/** 首页布局数据版本；低于 HOME_LAYOUT_VERSION 时由 main.ts 迁移并重置默认比例 */
	homeLayoutVersion?: number;
	/** 倒计时卡片自定义事件（事件名称 + 目标日期） */
	countdown: CountdownSettings;
	/** 多张独立倒计时卡片；缺失时由旧版 countdown 自动迁移。 */
	countdownCards?: CountdownCardConfig[];
	pomodoro?: PomodoroSettings;
	pomodoroSessions?: PomodoroSession[];
	pomodoroActivity?: string;
	pomodoroTags?: PomodoroTag[];
	/** 仅用于一次性迁移旧 dashboard-view，避免后续触碰 Xove 的视图。 */
	legacyDashboardViewMigrated?: boolean;
	/** 首页背景颗粒。默认关闭，避免为装饰效果持续占用渲染线程。 */
	showNoiseOverlay: boolean;
	aiQa: AiQaSettings;
}

/**
 * 首页布局数据版本。
 * 每当「默认比例」发生变更、且需要覆盖用户 data.json 中的旧值时递增。
 * v2：修正 projects（项目情况）为宽 2 高 1；heatmap（笔记统计）最低宽 3 高 1（即 3:1）。
 * v3：默认布局重排为 快捕/todo/进度 各 1×1、本周待办 1×2、项目情况 3×1、笔记统计 3×1、倒计时 1×1。
 */
export const HOME_LAYOUT_VERSION = 3;

/** 首页单个模块的显隐/排序/比例配置 */
export interface HomeModuleConfig {
	id: string;
	enabled: boolean;
	order: number;
	/** 宽度所占网格列数（1-4，4 = 页面最宽），默认 1 */
	cols?: number;
	/** 高度所占网格行比例（与 cols 共同决定卡片比例；如 2×1 为宽卡，1×2 为竖卡），默认 1 */
	rows?: number;
}

export const DEFAULT_SETTINGS: DashboardSettings = {
	banner: { imageDataUrl: null, offsetY: 0, mode: 'poster', statsConfig: { showDetails: true, showLeft: true, showCenter: true, showRight: true, leftStat: 'totalNotes', centerStat: 'streak', rightStats: ['taskCompletion', 'overdueRate', 'avgLinksPerNote'], blur: 2, darkness: 20 } },
	quickCapture: {
		storagePath: '00 inbox/速记',
		namingPattern: 'YYYY-MM-DD HH-mm 捕捉',
		templateFile: '',
	},
	diary: {
		storagePath: 'Daily',
		namingPattern: 'YYYY-MM-DD',
		templateFile: '',
	},
	knowledgeWorkbench: {
		enabled: true,
		serverRoot: '/Users/yqing/Documents/Project/work-space/Knowledge-workbench-server',
		nodePath: 'node',
		host: '127.0.0.1',
		port: 5173,
		vaultRoot: '/Users/yqing/Documents/Project/work-space/鸣谦知识库',
		extraRawScanPaths: [],
	},
	todoSourceFolder: '',
	todoShowCompleted: false,
	taskDetailMode: 'detail',
	projectsFolder: 'Projects',
	currentPoView: 'gantt',
	poProjectOrder: [],
	poTaskOrder: [],
	theme: 'auto',
	dashboardTitle: '',
	npdpStages: ['立项', '规划', '开发', '测试', '上线'],
	npdpMaxStage: 5,
	npdpProgressFilter: 5,
	poGanttStatusFilter: [],
	poGanttScale: 'week',
	poKanbanColumnWidth: 270,
	poGanttLabelWidth: 300,
	boardEnabled: true,
	boardTitle: '灵感收集',
	boardStages: [
		{ id: 'inbox', label: '收集箱', color: '#888780', hasInput: true },
		{ id: 'eval', label: '评估中', color: '#378ADD', hasInput: true },
		{ id: 'doing', label: '进行中', color: '#185FA5', hasInput: true },
		{ id: 'done', label: '已完成', color: '#639922', hasInput: false },
		{ id: 'dropped', label: '已放弃', color: '#E24B4A', hasInput: false },
	],
	opportunityFile: '看板.md',
	currentOppView: 'kanban',
	oppKanbanColumnWidth: 230,
	oppListColumnWidths: {},
	showNoiseOverlay: false,
	aiQa: { providers: [], deepResearchRounds: 3, sessionFolder: 'AI问答', mcpServers: [{ id: 'sag-knowledge', displayName: 'SAG 知识库', transport: 'streamable-http', url: 'http://localhost:8000/mcp/', enabled: true, readOnlyByDefault: true, authKeychainId: 'mq-aiqa-mcp-sag-knowledge' }] },
	homeLayoutVersion: HOME_LAYOUT_VERSION,
	countdown: { eventName: '2027', targetDate: '2027-01-01' },
	pomodoro: {
		pomodoroWorkMinutes: 25,
		pomodoroShortBreakMinutes: 5,
		pomodoroLongBreakMinutes: 15,
		pomodoroLongBreakInterval: 4,
		pomodoroDailyGoal: 8,
		pomodoroAutoStartBreak: true,
		pomodoroSoundEnabled: true,
	},
	homeModules: [
		{ id: 'quick-capture', enabled: true, order: 0, cols: 1, rows: 1 },
		{ id: 'todo', enabled: true, order: 1, cols: 1, rows: 1 },
		{ id: 'progress', enabled: true, order: 2, cols: 1, rows: 1 },
		{ id: 'weekly', enabled: true, order: 3, cols: 1, rows: 2 },
		{ id: 'completed-history', enabled: true, order: 4, cols: 1, rows: 2 },
		{ id: 'projects', enabled: true, order: 5, cols: 3, rows: 1 },
		{ id: 'heatmap', enabled: true, order: 6, cols: 3, rows: 1 },
		{ id: 'countdown', enabled: true, order: 7, cols: 1, rows: 1 },
		{ id: 'calendar', enabled: false, order: 8, cols: 2, rows: 2 },
		{ id: 'pomodoro', enabled: false, order: 9, cols: 1, rows: 1 },
	],
};

/** 首页模块默认布局（与 DEFAULT_SETTINGS.homeModules 保持一致，供「恢复默认布局」深拷贝） */
export const DEFAULT_HOME_MODULES: HomeModuleConfig[] = [
	{ id: 'quick-capture', enabled: true, order: 0, cols: 1, rows: 1 },
	{ id: 'todo', enabled: true, order: 1, cols: 1, rows: 1 },
	{ id: 'progress', enabled: true, order: 2, cols: 1, rows: 1 },
	{ id: 'weekly', enabled: true, order: 3, cols: 1, rows: 2 },
	{ id: 'completed-history', enabled: true, order: 4, cols: 1, rows: 2 },
	{ id: 'projects', enabled: true, order: 5, cols: 3, rows: 1 },
	{ id: 'heatmap', enabled: true, order: 6, cols: 3, rows: 1 },
	{ id: 'countdown', enabled: true, order: 7, cols: 1, rows: 1 },
	{ id: 'calendar', enabled: false, order: 8, cols: 2, rows: 2 },
	{ id: 'pomodoro', enabled: false, order: 9, cols: 1, rows: 1 },
];

/* ---- helpers ---- */

function getVaultFolders(app: App): string[] {
	const folders = new Set<string>();
	folders.add('/');
	for (const file of app.vault.getFiles()) {
		if (file instanceof TFile && file.parent && file.parent.path !== '/') {
			folders.add(file.parent.path);
		}
	}
	const root = app.vault.getRoot();
	if (root) collectFolders(root, folders);
	return Array.from(folders).sort();
}

function collectFolders(folder: TFolder, out: Set<string>): void {
	for (const child of folder.children) {
		if (child instanceof TFolder) {
			out.add(child.path);
			collectFolders(child, out);
		}
	}
}

function addFolderDropdown(setting: Setting, app: App, current: string, onChange: (v: string) => Promise<void>): void {
	setting.addDropdown((dropdown) => {
		const folders = getVaultFolders(app);
		for (const f of folders) dropdown.addOption(f, f);
		if (current && !folders.includes(current)) dropdown.addOption(current, current);
		dropdown.setValue(current);
		dropdown.onChange(async (v) => onChange(v));
	});
}

export class DashboardSettingTab extends PluginSettingTab {
	plugin: Dashboard;

	constructor(app: App, plugin: Dashboard) {
		super(app, plugin);
		this.plugin = plugin;
	}

		display(): void {
		const { containerEl } = this;
		containerEl.empty();

		/* ---- 性能 ---- */
		new Setting(containerEl).setName('性能').setHeading();
		new Setting(containerEl)
			.setName('显示静态颗粒背景')
			.setDesc('默认关闭。开启时仅生成一次 128 × 128 背景纹理，不使用逐帧动画。')
			.addToggle((t) => t
				.setValue(this.plugin.settings.showNoiseOverlay)
				.onChange(async (v) => {
					this.plugin.settings.showNoiseOverlay = v;
					await this.plugin.saveSettings();
					this.plugin.refreshNoiseOverlays();
				}),
			);

		this.renderAiQaSettings(containerEl);

		/* ---- 快速捕捉 ---- */
		new Setting(containerEl).setName('快速捕捉').setHeading();

		addFolderDropdown(
			new Setting(containerEl).setName('存储路径').setDesc('捕捉笔记的存放位置'),
			this.app,
			this.plugin.settings.quickCapture.storagePath,
			async (v) => { this.plugin.settings.quickCapture.storagePath = v; await this.plugin.saveSettings(); },
		);

		new Setting(containerEl)
			.setName('文件命名规则')
			.setDesc('支持变量：YYYY 年、MM 月(2位)、MMM 月缩写(如 8月)、DD 日；ddd 周日、dddd 星期日；HH 24时、hh 12时、mm 分、ss/SS 秒、A 上午/下午')
			.addText((t) => t
				.setPlaceholder('YYYY-MM-DD HH-mm 捕捉')
				.setValue(this.plugin.settings.quickCapture.namingPattern)
				.onChange(async (v) => { this.plugin.settings.quickCapture.namingPattern = v; await this.plugin.saveSettings(); }),
			);

		new Setting(containerEl)
			.setName('模板文件')
			.setDesc('输入模板路径，不使用模板则为空')
			.addText((t) => t
				.setPlaceholder('Templates/速记.md')
				.setValue(this.plugin.settings.quickCapture.templateFile)
				.onChange(async (v) => {
					this.plugin.settings.quickCapture.templateFile = v.trim();
					await this.plugin.saveSettings();
				}),
			);

		/* ---- TODO ---- */
		new Setting(containerEl).setName('TODO 待办').setHeading();

		addFolderDropdown(
			new Setting(containerEl).setName('数据来源文件夹').setDesc('扫描该文件夹下的 Markdown 文件解析任务。留空则扫描整个知识库'),
			this.app,
			this.plugin.settings.todoSourceFolder,
			async (v) => { this.plugin.settings.todoSourceFolder = v; await this.plugin.saveSettings(); },
		);

		/* ---- 项目 ---- */
		new Setting(containerEl).setName('项目').setHeading();

		addFolderDropdown(
			new Setting(containerEl).setName('项目文件夹').setDesc('存放项目文件的文件夹路径'),
			this.app,
			this.plugin.settings.projectsFolder,
			async (v) => { this.plugin.settings.projectsFolder = v; await this.plugin.saveSettings(); },
		);

		new Setting(containerEl)
			.setName('甘特图默认时间粒度')
			.setDesc('项目总览的甘特图默认以该粒度展示。重新打开项目总览或重载插件后生效；也可在甘特图界面直接点击缩放按钮临时切换（会自动记住）')
			.addDropdown((dropdown) => {
				dropdown.addOption('week', '周（默认）');
				dropdown.addOption('day', '日');
				dropdown.addOption('month', '月');
				dropdown.addOption('quarter', '季度');
				dropdown.setValue(this.plugin.settings.poGanttScale || 'week');
				dropdown.onChange(async (v) => {
					this.plugin.settings.poGanttScale = v as 'day' | 'week' | 'month' | 'quarter';
					await this.plugin.saveSettings();
				});
			});

		/* ---- 看板 ---- */
		new Setting(containerEl).setName('看板').setHeading();

		new Setting(containerEl)
			.setName('启用看板')
			.setDesc('关闭后，顶部导航的看板入口与对应页面都会被隐藏；下方看板设置项同步折叠')
			.addToggle((t) => t
				.setValue(this.plugin.settings.boardEnabled)
				.onChange(async (v) => {
					this.plugin.settings.boardEnabled = v;
					await this.plugin.saveSettings();
					// 让所有已打开的仪表盘视图立即同步显示/隐藏看板入口，无需重启
					this.plugin.refreshNav();
					this.display();
				}),
			);

		// 看板相关设置项容器：看板关闭时整体折叠隐藏（联动）
		const boardOptions = containerEl.createDiv({ cls: 'dashboard-board-options' });
		if (!this.plugin.settings.boardEnabled) boardOptions.hide();

		new Setting(boardOptions)
			.setName('看板名称')
			.setDesc('导航与页面上显示的板块名称，可自定义（如 机会点 / 灵感收集 / 管道）')
			.addText((t) => t
				.setPlaceholder('看板')
				.setValue(this.plugin.settings.boardTitle)
				.onChange(async (v) => {
					this.plugin.settings.boardTitle = v.trim() || '看板';
					await this.plugin.saveSettings();
					this.plugin.refreshNav();
				}),
			);

		new Setting(boardOptions)
			.setName('看板数据文件')
			.setDesc('所有看板条目统一存于此 Markdown 文件（frontmatter 数组）。填写库内相对路径，可含子文件夹，如 看板.md。留空或文件不存在时会自动在该路径新建。')
			.addText((t) => t
				.setPlaceholder('看板.md')
				.setValue(this.plugin.settings.opportunityFile)
				.onChange(async (v) => {
					this.plugin.settings.opportunityFile = v.trim() || '看板.md';
					await this.plugin.saveSettings();
				}),
			);

		new Setting(boardOptions)
			.setName('阶段数量')
			.setDesc('看板列的数量（4-6 个）')
			.addDropdown((dropdown) => {
				for (const n of [4, 5, 6]) dropdown.addOption(String(n), `${n} 个阶段`);
				dropdown.setValue(String(this.plugin.settings.boardStages.length));
				dropdown.onChange(async (v) => {
					const newCount = parseInt(v);
					const cur = this.plugin.settings.boardStages;
					if (newCount > cur.length) {
						let i = cur.length;
						while (this.plugin.settings.boardStages.length < newCount) {
							this.plugin.settings.boardStages.push({ id: `stage${i + 1}`, label: `阶段${i + 1}`, color: '#888780', hasInput: false });
							i++;
						}
					} else {
						this.plugin.settings.boardStages = cur.slice(0, newCount);
					}
					await this.plugin.saveSettings();
					// 让已打开的机会页阶段列立即同步（无需切页）
					this.plugin.refreshNav();
					this.display();
				});
			});

		for (let i = 0; i < this.plugin.settings.boardStages.length; i++) {
			const idx = i;
			const st = this.plugin.settings.boardStages[idx];
			new Setting(boardOptions)
				.setName(`阶段 ${idx + 1}`)
				.setDesc(`自定义第 ${idx + 1} 个阶段的名称、颜色，以及是否在该阶段启用输入框`)
				.addText((t) => t
					.setPlaceholder(`阶段 ${idx + 1}`)
					.setValue(st?.label ?? '')
					.onChange(async (v) => { this.plugin.settings.boardStages[idx]!.label = v; await this.plugin.saveSettings(); this.plugin.refreshNav(); }),
				)
				.addText((t) => t
					.setPlaceholder('#888780')
					.setValue(st?.color ?? '')
					.onChange(async (v) => { this.plugin.settings.boardStages[idx]!.color = v.trim() || '#888780'; await this.plugin.saveSettings(); this.plugin.refreshNav(); }),
				)
				.addToggle((tg) => tg
					.setTooltip('启用后，处于该阶段的条目在编辑时会出现一个标题与该阶段名一致的输入框')
					.setValue(st?.hasInput ?? false)
					.onChange(async (v) => { this.plugin.settings.boardStages[idx]!.hasInput = v; await this.plugin.saveSettings(); }),
				);
		}

		/* ---- 新日记 ---- */
		new Setting(containerEl).setName('新日记').setHeading();

		addFolderDropdown(
			new Setting(containerEl).setName('日记存储路径').setDesc('日记笔记的存放位置'),
			this.app,
			this.plugin.settings.diary.storagePath,
			async (v) => { this.plugin.settings.diary.storagePath = v; await this.plugin.saveSettings(); },
		);

		new Setting(containerEl)
			.setName('日记命名规则')
			.setDesc('支持变量：YYYY 年、MM 月(2位)、MMM 月缩写(如 8月)、DD 日；ddd 周日、dddd 星期日；HH 24时、hh 12时、mm 分、ss/SS 秒、A 上午/下午')
			.addText((t) => t
				.setPlaceholder('YYYY-MM-DD')
				.setValue(this.plugin.settings.diary.namingPattern)
				.onChange(async (v) => { this.plugin.settings.diary.namingPattern = v; await this.plugin.saveSettings(); }),
			);

		new Setting(containerEl)
			.setName('模板文件')
			.setDesc('输入模板路径，不使用模板则为空')
			.addText((t) => t
				.setPlaceholder('Templates/日记.md')
				.setValue(this.plugin.settings.diary.templateFile)
				.onChange(async (v) => {
					this.plugin.settings.diary.templateFile = v.trim();
					await this.plugin.saveSettings();
				}),
			);

		/* ---- 任务展示 ---- */
		new Setting(containerEl).setName('任务展示').setHeading();

		new Setting(containerEl)
			.setName('完成后保留在首页')
			.setDesc('在 TODO 卡片中保留今天完成的任务，并以灰色删除线显示')
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.todoShowCompleted)
				.onChange(async (value) => {
					this.plugin.settings.todoShowCompleted = value;
					await this.plugin.saveSettings();
					this.plugin.refreshTodoHome();
				}),
			);

		new Setting(containerEl)
			.setName('任务详情显示')
			.setDesc('简洁模式隐藏项目归属、任务类型和父任务；保存时仍保留原有值')
			.addDropdown((dropdown) => dropdown
				.addOption('detail', '完整')
				.addOption('compact', '简洁')
				.setValue(this.plugin.settings.taskDetailMode)
				.onChange(async (value) => {
					this.plugin.settings.taskDetailMode = value as 'detail' | 'compact';
					await this.plugin.saveSettings();
				}),
			);

		/* ---- 首页卡片 ---- */
		new Setting(containerEl).setName('番茄计时').setHeading();
		const pomo = this.plugin.settings.pomodoro!;
		const numberSetting = (name: string, key: 'pomodoroWorkMinutes' | 'pomodoroShortBreakMinutes' | 'pomodoroLongBreakMinutes' | 'pomodoroLongBreakInterval' | 'pomodoroDailyGoal'): void => {
			new Setting(containerEl).setName(name).addText((input) => input.setValue(String(pomo[key])).setPlaceholder('25').onChange(async (value) => {
				const n = Math.max(1, Math.min(120, Number(value) || pomo[key])); pomo[key] = n; await this.plugin.saveSettings();
			}));
		};
		numberSetting('专注时长（分钟）', 'pomodoroWorkMinutes');
		numberSetting('短休息时长（分钟）', 'pomodoroShortBreakMinutes');
		numberSetting('长休息时长（分钟）', 'pomodoroLongBreakMinutes');
		numberSetting('长休息间隔（完成数）', 'pomodoroLongBreakInterval');
		numberSetting('每日番茄目标（完成数）', 'pomodoroDailyGoal');
		new Setting(containerEl).setName('自动开始休息').addToggle((toggle) => toggle.setValue(pomo.pomodoroAutoStartBreak).onChange(async (value) => { pomo.pomodoroAutoStartBreak = value; await this.plugin.saveSettings(); }));
		new Setting(containerEl).setName('完成时播放提示音').addToggle((toggle) => toggle.setValue(pomo.pomodoroSoundEnabled).onChange(async (value) => { pomo.pomodoroSoundEnabled = value; await this.plugin.saveSettings(); }));

		/* ---- 知识工作台 ---- */
		new Setting(containerEl).setName('知识工作台').setHeading();

		new Setting(containerEl)
			.setName('启用知识工作台')
			.setDesc('插件加载时自动启动独立 Knowledge Workbench HTTP 服务；关闭后不启动服务')
			.addToggle((t) => t
				.setValue(this.plugin.settings.knowledgeWorkbench.enabled)
				.onChange(async (v) => {
					this.plugin.settings.knowledgeWorkbench.enabled = v;
					await this.plugin.saveSettings();
					if (v) void this.plugin.restartKnowledgeWorkbench();
					else await this.plugin.knowledgeWorkbench.stopOwnedProcess();
				}),
			);

		new Setting(containerEl)
			.setName('服务代码根目录')
			.setDesc('包含 runtime/工作台/server.js 的目录。默认位于当前工作空间的 Knowledge-workbench-server')
			.addText((t) => t
				.setPlaceholder('/Users/yqing/Documents/Project/work-space/Knowledge-workbench-server')
				.setValue(this.plugin.settings.knowledgeWorkbench.serverRoot)
				.onChange(async (v) => { this.plugin.settings.knowledgeWorkbench.serverRoot = v.trim(); await this.plugin.saveSettings(); }),
			);

		new Setting(containerEl)
			.setName('Node 命令')
			.setDesc('用于启动 server.js 的命令或绝对路径；默认自动查找 node、/opt/homebrew/bin/node 和 /usr/local/bin/node')
			.addText((t) => t
				.setPlaceholder('node')
				.setValue(this.plugin.settings.knowledgeWorkbench.nodePath)
				.onChange(async (v) => { this.plugin.settings.knowledgeWorkbench.nodePath = v.trim() || 'node'; await this.plugin.saveSettings(); }),
			);

		new Setting(containerEl)
			.setName('服务端口')
			.setDesc('优先使用 5173；若被占用则自动从 5174～5180 选择可用端口。服务只监听本机 127.0.0.1')
			.addText((t) => t
				.setPlaceholder('5173')
				.setValue(String(this.plugin.settings.knowledgeWorkbench.port || 5173))
				.onChange(async (v) => {
					const n = Number(v);
					if (Number.isInteger(n) && n >= 1024 && n <= 65535) { this.plugin.settings.knowledgeWorkbench.port = n; await this.plugin.saveSettings(); }
				}),
			);

		new Setting(containerEl)
			.setName('Vault 根目录')
			.setDesc('Knowledge Workbench 读取和写入的当前知识库路径；原始文件只读扫描')
			.addText((t) => t
				.setPlaceholder('/Users/yqing/Documents/Project/work-space/鸣谦知识库')
				.setValue(this.plugin.settings.knowledgeWorkbench.vaultRoot)
				.onChange(async (v) => { this.plugin.settings.knowledgeWorkbench.vaultRoot = v.trim(); await this.plugin.saveSettings(); }),
			);

		new Setting(containerEl)
			.setName('额外外部扫描路径')
			.setDesc('每行一个绝对路径或当前 Vault 内相对路径，仅扫描列表和 Markdown 内容，不移动、复制、修改或删除原文件')
			.addTextArea((t) => t
				.setPlaceholder('/Users/yqing/Documents/外部素材')
				.setValue((this.plugin.settings.knowledgeWorkbench.extraRawScanPaths || []).join('\n'))
				.onChange(async (v) => { this.plugin.settings.knowledgeWorkbench.extraRawScanPaths = v.split(/\r?\n/).map((x) => x.trim()).filter(Boolean); await this.plugin.saveSettings(); }),
			);

		/* ---- 外观 ---- */
		new Setting(containerEl).setName('外观').setHeading();

		new Setting(containerEl)
			.setName('主题')
			.setDesc('跟随 Obsidian 外观，或手动指定深色/浅色。手动选择会同时切换 Obsidian 整体外观，仪表盘自动跟随')
			.addDropdown((dropdown) => {
				dropdown.addOption('auto', '跟随 Obsidian');

				dropdown.addOption('dark', '深色');
				dropdown.addOption('light', '浅色');
				dropdown.setValue(this.plugin.settings.theme);
				dropdown.onChange(async (v) => {
					const mode = v as 'auto' | 'dark' | 'light';
					if (mode !== 'auto') {
						// 手动选择深色/浅色时，直接切换 Obsidian 整体外观，仪表盘通过 'auto' 跟随。
						this.plugin.setObsidianTheme(mode);
						this.plugin.settings.theme = 'auto';
						dropdown.setValue('auto');
					} else {
						this.plugin.settings.theme = 'auto';
					}
					await this.plugin.saveSettings();
					this.applyTheme();
				});
			});

		new Setting(containerEl)
			.setName('插件标题')
			.setDesc('自定义仪表盘主标题（即“MY DASHBOARD”那一行）。留空则使用默认标题 “MY DASHBOARD”，修改后立即生效，无需重载')
			.addText((t) => t
				.setPlaceholder('MY DASHBOARD')
				.setValue(this.plugin.settings.dashboardTitle)
				.onChange(async (v) => { this.plugin.settings.dashboardTitle = v; await this.plugin.saveSettings(); this.plugin.refreshDashboardTitle(); }),
		);

		/* ---- 阶段管道 ---- */
		new Setting(containerEl).setName('阶段管道').setHeading();

		new Setting(containerEl)
			.setName('阶段数量')
			.setDesc('设置项目阶段的数量（4-6个）')
			.addDropdown((dropdown) => {
				for (const n of [4, 5, 6]) {
					dropdown.addOption(String(n), `${n} 个阶段`);
				}
				dropdown.setValue(String(this.plugin.settings.npdpMaxStage));
				dropdown.onChange(async (v) => {
					const newCount = parseInt(v);
					const current = this.plugin.settings.npdpStages;
					if (newCount > current.length) {
						while (this.plugin.settings.npdpStages.length < newCount) {
							this.plugin.settings.npdpStages.push(`阶段${this.plugin.settings.npdpStages.length + 1}`);
						}
					} else {
						this.plugin.settings.npdpStages = current.slice(0, newCount);
					}
					this.plugin.settings.npdpMaxStage = newCount;
					await this.plugin.saveSettings();
					this.display();
				});
			});

		for (let i = 0; i < this.plugin.settings.npdpStages.length; i++) {
			const idx = i;
			new Setting(containerEl)
				.setName(`阶段 ${idx + 1} 名称`)
				.setDesc(`自定义第 ${idx + 1} 个阶段的名称`)
				.addText((t) => t
					.setPlaceholder(`阶段 ${idx + 1}`)
					.setValue(this.plugin.settings.npdpStages[idx] ?? '')
					.onChange(async (v) => {
						this.plugin.settings.npdpStages[idx] = v;
						await this.plugin.saveSettings();
					}),
				);
		}

		new Setting(containerEl)
			.setName('项目进度卡片筛选')
			.setDesc('主页"项目进度"卡片显示不超过所选阶段的项目')
			.addDropdown((dropdown) => {
				for (let i = 0; i < this.plugin.settings.npdpStages.length; i++) {
					dropdown.addOption(String(i), `≤ ${this.plugin.settings.npdpStages[i]}`);
				}
				dropdown.addOption(String(this.plugin.settings.npdpStages.length), '显示全部');
				dropdown.setValue(String(this.plugin.settings.npdpProgressFilter ?? this.plugin.settings.npdpStages.length));
				dropdown.onChange(async (v) => {
					this.plugin.settings.npdpProgressFilter = parseInt(v);
					await this.plugin.saveSettings();
				});
			});
	}

	private renderAiQaSettings(containerEl: HTMLElement): void {
		const config = this.plugin.settings.aiQa;
		const style = containerEl.createEl('style');
		style.textContent = '.mq-ai-qa-provider-settings{margin:14px 0;padding:0 12px 8px;border:1px solid var(--background-modifier-border);border-radius:8px;background:var(--background-secondary)}.mq-ai-qa-provider-settings>summary{display:flex;align-items:center;gap:8px;padding:12px 2px;cursor:pointer;list-style:none}.mq-ai-qa-provider-settings>summary::-webkit-details-marker{display:none}.mq-ai-qa-provider-summary-title{font-weight:600}.mq-ai-qa-provider-summary-meta{margin-left:auto;color:var(--text-muted);font-size:11px}.mq-ai-qa-provider-settings .setting-item{border-top:1px solid var(--background-modifier-border)}';
		new Setting(containerEl).setName('AI问答').setHeading();
		new Setting(containerEl).setName('会话存储路径').setDesc('AI问答会话和附件保存在 Vault 内此目录，不会写入其他插件的历史记录。').addText((text) => text.setValue(config.sessionFolder).onChange(async (value) => { config.sessionFolder = value.trim() || 'AI问答'; await this.plugin.saveSettings(); }));
		new Setting(containerEl).setName('深度研究轮次').setDesc('深度模式最多执行 5 轮检索和查询改写。').addSlider((slider) => slider.setLimits(1, 5, 1).setValue(config.deepResearchRounds).setDynamicTooltip().onChange(async (value) => { config.deepResearchRounds = value; await this.plugin.saveSettings(); }));
		new Setting(containerEl).setName('添加模型提供方').setDesc('支持 OpenAI Compatible 和 OpenAI Responses 协议。API Key 仅用于当前设备调用。').addButton((button) => button.setButtonText('新增').onClick(async () => { config.providers.push({ id: crypto.randomUUID(), providerId: 'custom', displayName: '新提供方', baseUrl: 'https://api.openai.com/v1', protocol: 'openai-compatible', models: [], enabled: true }); await this.plugin.saveSettings(); this.display(); }));
		for (const provider of config.providers) {
			const block = containerEl.createEl('details', { cls: 'mq-ai-qa-provider-settings' });
			block.open = config.providers.length === 1 || provider.models.length === 0;
			const summary = block.createEl('summary', { cls: 'mq-ai-qa-provider-summary' });
			const summaryTitle = summary.createSpan({ cls: 'mq-ai-qa-provider-summary-title', text: provider.displayName || '未命名提供方' });
			summary.createSpan({ cls: 'mq-ai-qa-provider-summary-meta', text: `${provider.providerId || '未设置 ID'} · ${provider.models.length} 个模型${provider.enabled ? '' : ' · 已停用'}` });
			const readProviderKey = (): string | undefined => provider.apiKey ?? (provider.apiKeyKeychainId ? this.app.secretStorage?.getSecret(provider.apiKeyKeychainId) ?? undefined : undefined);
			const storedApiKey = readProviderKey();
			new Setting(block).setName('启用提供方').setDesc('关闭后不会出现在会话模型选择器中。').addToggle((toggle) => toggle.setValue(provider.enabled).onChange(async (value) => { provider.enabled = value; summaryTitle.setText(provider.displayName || '未命名提供方'); const meta = summary.querySelector('.mq-ai-qa-provider-summary-meta'); if (meta) meta.textContent = `${provider.providerId || '未设置 ID'} · ${provider.models.length} 个模型${provider.enabled ? '' : ' · 已停用'}`; await this.plugin.saveSettings(); }));
			new Setting(block).setName('提供方 ID').addText((text) => text.setValue(provider.providerId).onChange(async (value) => { provider.providerId = value.trim(); await this.plugin.saveSettings(); }));
			new Setting(block).setName('显示名称').addText((text) => text.setValue(provider.displayName).onChange(async (value) => { provider.displayName = value.trim() || provider.providerId; await this.plugin.saveSettings(); }));
			new Setting(block).setName('API 地址').addText((text) => text.setValue(provider.baseUrl).onChange(async (value) => { provider.baseUrl = normalizeOpenAiBaseUrl(value); await this.plugin.saveSettings(); }));
			new Setting(block).setName('API 协议').addDropdown((dropdown) => dropdown.addOption('openai-compatible', 'OpenAI Compatible').addOption('openai-responses', 'OpenAI Responses').setValue(provider.protocol).onChange(async (value) => { provider.protocol = value as AiQaProtocol; await this.plugin.saveSettings(); }));
			new Setting(block).setName('API 密钥').addText((text) => text.setPlaceholder('留空保持现有密钥').setValue(storedApiKey ? '********' : '').onChange(async (value) => { if (value && value !== '********') { provider.apiKeyKeychainId ||= `mq-aiqa-${provider.id.replace(/[^a-z0-9-]/gi, '').toLowerCase()}`; if (!this.app.secretStorage) { new Notice('当前 Obsidian 不支持安全密钥存储，未保存 API Key'); return; } this.app.secretStorage.setSecret(provider.apiKeyKeychainId, value); delete provider.apiKey; await this.plugin.saveSettings(); } }));
			new Setting(block).setName('模型').setDesc(provider.models.length ? provider.models.map((model) => `${model.displayName || model.id} (${model.contextWindow}/${model.maxOutputTokens})`).join('、') : '尚未配置模型').addButton((button) => button.setButtonText('获取模型').onClick(async () => { try { const apiKey = readProviderKey(); const response = await requestUrl({ url: `${normalizeOpenAiBaseUrl(provider.baseUrl)}/models`, headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {} }); const data = (response.json as { data?: Array<{ id?: string }> }).data ?? []; provider.models = data.filter((item): item is { id: string } => typeof item.id === 'string').map((item) => ({ id: item.id, displayName: item.id, contextWindow: 128000, maxOutputTokens: 8192, supportsTools: true })); await this.plugin.saveSettings(); this.display(); new Notice(`已获取 ${provider.models.length} 个模型`); } catch (error) { new Notice(`获取模型失败：${error instanceof Error ? error.message : String(error)}`); } })).addButton((button) => button.setButtonText('测试连接').onClick(async () => { try { const apiKey = readProviderKey(); const response = await requestUrl({ url: `${normalizeOpenAiBaseUrl(provider.baseUrl)}/models`, headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {} }); const data = (response.json as { data?: unknown[] }).data; new Notice(`连接成功${Array.isArray(data) ? `，发现 ${data.length} 个模型` : ''}`); } catch (error) { new Notice(`连接失败：${error instanceof Error ? error.message : String(error)}`); } }));
			for (const model of provider.models) {
				new Setting(block).setName(model.displayName || model.id).setDesc('模型 ID、显示名称、上下文窗口、最大输出 Token').addText((text) => { text.setValue(model.id).setPlaceholder('模型 ID'); text.inputEl.setAttribute('aria-label', '模型 ID'); text.onChange(async (value) => { const next = value.trim(); if (next) model.id = next; await this.plugin.saveSettings(); }); }).addText((text) => { text.setValue(model.displayName || model.id).setPlaceholder('显示名称'); text.inputEl.setAttribute('aria-label', '显示名称'); text.onChange(async (value) => { model.displayName = value.trim() || model.id; await this.plugin.saveSettings(); }); }).addText((text) => { text.setValue(String(model.contextWindow)).setPlaceholder('上下文窗口'); text.inputEl.setAttribute('aria-label', '上下文窗口'); text.onChange(async (value) => { const next = Number(value); if (Number.isFinite(next) && next > 0) model.contextWindow = Math.round(next); await this.plugin.saveSettings(); }); }).addText((text) => { text.setValue(String(model.maxOutputTokens)).setPlaceholder('最大输出 Token'); text.inputEl.setAttribute('aria-label', '最大输出 Token'); text.onChange(async (value) => { const next = Number(value); if (Number.isFinite(next) && next > 0) model.maxOutputTokens = Math.round(next); await this.plugin.saveSettings(); }); });
			}
			const manual = new Setting(block).addText((text) => text.setPlaceholder('手动添加模型 ID'));
			manual.addButton((button) => button.setButtonText('添加').onClick(async () => { const id = manual.controlEl.querySelector('input')?.value.trim(); if (!id) return; provider.models.push({ id, displayName: id, contextWindow: 128000, maxOutputTokens: 8192 }); await this.plugin.saveSettings(); this.display(); }));
			manual.addButton((button) => button.setButtonText('删除提供方').setWarning().onClick(async () => { config.providers = config.providers.filter((item) => item.id !== provider.id); await this.plugin.saveSettings(); this.display(); }));
		}
		new Setting(containerEl).setName('默认模型').addDropdown((dropdown) => { dropdown.addOption('', '未设置'); for (const p of config.providers) for (const m of p.models) dropdown.addOption(`${p.id}::${m.id}`, `${p.displayName} / ${m.displayName}`); dropdown.setValue(config.defaultModel ? `${config.defaultModel.providerId}::${config.defaultModel.modelId}` : ''); dropdown.onChange(async (value) => { const [providerId, ...model] = value.split('::'); config.defaultModel = providerId ? { providerId, modelId: model.join('::') } : undefined; await this.plugin.saveSettings(); }); });
		new Setting(containerEl).setName('联网模型').setDesc('联网模式使用此模型进行搜索规划和回答。').addDropdown((dropdown) => { dropdown.addOption('', '未设置'); for (const p of config.providers) for (const m of p.models) dropdown.addOption(`${p.id}::${m.id}`, `${p.displayName} / ${m.displayName}`); dropdown.setValue(config.webModel ? `${config.webModel.providerId}::${config.webModel.modelId}` : ''); dropdown.onChange(async (value) => { const [providerId, ...model] = value.split('::'); config.webModel = providerId ? { providerId, modelId: model.join('::') } : undefined; await this.plugin.saveSettings(); }); });
		new Setting(containerEl).setName('MCP 服务').setHeading();
		new Setting(containerEl).setName('添加 Streamable HTTP 服务').setDesc('SAG 知识库使用 Streamable HTTP；服务令牌只保存到 Obsidian 安全存储。').addButton((button) => button.setButtonText('新增').onClick(async () => { config.mcpServers.push({ id: crypto.randomUUID(), displayName: '新 MCP 服务', transport: 'streamable-http', url: 'http://127.0.0.1:3000/mcp', enabled: true, readOnlyByDefault: true, authKeychainId: `mq-aiqa-mcp-${crypto.randomUUID()}` }); await this.plugin.saveSettings(); this.display(); }));
		for (const server of config.mcpServers) {
			const authKey = server.authKeychainId || `mq-aiqa-mcp-${server.id}`; server.authKeychainId = authKey;
			new Setting(containerEl).setName(server.displayName).addText((text) => text.setValue(server.displayName).onChange(async (value) => { server.displayName = value.trim() || 'MCP 服务'; await this.plugin.saveSettings(); })).addText((text) => text.setValue(server.url || '').setPlaceholder('https://example.com/mcp').onChange(async (value) => { server.url = value.trim(); await this.plugin.saveSettings(); })).addText((text) => text.setPlaceholder('Bearer Token').setValue(this.app.secretStorage?.getSecret(authKey) ? '********' : '').onChange(async (value) => { if (value && value !== '********' && this.app.secretStorage) { this.app.secretStorage.setSecret(authKey, value); await this.plugin.saveSettings(); } })).addToggle((toggle) => toggle.setTooltip('启用服务').setValue(server.enabled).onChange(async (value) => { server.enabled = value; await this.plugin.saveSettings(); })).addButton((button) => button.setButtonText('删除').setWarning().onClick(async () => { config.mcpServers = config.mcpServers.filter((item) => item.id !== server.id); await this.plugin.saveSettings(); this.display(); }));
		}
	}

	private applyTheme(): void {
		const t = this.plugin.settings.theme;
		const effective = t === 'auto'
			? (document.body.classList.contains('theme-light') ? 'light' : 'dark')
			: t;
		// Refresh every open dashboard view (not just the foreground one), so a
		// theme switch in Settings applies immediately to all of them.
		this.app.workspace.getLeavesOfType('mq-dashboard-view').forEach((leaf) => {
			leaf.view?.containerEl?.querySelector('.mq-dashboard-plugin')?.setAttribute('data-theme', effective);
		});
		// Fallback for any stray element still in the DOM.
		document.querySelectorAll('.mq-dashboard-plugin').forEach((el) => el.setAttribute('data-theme', effective));
		this.plugin.refreshThemeButtons();
	}
}
