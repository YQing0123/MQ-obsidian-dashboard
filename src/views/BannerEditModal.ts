import { App, Modal, setIcon } from 'obsidian';
import type { BannerSettings, BannerStatsConfig, BannerLeftStat, BannerCenterStat } from '../settings';
import { CENTER_STAT_OPTIONS, LEFT_STAT_OPTIONS, RIGHT_STAT_OPTIONS, resolveBannerStats } from './BannerStats';

interface BannerEditModalOptions {
	app: App;
	banner: BannerSettings;
	onSave: (banner: BannerSettings) => void;
}

const statLabels: Record<string, string> = {
	totalNotes: '总笔记', tagsCount: '标签数', totalLinks: '总链接', newThisMonth: '本月新增', newThisWeek: '本周新增', totalTasks: '总任务', doneTasks: '已完成任务', pendingTasks: '待办任务',
	streak: '连续记录', taskCompletion: '任务完成率', overdueRate: '任务逾期率', connectivity: '连接度', orphanRate: '孤立笔记率', avgLinksPerNote: '链接/篇',
};

export class BannerEditModal extends Modal {
	private opts: BannerEditModalOptions;
	private mode: 'poster' | 'stats';
	private draft: BannerStatsConfig;
	private form!: HTMLElement;

	constructor(opts: BannerEditModalOptions) {
		super(opts.app);
		this.opts = opts;
		this.mode = opts.banner.mode === 'stats' ? 'stats' : 'poster';
		this.draft = resolveBannerStats(opts.banner.statsConfig);
	}

	onOpen(): void {
		this.contentEl.addClass('mq-ad-banner-modal');
		this.contentEl.createEl('h2', { text: '首页横幅设置' });
		const hint = this.contentEl.createDiv({ cls: 'mq-ad-banner-modal__hint' });
		hint.createDiv({ text: '切换横幅展示内容，并配置统计面板的指标和外观。' });
		const toggle = this.contentEl.createDiv({ cls: 'mq-ad-banner-modal__toggle' });
		const makeToggle = (mode: 'poster' | 'stats', icon: string, text: string): void => {
			const btn = toggle.createEl('button', { cls: 'mq-ad-banner-modal__toggle-btn' + (this.mode === mode ? ' is-active' : ''), attr: { type: 'button' } });
			setIcon(btn, icon); btn.createSpan({ text });
			btn.addEventListener('click', () => { this.mode = mode; toggle.querySelectorAll('button').forEach((node) => node.removeClass('is-active')); btn.addClass('is-active'); this.renderBody(); });
		};
		makeToggle('poster', 'image', '海报'); makeToggle('stats', 'bar-chart-3', '数据统计');
		this.form = this.contentEl.createDiv({ cls: 'mq-ad-banner-modal__form' });
		this.renderBody();
		const actions = this.contentEl.createDiv({ cls: 'mq-ad-banner-modal__actions' });
		actions.createEl('button', { text: '取消' }).addEventListener('click', () => this.close());
		actions.createEl('button', { cls: 'mod-cta', text: '保存' }).addEventListener('click', () => this.save());
	}

	private renderBody(): void {
		this.form.empty();
		if (this.mode === 'poster') {
			this.form.createDiv({ cls: 'mq-ad-banner-modal__section-title', text: '海报模式' });
			this.form.createDiv({ cls: 'mq-ad-banner-modal__copy', text: '横幅继续使用当前封面图片。可在首页横幅的“更换图片”按钮中更新图片。' });
			return;
		}
		this.form.createDiv({ cls: 'mq-ad-banner-modal__section-title', text: '统计面板' });
		const columns = this.form.createDiv({ cls: 'mq-ad-banner-modal__columns' });
		this.addColumn(columns, '左侧指标', 'showLeft', 'leftStat', LEFT_STAT_OPTIONS);
		this.addColumn(columns, '中心指标', 'showCenter', 'centerStat', CENTER_STAT_OPTIONS);
		const right = this.form.createDiv({ cls: 'mq-ad-banner-modal__right' });
		const rightHead = right.createDiv({ cls: 'mq-ad-banner-modal__row' });
		this.addCheck(rightHead, '显示右侧', 'showRight');
		right.createDiv({ cls: 'mq-ad-banner-modal__metric-title', text: '右侧进度指标' });
		for (const stat of RIGHT_STAT_OPTIONS) {
			const label = right.createEl('label', { cls: 'mq-ad-banner-modal__check' });
			const input = label.createEl('input', { attr: { type: 'checkbox' } }); input.checked = this.draft.rightStats?.includes(stat) ?? false;
			input.addEventListener('change', () => { const selected = new Set(this.draft.rightStats || []); input.checked ? selected.add(stat) : selected.delete(stat); this.draft.rightStats = RIGHT_STAT_OPTIONS.filter((key) => selected.has(key)); });
			label.createSpan({ text: statLabels[stat] || stat });
		}
		const appearance = this.form.createDiv({ cls: 'mq-ad-banner-modal__appearance' });
		appearance.createDiv({ cls: 'mq-ad-banner-modal__section-title', text: '外观' });
		this.addRange(appearance, '背景模糊', 'blur', this.draft.blur ?? 2, 0, 16);
		this.addRange(appearance, '背景暗度', 'darkness', this.draft.darkness ?? 20, 0, 100);
		const accent = appearance.createDiv({ cls: 'mq-ad-banner-modal__row' }); accent.createSpan({ text: '强调色' }); const color = accent.createEl('input', { attr: { type: 'color' } }); color.value = this.draft.accent || '#bff038'; color.addEventListener('input', () => { this.draft.accent = color.value; });
		const details = this.form.createEl('label', { cls: 'mq-ad-banner-modal__check' }); const cb = details.createEl('input', { attr: { type: 'checkbox' } }); cb.checked = this.draft.showDetails !== false; cb.addEventListener('change', () => { this.draft.showDetails = cb.checked; }); details.createSpan({ text: '显示详细条带、热力图和进度条' });
	}

	private addColumn(parent: HTMLElement, label: string, visibility: 'showLeft' | 'showCenter', key: 'leftStat' | 'centerStat', options: readonly string[]): void {
		const row = parent.createDiv({ cls: 'mq-ad-banner-modal__column' });
		this.addCheck(row, label, visibility);
		const select = row.createEl('select'); select.value = String(this.draft[key] || options[0]);
		for (const option of options) select.createEl('option', { value: option, text: statLabels[option] || option });
		select.value = String(this.draft[key] || options[0]); select.addEventListener('change', () => { (this.draft as unknown as Record<string, string>)[key] = select.value; });
	}

	private addCheck(parent: HTMLElement, label: string, key: 'showLeft' | 'showCenter' | 'showRight'): void {
		const check = parent.createEl('label', { cls: 'mq-ad-banner-modal__check' }); const input = check.createEl('input', { attr: { type: 'checkbox' } }); input.checked = this.draft[key] !== false; input.addEventListener('change', () => { this.draft[key] = input.checked; }); check.createSpan({ text: label });
	}

	private addRange(parent: HTMLElement, label: string, key: 'blur' | 'darkness', value: number, min: number, max: number): void {
		const row = parent.createDiv({ cls: 'mq-ad-banner-modal__range' }); row.createSpan({ text: label }); const input = row.createEl('input', { attr: { type: 'range', min: String(min), max: String(max), value: String(value) } }); const valueEl = row.createSpan({ text: String(value) }); input.addEventListener('input', () => { const n = Number(input.value); valueEl.textContent = String(n); this.draft[key] = n; });
	}

	private save(): void {
		this.opts.onSave({ ...this.opts.banner, mode: this.mode, statsConfig: { ...this.draft, rightStats: [...(this.draft.rightStats || [])] } });
		this.close();
	}

	onClose(): void { this.contentEl.empty(); }
}
