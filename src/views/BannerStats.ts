import { App, setIcon } from 'obsidian';
import type { TaskStore } from '../data/taskStore';
import type { BannerCenterStat, BannerLeftStat, BannerRightStat, BannerStatsConfig } from '../settings';

export const DEFAULT_BANNER_STATS: BannerStatsConfig = {
	showDetails: true,
	showLeft: true,
	showCenter: true,
	showRight: true,
	leftStat: 'totalNotes',
	centerStat: 'streak',
	rightStats: ['taskCompletion', 'overdueRate', 'avgLinksPerNote'],
	blur: 2,
	darkness: 20,
};

export const LEFT_STAT_OPTIONS: BannerLeftStat[] = ['totalNotes', 'tagsCount', 'totalLinks', 'newThisMonth', 'newThisWeek', 'totalTasks', 'doneTasks', 'pendingTasks'];
export const CENTER_STAT_OPTIONS: BannerCenterStat[] = ['streak', 'taskCompletion', 'connectivity', 'newThisWeek'];
export const RIGHT_STAT_OPTIONS: BannerRightStat[] = ['taskCompletion', 'overdueRate', 'avgLinksPerNote', 'connectivity', 'orphanRate'];

export interface BannerStatsResult {
	totalNotes: number; tagsCount: number; totalLinks: number; newThisMonth: number; newThisWeek: number;
	streak: number; totalTasks: number; doneTasks: number; pendingTasks: number; taskCompletion: number;
	overdueRate: number; orphanNotes: number; orphanRate: number; avgLinksPerNote: number; connectivity: number; activity: number[];
}

export function resolveBannerStats(config?: BannerStatsConfig): BannerStatsConfig {
	// Preserve an explicitly empty selection. This is important because the
	// banner editor must be able to save an unchecked metric instead of silently
	// restoring the defaults the next time the modal opens.
	const selected = Array.isArray(config?.rightStats)
		? [...config.rightStats]
		: [...DEFAULT_BANNER_STATS.rightStats!];
	return { ...DEFAULT_BANNER_STATS, ...config, rightStats: selected };
}

function dayKey(value: Date): string {
	return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function startOfDay(value: Date): number {
	return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
}

export async function computeBannerStats(app: App, taskStore: TaskStore): Promise<BannerStatsResult> {
	const files = app.vault.getMarkdownFiles().filter((file) => !file.path.startsWith('.'));
	const now = new Date();
	const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
	const weekStart = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6));
	const activity = new Array<number>(98).fill(0);
	const activityDates = new Set<string>();
	let newThisMonth = 0;
	let newThisWeek = 0;
	for (const file of files) {
		if (file.stat.ctime >= monthStart) newThisMonth++;
		if (file.stat.ctime >= weekStart) newThisWeek++;
		const age = Math.floor((startOfDay(now) - startOfDay(new Date(file.stat.ctime))) / 86400000);
		if (age >= 0 && age < activity.length) activity[activity.length - 1 - age]++;
		activityDates.add(dayKey(new Date(file.stat.ctime)));
	}

	const resolved = app.metadataCache.resolvedLinks;
	const outgoing = new Set<string>();
	const incoming = new Set<string>();
	let totalLinks = 0;
	for (const [src, targets] of Object.entries(resolved)) {
		const keys = Object.keys(targets);
		if (keys.length) outgoing.add(src);
		for (const target of keys) incoming.add(target);
		for (const count of Object.values(targets)) totalLinks += count;
	}
	let orphanNotes = 0;
	for (const file of files) if (!outgoing.has(file.path) && !incoming.has(file.path)) orphanNotes++;

	const tags = new Set<string>();
	for (const file of files) {
		const cache = app.metadataCache.getFileCache(file);
		for (const tag of cache?.tags ?? []) tags.add(tag.tag.replace(/^#/, ''));
		const raw = cache?.frontmatter?.tags;
		if (Array.isArray(raw)) raw.forEach((tag) => tags.add(String(tag).replace(/^#/, '')));
		else if (raw) tags.add(String(raw).replace(/^#/, ''));
	}

	const tasks = await taskStore.scanAllTasks();
	const totalTasks = tasks.length;
	const doneTasks = tasks.filter((task) => task.status === '已完成').length;
	const taskCompletion = totalTasks ? Math.round(doneTasks / totalTasks * 100) : 0;
	const overdueRate = totalTasks ? Math.round(tasks.filter((task) => task.isOverdue).length / totalTasks * 100) : 0;
	const streakDates = new Set(activityDates);
	let cursor = startOfDay(now);
	if (!streakDates.has(dayKey(new Date(cursor)))) cursor -= 86400000;
	let streak = 0;
	while (streakDates.has(dayKey(new Date(cursor)))) { streak++; cursor -= 86400000; }
	return {
		totalNotes: files.length, tagsCount: tags.size, totalLinks, newThisMonth, newThisWeek, streak,
		totalTasks, doneTasks, pendingTasks: totalTasks - doneTasks, taskCompletion, overdueRate,
		orphanNotes, orphanRate: files.length ? Math.round(orphanNotes / files.length * 100) : 0,
		avgLinksPerNote: files.length ? totalLinks / files.length : 0,
		connectivity: files.length ? Math.round((files.length - orphanNotes) / files.length * 100) : 0,
		activity,
	};
}

export function applyBannerStatsBackdrop(banner: HTMLElement, config: BannerStatsConfig): void {
	const darkness = config.darkness ?? 20;
	banner.style.setProperty('--banner-blur', `${config.blur ?? 2}px`);
	banner.style.setProperty('--banner-bright', String(Math.max(0.3, 1 - darkness / 100 * 0.7)));
	banner.style.setProperty('--banner-scrim', String(0.25 + darkness / 100 * 0.5));
	banner.style.setProperty('--banner-stat-accent', config.accent || '#bff038');
}

const labels: Record<string, string> = {
	totalNotes: '总笔记', tagsCount: '标签', totalLinks: '总链接', newThisMonth: '本月新增', newThisWeek: '本周新增', totalTasks: '总任务', doneTasks: '已完成', pendingTasks: '待办',
	streak: '连续记录', taskCompletion: '任务完成率', overdueRate: '任务逾期率', connectivity: '连接度', orphanRate: '孤立笔记率', avgLinksPerNote: '链接/篇',
};
const icons: Record<string, string> = { totalNotes: 'file-text', tagsCount: 'hash', totalLinks: 'link', newThisMonth: 'calendar-plus', newThisWeek: 'calendar-check', totalTasks: 'list-checks', doneTasks: 'check-check', pendingTasks: 'circle-dashed', streak: 'flame', taskCompletion: 'list-checks', overdueRate: 'clock-alert', connectivity: 'network', orphanRate: 'circle-slash', avgLinksPerNote: 'link' };

function statValue(stat: string, r: BannerStatsResult): string {
	const value = (r as unknown as Record<string, number>)[stat] ?? 0;
	if (stat === 'taskCompletion' || stat === 'overdueRate' || stat === 'connectivity' || stat === 'orphanRate') return `${value}%`;
	if (stat === 'avgLinksPerNote') return value.toFixed(1);
	if (stat === 'streak') return `${value}天`;
	return value.toLocaleString();
}

function hero(parent: HTMLElement, stat: string, value: string, prefix?: string): void {
	const row = parent.createDiv({ cls: 'mq-ad-banner-stat-hero' });
	if (prefix) row.createDiv({ cls: 'mq-ad-banner-stat-title-prefix', text: prefix });
	const icon = row.createDiv({ cls: 'mq-ad-banner-stat-icon' }); setIcon(icon, icons[stat] || 'bar-chart-3');
	row.createDiv({ cls: 'mq-ad-banner-stat-num', text: value });
	row.createDiv({ cls: 'mq-ad-banner-stat-label mq-ad-banner-stat-label--inline', text: labels[stat] || stat });
}

export async function renderBannerStats(parent: HTMLElement, config: BannerStatsConfig | undefined, app: App, taskStore: TaskStore, dashboardTitle?: string): Promise<HTMLElement> {
	const resolved = resolveBannerStats(config);
	applyBannerStatsBackdrop(parent.parentElement || parent, resolved);
	const el = parent.createDiv({ cls: 'mq-ad-banner-stats' });
	const result = await computeBannerStats(app, taskStore);
	if (resolved.showLeft !== false) {
		const col = el.createDiv({ cls: 'mq-ad-banner-stat-col mq-ad-banner-stat-col--left' });
		hero(col, resolved.leftStat || 'totalNotes', statValue(resolved.leftStat || 'totalNotes', result));
		if (resolved.showDetails !== false) {
			const strip = col.createDiv({ cls: 'mq-ad-banner-stat-strip' });
			for (const [icon, text] of [['calendar-plus', `本月 ${result.newThisMonth}`], ['hash', `标签 ${result.tagsCount}`], ['link', `链接 ${result.totalLinks}`]]) { const item = strip.createDiv({ cls: 'mq-ad-banner-stat-strip-item' }); const ico = item.createDiv({ cls: 'mq-ad-banner-stat-strip-icon' }); setIcon(ico, icon); item.createSpan({ text }); }
		}
	}
	if (resolved.showCenter !== false) {
		const stat = resolved.centerStat || 'streak';
		const col = el.createDiv({ cls: 'mq-ad-banner-stat-col mq-ad-banner-stat-col--center' });
		hero(col, stat, statValue(stat, result), stat === 'streak' ? (dashboardTitle?.trim() || undefined) : undefined);
		if (resolved.showDetails !== false) {
			col.createDiv({ cls: 'mq-ad-banner-stat-sub', text: stat === 'taskCompletion' ? `${result.doneTasks} / ${result.totalTasks} 个任务已完成` : `本周新增 ${result.newThisWeek} · 本月新增 ${result.newThisMonth}` });
			const chart = col.createDiv({ cls: 'mq-ad-banner-stat-chart' }); const grid = chart.createDiv({ cls: 'mq-ad-banner-heatmap' }); const max = Math.max(1, ...result.activity);
			result.activity.forEach((v, i) => { const cell = grid.createDiv({ cls: 'mq-ad-banner-heatmap-cell' }); const level = v <= 0 ? 0 : Math.min(4, Math.ceil(v / max * 4)); cell.addClass(`mq-ad-banner-heatmap-cell--l${level}`); if (i === result.activity.length - 1) cell.addClass('mq-ad-banner-heatmap-cell--today'); });
		}
	}
	if (resolved.showRight !== false) {
		const col = el.createDiv({ cls: 'mq-ad-banner-stat-col mq-ad-banner-stat-col--right' });
		for (const stat of resolved.rightStats || []) {
			const row = col.createDiv({ cls: 'mq-ad-banner-stat-prog' }); const head = row.createDiv({ cls: 'mq-ad-banner-stat-prog-head' }); const title = head.createDiv({ cls: 'mq-ad-banner-stat-prog-title' }); const ico = title.createDiv({ cls: 'mq-ad-banner-stat-prog-icon' }); setIcon(ico, icons[stat] || 'bar-chart-3'); title.createSpan({ text: labels[stat] || stat }); head.createDiv({ cls: 'mq-ad-banner-stat-prog-val', text: statValue(stat, result) });
			const track = row.createDiv({ cls: 'mq-ad-banner-stat-prog-track' }); const fill = track.createDiv({ cls: 'mq-ad-banner-stat-prog-fill' }); const n = stat === 'avgLinksPerNote' ? Math.min(100, Math.round(result.avgLinksPerNote / 3 * 100)) : (result as unknown as Record<string, number>)[stat] || 0; fill.style.width = `${n}%`;
		}
	}
	return el;
}
