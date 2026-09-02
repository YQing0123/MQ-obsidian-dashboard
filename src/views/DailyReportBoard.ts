import { setIcon } from 'obsidian';
import type { App } from 'obsidian';
import type { TaskItem } from '../data/taskParser';
import type { TaskStore } from '../data/taskStore';
import {
	buildDailyReport, DailyReportRecord, DailyReportStore, dailyReportsToCsv, dailyReportsToMarkdownTable,
	renderDailyReport,
} from '../data/dailyReport';

export interface DailyReportHost {
	app: App;
	boardEl: HTMLElement | null;
	currentPage: 'home' | 'project' | 'opportunity' | 'daily-report';
	exitEditMode(): void;
	showToast(message: string, kind?: 'success' | 'error'): void;
	taskStore: TaskStore;
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

function dayString(year: number, month: number, day: number): string {
	return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function todayString(): string {
	const now = new Date();
	return dayString(now.getFullYear(), now.getMonth(), now.getDate());
}

function reportText(record: DailyReportRecord, section?: 'summary' | 'plan'): string {
	if (!section) return renderDailyReport(record);
	const title = section === 'summary' ? '今日总结：' : '明日计划：';
	const empty = '---';
	const values = record[section];
	return `${title}\n${values.length ? values.map((item, index) => `${index + 1}、${item}`).join('\n') : empty}`;
}

/** 日报周报页面：日历浏览 + 日报列表，数据由 DailyReportStore 持久化。 */
export class DailyReportBoard {
	private host: DailyReportHost;
	private store: DailyReportStore;
	private records: DailyReportRecord[] = [];
	/** 日历始终使用当前月份的完整日报记录，不受列表日期筛选影响。 */
	private calendarRecords: DailyReportRecord[] = [];
	private year = new Date().getFullYear();
	private month = new Date().getMonth();
	private startDate = '';
	private endDate = '';
	private page = 1;
	private readonly pageSize = 50;
	private refreshTimer: number | null = null;
	private taskSyncTimer: number | null = null;
	private pendingTaskPaths = new Set<string>();
	private pendingPreviousTasks = new Map<string, TaskItem | undefined>();
	private taskSyncInFlight = false;

	constructor(host: DailyReportHost) {
		this.host = host;
		this.store = new DailyReportStore(host.app);
	}

	dispose(): void {
		if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
		if (this.taskSyncTimer !== null) window.clearTimeout(this.taskSyncTimer);
		this.refreshTimer = null;
		this.taskSyncTimer = null;
		this.pendingTaskPaths.clear();
		this.pendingPreviousTasks.clear();
	}

	scheduleRefresh(): void {
		if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
		this.refreshTimer = window.setTimeout(() => {
			this.refreshTimer = null;
			void this.refresh();
		}, 180);
	}

	async show(): Promise<void> {
		if (!this.host.boardEl) return;
		this.host.exitEditMode();
		this.host.boardEl.empty();
		this.host.boardEl.removeClass('mq-ad-board');
		this.host.boardEl.removeClass('mq-po-board');
		this.host.boardEl.removeClass('mq-op-board');
		this.host.boardEl.addClass('mq-dr-board');
		this.host.currentPage = 'daily-report';
		this.startDate = '';
		this.endDate = '';
		await this.rebuildTodayReport();
		await this.loadRecords();
		this.render();
	}

	async refresh(): Promise<void> {
		await this.loadRecords();
		if (this.host.currentPage === 'daily-report') this.render();
	}

	/** 合并短时间内的任务写入，单次扫描即可更新所有受影响日期。 */
		scheduleTaskSync(path: string, previousTask?: TaskItem): void {
		this.pendingTaskPaths.add(path);
		this.pendingPreviousTasks.set(path, previousTask);
		if (this.taskSyncTimer !== null) window.clearTimeout(this.taskSyncTimer);
		this.taskSyncTimer = window.setTimeout(() => {
			this.taskSyncTimer = null;
			void this.flushTaskSync(previousTask);
		}, 220);
	}

	private async flushTaskSync(previousTask?: TaskItem): Promise<void> {
		if (this.taskSyncInFlight) return;
		this.taskSyncInFlight = true;
		const paths = [...this.pendingTaskPaths];
		this.pendingTaskPaths.clear();
		try {
			const tasks = await this.host.taskStore.scanAllTasks();
			for (const path of paths) {
				const task = tasks.find((candidate) => candidate.sourceFile === path || candidate.id === path);
				if (task) await this.store.syncTask(task, tasks, this.pendingPreviousTasks.get(path) ?? (path === paths[0] ? previousTask : undefined));
			}
			paths.forEach((path) => this.pendingPreviousTasks.delete(path));
			await this.loadRecords();
			if (this.host.currentPage === 'daily-report') this.render();
		} finally {
			this.taskSyncInFlight = false;
			if (this.pendingTaskPaths.size) void this.flushTaskSync();
		}
	}

	/** 重新按当前任务快照写入今天的日报，即使今日没有完成任务也保留一条记录。 */
	private async rebuildTodayReport(): Promise<void> {
		this.host.taskStore.invalidate();
		const tasks = await this.host.taskStore.scanAllTasks();
		await this.store.upsert(buildDailyReport(todayString(), tasks));
	}

	private currentRange(): { start: string; end: string } {
		if (this.startDate || this.endDate) {
			const start = this.startDate || this.endDate;
			const end = this.endDate || this.startDate;
			return { start, end };
		}
		const start = dayString(this.year, this.month, 1);
		const end = dayString(this.year, this.month, new Date(this.year, this.month + 1, 0).getDate());
		return { start, end };
	}

	private async loadRecords(): Promise<void> {
		const monthStart = dayString(this.year, this.month, 1);
		const monthEnd = dayString(this.year, this.month, new Date(this.year, this.month + 1, 0).getDate());
		const { start, end } = this.currentRange();
		if (start === monthStart && end === monthEnd) {
			const monthRecords = await this.store.listRange(monthStart, monthEnd);
			this.calendarRecords = monthRecords;
			this.records = monthRecords;
		} else {
			const [monthRecords, filteredRecords] = await Promise.all([
				this.store.listRange(monthStart, monthEnd),
				start <= end ? this.store.listRange(start, end) : Promise.resolve([]),
			]);
			this.calendarRecords = monthRecords;
			this.records = filteredRecords;
		}
		const maxPage = Math.max(1, Math.ceil(this.records.length / this.pageSize));
		this.page = Math.min(this.page, maxPage);
	}

	private setDateRange(start: string, end: string): void {
		if (start && end && start > end) {
			this.host.showToast('开始日期不能晚于结束日期', 'error');
			return;
		}
		if (start && end) {
			const span = (Date.parse(end) - Date.parse(start)) / 86400000;
			if (!Number.isFinite(span) || span > 366) {
				this.host.showToast('日报筛选最长支持一年', 'error');
				return;
			}
		}
		this.startDate = start;
		this.endDate = end;
		this.page = 1;
		void this.loadRecords().then(() => this.render());
	}

	private async refreshTodayReport(): Promise<void> {
		await this.rebuildTodayReport();
		await this.loadRecords();
		if (this.host.currentPage === 'daily-report') this.render();
		this.host.showToast('今日日报已刷新');
	}

	private render(): void {
		const root = this.host.boardEl;
		if (!root || this.host.currentPage !== 'daily-report') return;
		root.empty();
		const container = root.createDiv({ cls: 'mq-dr-container' });
		this.renderCalendar(container);
		this.renderList(container);
	}

	private renderCalendar(container: HTMLElement): void {
		const section = container.createDiv({ cls: 'mq-dr-calendar' });
		const top = section.createDiv({ cls: 'mq-dr-calendar__top' });
		top.createEl('h2', { cls: 'mq-dr-calendar__title', text: '日报周报' });
		const controls = top.createDiv({ cls: 'mq-dr-calendar__controls' });
		const prev = controls.createEl('button', { cls: 'mq-dr-icon-btn', attr: { 'aria-label': '上个月', title: '上个月' } });
		setIcon(prev, 'chevron-left');
		prev.addEventListener('click', () => this.shiftMonth(-1));

		const years = new Set<number>([this.year, new Date().getFullYear()]);
		for (const record of this.calendarRecords) years.add(Number(record.date.slice(0, 4)));
		for (let offset = -3; offset <= 3; offset++) years.add(new Date().getFullYear() + offset);
		const yearSelect = controls.createEl('select', { cls: 'mq-dr-select', attr: { 'aria-label': '选择年份' } });
		[...years].sort((a, b) => a - b).forEach((year) => yearSelect.createEl('option', { value: String(year), text: `${year}年` }));
		yearSelect.value = String(this.year);
		yearSelect.addEventListener('change', () => {
			this.year = Number(yearSelect.value);
			void this.loadRecords().then(() => this.render());
		});
		const monthSelect = controls.createEl('select', { cls: 'mq-dr-select', attr: { 'aria-label': '选择月份' } });
		for (let month = 0; month < 12; month++) monthSelect.createEl('option', { value: String(month), text: `${month + 1}月` });
		monthSelect.value = String(this.month);
		monthSelect.addEventListener('change', () => {
			this.month = Number(monthSelect.value);
			void this.loadRecords().then(() => this.render());
		});

		const todayButton = controls.createEl('button', { cls: 'mq-dr-text-btn', text: '今天' });
		todayButton.addEventListener('click', () => {
			const now = new Date();
			this.year = now.getFullYear();
			this.month = now.getMonth();
			void this.loadRecords().then(() => this.render());
		});
		const next = controls.createEl('button', { cls: 'mq-dr-icon-btn', attr: { 'aria-label': '下个月', title: '下个月' } });
		setIcon(next, 'chevron-right');
		next.addEventListener('click', () => this.shiftMonth(1));

		const week = section.createDiv({ cls: 'mq-dr-calendar__week' });
		for (const name of WEEKDAYS) week.createSpan({ text: `周${name}` });
		const grid = section.createDiv({ cls: 'mq-dr-calendar__grid' });
		const first = new Date(this.year, this.month, 1);
		const firstOffset = first.getDay();
		const days = new Date(this.year, this.month + 1, 0).getDate();
		const cellCount = Math.ceil((firstOffset + days) / 7) * 7;
		const reportDates = new Set(this.calendarRecords.map((record) => record.date));
		const completedDates = new Set(this.calendarRecords.filter((record) => record.summary.length > 0).map((record) => record.date));
		const todayDate = todayString();
		for (let cell = 0; cell < cellCount; cell++) {
			const day = cell - firstOffset + 1;
			const dateCell = grid.createEl('button', { cls: 'mq-dr-day' + (day < 1 || day > days ? ' is-empty' : '') });
			if (day < 1 || day > days) { dateCell.disabled = true; continue; }
			const date = dayString(this.year, this.month, day);
			dateCell.createSpan({ cls: 'mq-dr-day__num', text: String(day) });
			const tags = dateCell.createDiv({ cls: 'mq-dr-day__tags' });
			const weekday = (firstOffset + day - 1) % 7;
			if (weekday === 0 || weekday === 6) tags.createSpan({ cls: 'mq-dr-day__tag mq-dr-day__tag--rest', text: '休' });
			if (date === todayDate) tags.createSpan({ cls: 'mq-dr-day__tag mq-dr-day__tag--today', text: '今' });
			if (reportDates.has(date)) {
				dateCell.addClass('has-record');
			}
			if (completedDates.has(date)) {
				tags.createSpan({ cls: 'mq-dr-day__tag mq-dr-day__tag--report', text: '日' });
			}
			dateCell.title = reportDates.has(date) ? `${date} 有日报，点击查看` : date;
			dateCell.addEventListener('click', () => {
				if (!reportDates.has(date)) return;
				this.setDateRange(date, date);
			});
		}
	}

	private renderList(container: HTMLElement): void {
		const section = container.createDiv({ cls: 'mq-dr-list' });
		const toolbar = section.createDiv({ cls: 'mq-dr-list__toolbar' });
		toolbar.createEl('h3', { text: '日报记录' });
		const filters = toolbar.createDiv({ cls: 'mq-dr-list__filters' });
		const start = filters.createEl('input', { cls: 'mq-ad-modal-input mq-dr-date-input', attr: { type: 'date', 'aria-label': '开始日期' } });
		start.value = this.startDate;
		start.addEventListener('change', () => this.setDateRange(start.value, this.endDate));
		const end = filters.createEl('input', { cls: 'mq-ad-modal-input mq-dr-date-input', attr: { type: 'date', 'aria-label': '结束日期' } });
		end.value = this.endDate;
		end.addEventListener('change', () => this.setDateRange(this.startDate, end.value));
		const reset = filters.createEl('button', { cls: 'mq-dr-text-btn', text: '清除筛选' });
		reset.addEventListener('click', () => this.setDateRange('', ''));
		const exportCsv = filters.createEl('button', { cls: 'mq-dr-text-btn', text: '导出表格' });
		exportCsv.addEventListener('click', () => void this.export('csv'));
		const exportMd = filters.createEl('button', { cls: 'mq-dr-text-btn', text: '导出 MD 表格' });
		exportMd.addEventListener('click', () => void this.export('md'));
		const refreshToday = filters.createEl('button', { cls: 'mq-dr-text-btn', text: '刷新今日日报' });
		refreshToday.addEventListener('click', () => void this.refreshTodayReport());

		const tableWrap = section.createDiv({ cls: 'mq-dr-table-wrap' });
		const table = tableWrap.createEl('table', { cls: 'mq-po-tb2 mq-dr-table' });
		const head = table.createEl('thead').createEl('tr');
		['日报时间', '日报内容', '操作'].forEach((label) => head.createEl('th', { text: label }));
		const body = table.createEl('tbody');
		const filtered = this.filteredRecords();
		const totalPages = Math.max(1, Math.ceil(filtered.length / this.pageSize));
		const records = filtered.slice((this.page - 1) * this.pageSize, this.page * this.pageSize);
		if (!records.length) {
			const row = body.createEl('tr');
			row.createEl('td', { attr: { colspan: '3' }, cls: 'mq-dr-empty', text: this.records.length ? '没有符合时间条件的日报' : '暂无日报。完成任务后会自动生成当日记录。' });
			this.renderPagination(section, filtered.length, totalPages);
			return;
		}
		for (const record of records) {
			const row = body.createEl('tr');
			row.createEl('td', { cls: 'mq-dr-date', text: record.date });
			const content = row.createEl('td', { cls: 'mq-dr-content' });
			this.renderSection(content, '今日总结', record.summary, '---');
			this.renderSection(content, '明日计划', record.plan, '---');
			const actionsCell = row.createEl('td', { cls: 'mq-dr-actions-cell' });
			const actions = actionsCell.createDiv({ cls: 'mq-dr-actions' });
			this.copyButton(actions, '一键复制', () => reportText(record));
			this.copyButton(actions, '复制今日总结', () => reportText(record, 'summary'));
			this.copyButton(actions, '复制明日计划', () => reportText(record, 'plan'));
		}
		this.renderPagination(section, filtered.length, totalPages);
	}

	private renderPagination(section: HTMLElement, total: number, totalPages: number): void {
		if (total <= this.pageSize) return;
		const footer = section.createDiv({ cls: 'mq-dr-pagination' });
		const prev = footer.createEl('button', { cls: 'mq-dr-text-btn', text: '上一页' });
		prev.disabled = this.page <= 1;
		prev.addEventListener('click', () => { this.page -= 1; this.render(); });
		footer.createSpan({ text: `${this.page} / ${totalPages}（共 ${total} 条）` });
		const next = footer.createEl('button', { cls: 'mq-dr-text-btn', text: '下一页' });
		next.disabled = this.page >= totalPages;
		next.addEventListener('click', () => { this.page += 1; this.render(); });
	}

	private renderSection(parent: HTMLElement, title: string, items: string[], empty: string): void {
		const section = parent.createDiv({ cls: 'mq-dr-content__section' });
		section.createEl('strong', { text: `${title}：` });
		const list = section.createEl('ol');
		if (!items.length) list.createEl('li', { cls: 'mq-dr-content__empty', text: empty });
		else items.forEach((item) => list.createEl('li', { text: item }));
	}

	private copyButton(parent: HTMLElement, label: string, getText: () => string): void {
		const button = parent.createEl('button', { cls: 'mq-dr-copy-btn', text: label });
		button.addEventListener('click', () => void this.copy(getText()));
	}

	private filteredRecords(): DailyReportRecord[] {
		return this.records.filter((record) => (!this.startDate || record.date >= this.startDate) && (!this.endDate || record.date <= this.endDate));
	}

	private shiftMonth(delta: number): void {
		const next = new Date(this.year, this.month + delta, 1);
		this.year = next.getFullYear();
		this.month = next.getMonth();
		void this.loadRecords().then(() => this.render());
	}

	private async export(type: 'csv' | 'md'): Promise<void> {
		const content = type === 'csv' ? dailyReportsToCsv(this.filteredRecords()) : dailyReportsToMarkdownTable(this.filteredRecords());
		const path = await this.store.writeExport(type, content);
		this.host.showToast(`已导出 ${this.filteredRecords().length} 条日报：${path}`);
	}

	private async copy(text: string): Promise<void> {
		try {
			await navigator.clipboard.writeText(text);
			this.host.showToast('日报已复制到剪贴板');
		} catch {
			const area = document.body.createEl('textarea');
			area.value = text;
			area.style.position = 'fixed';
			area.style.opacity = '0';
			document.body.appendChild(area);
			area.select();
			document.execCommand('copy');
			area.remove();
			this.host.showToast('日报已复制到剪贴板');
		}
	}
}
