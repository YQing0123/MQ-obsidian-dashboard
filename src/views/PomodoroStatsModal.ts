import { setIcon } from 'obsidian';
import { activityColor, type PomodoroService } from '../pomodoro-service';
import { openPomodoroTagManager } from './PomodoroTagManager';

type Range = 'day' | 'week' | 'month' | 'year' | 'all';
const RANGES: Array<{ key: Range; label: string }> = [
	{ key: 'day', label: '日' }, { key: 'week', label: '周' }, { key: 'month', label: '月' },
	{ key: 'year', label: '年' }, { key: 'all', label: '全部' },
];

/**
 * Apex's native focus-statistics overlay, connected to MQ Dashboard's local
 * pomodoro record store. It deliberately keeps the Apex DOM/CSS contract.
 */
export function showPomodoroStats(doc: Document, service: PomodoroService): void {
	const overlay = doc.body.createDiv({ cls: 'dashboard-pomodoro-stats-overlay mq-pomodoro-apex-theme' });
	const modal = overlay.createDiv({ cls: 'dashboard-pomodoro-stats-modal dashboard-pomodoro-stats-modal--wide' });
	let range: Range = 'week';
	let activityFilter: string | null = null;

	const close = (): void => { doc.removeEventListener('keydown', onKey); overlay.remove(); };
	const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') close(); };
	doc.addEventListener('keydown', onKey);
	overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });

	const header = modal.createDiv({ cls: 'dashboard-pomodoro-stats-header' });
	const titleWrap = header.createDiv({ cls: 'dashboard-pomodoro-stats-header-titlewrap' });
	titleWrap.createDiv({ cls: 'dashboard-pomodoro-stats-header-title', text: '专注统计' });
	const insight = titleWrap.createDiv({ cls: 'dashboard-pomodoro-insight' });
	const headerRight = header.createDiv({ cls: 'dashboard-pomodoro-stats-header-right' });
	const rangeToggle = headerRight.createDiv({ cls: 'dashboard-pomodoro-range-toggle' });
	const rangeButtons = RANGES.map(({ key, label }) => rangeToggle.createDiv({
		cls: 'dashboard-pomodoro-range-btn' + (key === range ? ' dashboard-pomodoro-range-btn--active' : ''), text: label,
	}));
	const manageButton = headerRight.createDiv({ cls: 'dashboard-pomodoro-stats-icon-btn', attr: { 'aria-label': '管理活动标签' } });
	setIcon(manageButton, 'settings-2');
	const closeButton = headerRight.createDiv({ cls: 'dashboard-pomodoro-stats-close', attr: { 'aria-label': '关闭统计' } });
	setIcon(closeButton, 'x'); closeButton.addEventListener('click', close);

	const filterBar = modal.createDiv({ cls: 'dashboard-pomodoro-filterbar' });
	const body = modal.createDiv({ cls: 'dashboard-pomodoro-stats-body' });
	const left = body.createDiv({ cls: 'dashboard-pomodoro-kpi-col' });
	const mid = body.createDiv({ cls: 'dashboard-pomodoro-mid-col' });
	const right = body.createDiv({ cls: 'dashboard-pomodoro-right-col' });

	const summary = left.createDiv({ cls: 'dashboard-pomodoro-stats-summary' });
	const distribution = mid.createDiv({ cls: 'dashboard-pomodoro-stats-section' });
	const distributionTitle = distribution.createDiv({ cls: 'dashboard-pomodoro-stats-section-title' });
	const donut = distribution.createDiv({ cls: 'dashboard-pomodoro-donut-container dashboard-pomodoro-donut-container--wide' });
	const trend = mid.createDiv({ cls: 'dashboard-pomodoro-stats-section' });
	const trendTitle = trend.createDiv({ cls: 'dashboard-pomodoro-stats-section-title' });
	const trendChart = trend.createDiv({ cls: 'dashboard-pomodoro-trend-container' });
	const ranking = right.createDiv({ cls: 'dashboard-pomodoro-stats-section' });
	ranking.createDiv({ cls: 'dashboard-pomodoro-stats-section-title', text: '活动排行' });
	const rankingList = ranking.createDiv({ cls: 'dashboard-pomodoro-rank-container' });
	const heat = right.createDiv({ cls: 'dashboard-pomodoro-stats-section' });
	heat.createDiv({ cls: 'dashboard-pomodoro-stats-section-title', text: '专注热力图' });
	const heatMap = heat.createDiv({ cls: 'dashboard-pomodoro-heatmap-container' });
	const recent = right.createDiv({ cls: 'dashboard-pomodoro-stats-section' });
	recent.createDiv({ cls: 'dashboard-pomodoro-stats-section-title', text: '最近记录' });
	const recentList = recent.createDiv({ cls: 'dashboard-pomodoro-recent-container' });

	function rangeStart(): string | undefined {
		if (range === 'all') return undefined;
		const date = new Date();
		if (range === 'week') date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
		if (range === 'month') date.setDate(1);
		if (range === 'year') { date.setMonth(0); date.setDate(1); }
		return dateKey(date);
	}
	function rangeLabel(): string { return ({ day: '今日', week: '本周', month: '本月', year: '本年', all: '累计' })[range]; }
	function breakdown(): Map<string, number> {
		const all = service.getActivityBreakdown(rangeStart());
		if (!activityFilter) return all;
		return new Map(activityFilter && all.has(activityFilter) ? [[activityFilter, all.get(activityFilter)!]] : []);
	}
	function card(parent: HTMLElement, value: string, label: string): void {
		const item = parent.createDiv({ cls: 'dashboard-pomodoro-stats-card' });
		item.createDiv({ cls: 'dashboard-pomodoro-stats-card-value', text: value });
		item.createDiv({ cls: 'dashboard-pomodoro-stats-card-label', text: label });
	}
	function renderSummary(): void {
		summary.empty();
		const goal = service.getTodayGoal();
		card(summary, `${goal.completed}/${goal.goal}`, '今日番茄');
		card(summary, formatMinutes(service.getRangeFocusMinutes(range)), rangeLabel() + '专注');
		card(summary, String(service.getStreak()), '连续天数');
		card(summary, formatMinutes(service.getRecent7AvgMinutes()), '7 日均值');
		card(summary, `${service.getTodayScore()}%`, '今日效率');
		card(summary, String(service.getTodayInterruptions()), '专注中断');
		const adherence = service.getBreakAdherence();
		card(summary, adherence === null ? '-' : `${adherence}%`, '休息完成度');
		insight.textContent = service.getStreak() > 0 ? `已连续专注 ${service.getStreak()} 天` : '从第一个番茄开始';
	}
	function renderDonut(): void {
		donut.empty();
		const data = [...breakdown().entries()].sort((a, b) => b[1] - a[1]);
		const total = data.reduce((sum, [, value]) => sum + value, 0);
		distributionTitle.textContent = data.length <= 1 ? '每日目标' : '时间分布';
		if (data.length <= 1) { renderGauge(); return; }
		if (!total) { donut.createDiv({ cls: 'dashboard-pomodoro-donut-empty', text: '暂无专注记录' }); return; }
		const size = 200; const stroke = 32; const radius = (size - stroke) / 2; const circumference = 2 * Math.PI * radius;
		const wrap = donut.createDiv({ cls: 'dashboard-pomodoro-donut-wrap' });
		const svg = wrap.createSvg('svg', { cls: 'dashboard-pomodoro-donut-svg', attr: { viewBox: `0 0 ${size} ${size}`, width: String(size), height: String(size) } });
		svg.createSvg('circle', { cls: 'dashboard-pomodoro-donut-bg', attr: { cx: size / 2, cy: size / 2, r: radius, fill: 'none', 'stroke-width': stroke } });
		const center = svg.createSvg('text', { cls: 'dashboard-pomodoro-donut-center-value', attr: { x: size / 2, y: size / 2 - 6, 'text-anchor': 'middle', 'dominant-baseline': 'middle' } });
		center.textContent = formatMinutes(total);
		const label = svg.createSvg('text', { cls: 'dashboard-pomodoro-donut-center-label', attr: { x: size / 2, y: size / 2 + 16, 'text-anchor': 'middle', 'dominant-baseline': 'middle' } });
		let offset = 0;
		for (const [name, minutes] of data) {
			const part = Math.max(0, circumference * minutes / total - 3);
			const circle = svg.createSvg('circle', { cls: 'dashboard-pomodoro-donut-segment', attr: { cx: size / 2, cy: size / 2, r: radius, fill: 'none', 'stroke-width': stroke, 'stroke-dasharray': `${part} ${circumference - part}`, 'stroke-dashoffset': String(-offset), transform: `rotate(-90 ${size / 2} ${size / 2})` } });
			circle.style.stroke = activityColor(name); offset += part + 3;
			circle.addEventListener('mouseenter', () => { circle.setAttribute('stroke-width', String(stroke + 6)); center.textContent = formatMinutes(minutes); label.textContent = `${name} ${Math.round(minutes / total * 100)}%`; });
			circle.addEventListener('mouseleave', () => { circle.setAttribute('stroke-width', String(stroke)); center.textContent = formatMinutes(total); label.textContent = ''; });
		}
		const legend = donut.createDiv({ cls: 'dashboard-pomodoro-donut-legend dashboard-pomodoro-donut-legend--grid' });
		for (const [name, minutes] of data) { const item = legend.createDiv({ cls: 'dashboard-pomodoro-donut-legend-item' }); const dot = item.createDiv({ cls: 'dashboard-pomodoro-donut-legend-dot' }); dot.style.backgroundColor = activityColor(name); item.createDiv({ cls: 'dashboard-pomodoro-donut-legend-name', text: name }); item.createDiv({ cls: 'dashboard-pomodoro-donut-legend-time', text: formatMinutes(minutes) }); }
	}
	function renderGauge(): void {
		const { completed, goal } = service.getTodayGoal(); const percent = Math.min(1, completed / goal);
		const size = 200; const stroke = 26; const cx = 100; const radius = 66; const start = 135; const sweep = 270;
		const polar = (angle: number): [number, number] => { const rad = angle * Math.PI / 180; return [cx + radius * Math.cos(rad), cx + radius * Math.sin(rad)]; };
		const arc = (end: number): string => { const [sx, sy] = polar(start); const [ex, ey] = polar(end); return `M ${sx} ${sy} A ${radius} ${radius} 0 ${end - start > 180 ? 1 : 0} 1 ${ex} ${ey}`; };
		const wrap = donut.createDiv({ cls: 'dashboard-pomodoro-donut-wrap' }); const svg = wrap.createSvg('svg', { cls: 'dashboard-pomodoro-donut-svg', attr: { viewBox: '0 0 200 200', width: String(size), height: String(size) } });
		svg.createSvg('path', { cls: 'dashboard-pomodoro-donut-bg', attr: { d: arc(start + sweep), fill: 'none', 'stroke-width': stroke, 'stroke-linecap': 'round' } });
		if (completed) { const path = svg.createSvg('path', { attr: { d: arc(start + sweep * percent), fill: 'none', 'stroke-width': stroke, 'stroke-linecap': 'round' } }); path.style.stroke = percent >= 1 ? '#2ecc71' : 'var(--db-accent)'; }
		const value = svg.createSvg('text', { cls: 'dashboard-pomodoro-gauge-value', attr: { x: cx, y: 96, 'text-anchor': 'middle' } }); value.textContent = `${completed}/${goal}`;
		const label = svg.createSvg('text', { cls: 'dashboard-pomodoro-donut-center-label', attr: { x: cx, y: 118, 'text-anchor': 'middle' } }); label.textContent = '今日番茄';
	}
	function renderTrend(): void {
		trendChart.empty(); const days = range === 'day' ? 1 : range === 'week' ? 7 : range === 'month' ? 31 : range === 'year' ? 84 : 84;
		const values = service.getDailyMinutes(days).map((entry) => ({ ...entry, minutes: activityFilter ? service.getRecordsForDate(entry.date).filter((record) => record.activity === activityFilter).reduce((sum, record) => sum + record.duration, 0) : entry.minutes }));
		trendTitle.textContent = rangeLabel() + '趋势' + (activityFilter ? ` · ${activityFilter}` : '');
		const max = Math.max(1, ...values.map((entry) => entry.minutes)); const width = 520; const height = 130; const step = width / values.length; const barWidth = Math.max(3, Math.min(18, step * .6));
		const svg = trendChart.createSvg('svg', { cls: 'dashboard-pomodoro-trend-svg', attr: { viewBox: `0 0 ${width} ${height + 16}`, width: '100%', height: String(height + 16) } });
		values.forEach((entry, index) => { const barHeight = Math.round(entry.minutes / max * (height - 10)); const x = index * step + (step - barWidth) / 2; const rect = svg.createSvg('rect', { cls: 'dashboard-pomodoro-trend-bar', attr: { x, y: height - barHeight, width: barWidth, height: Math.max(entry.minutes ? 2 : 0, barHeight), rx: 2 } }); rect.style.fill = activityFilter ? activityColor(activityFilter) : 'var(--db-accent)'; const title = svg.createSvg('title'); title.textContent = `${entry.date} · ${formatMinutes(entry.minutes)}`; rect.appendChild(title); if (values.length <= 14 || index % Math.ceil(values.length / 12) === 0) { const tick = svg.createSvg('text', { cls: 'dashboard-pomodoro-trend-tick', attr: { x: x + barWidth / 2, y: height + 12, 'text-anchor': 'middle' } }); tick.textContent = entry.date.slice(8); } });
	}
	function renderRanking(): void {
		rankingList.empty(); const data = [...service.getActivityBreakdown(rangeStart()).entries()].sort((a, b) => b[1] - a[1]); const max = data[0]?.[1] ?? 1;
		if (!data.length) { rankingList.createDiv({ cls: 'dashboard-pomodoro-donut-empty', text: '暂无专注记录' }); return; }
		for (const [name, minutes] of data) { const row = rankingList.createDiv({ cls: 'dashboard-pomodoro-rank-row' + (activityFilter === name ? ' dashboard-pomodoro-rank-row--active' : ''), attr: { role: 'button', tabindex: '0', title: '点击筛选此活动' } }); const head = row.createDiv({ cls: 'dashboard-pomodoro-rank-head' }); const dot = head.createDiv({ cls: 'dashboard-pomodoro-donut-legend-dot' }); dot.style.backgroundColor = activityColor(name); head.createDiv({ cls: 'dashboard-pomodoro-rank-name', text: name }); head.createDiv({ cls: 'dashboard-pomodoro-rank-time', text: formatMinutes(minutes) }); const rail = row.createDiv({ cls: 'dashboard-pomodoro-rank-bar-wrap' }); const bar = rail.createDiv({ cls: 'dashboard-pomodoro-rank-bar' }); bar.style.width = `${Math.max(3, minutes / max * 100)}%`; bar.style.backgroundColor = activityColor(name); const select = (): void => { activityFilter = activityFilter === name ? null : name; renderAll(); }; row.addEventListener('click', select); row.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); } }); }
	}
	function renderHeatmap(): void {
		heatMap.empty(); const values = service.getDailyMinutes(84); const cell = 11; const gap = 3; const svg = heatMap.createSvg('svg', { attr: { viewBox: '0 0 168 98', width: '100%', height: '98' } }); const max = Math.max(1, ...values.map((entry) => entry.minutes));
		values.forEach((entry, index) => { const rect = svg.createSvg('rect', { cls: 'dashboard-pomodoro-heatmap-cell' + (entry.minutes ? ' dashboard-pomodoro-heatmap-cell--active' : ''), attr: { x: Math.floor(index / 7) * (cell + gap), y: index % 7 * (cell + gap), width: cell, height: cell, rx: 2.5 } }); if (entry.minutes) rect.style.fill = `color-mix(in srgb, var(--db-accent) ${Math.round(35 + entry.minutes / max * 65)}%, var(--db-bg-hover))`; const title = svg.createSvg('title'); title.textContent = `${entry.date} · ${formatMinutes(entry.minutes)}`; rect.appendChild(title); });
	}
	function renderRecent(): void {
		recentList.empty(); const records = service.getRecentRecords(12); if (!records.length) { recentList.createDiv({ cls: 'dashboard-pomodoro-donut-empty', text: '暂无完成记录' }); return; }
		for (const record of records) { const row = recentList.createDiv({ cls: 'dashboard-pomodoro-stats-record-row' }); const dot = row.createDiv({ cls: 'dashboard-pomodoro-stats-record-dot' }); dot.style.backgroundColor = activityColor(record.activity); const date = new Date(record.timestamp); row.createDiv({ cls: 'dashboard-pomodoro-stats-record-date', text: `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}` }); row.createDiv({ cls: 'dashboard-pomodoro-stats-record-activity', text: record.activity || '默认专注' }); row.createDiv({ cls: 'dashboard-pomodoro-stats-record-duration', text: formatMinutes(record.duration) }); }
	}
	function renderFilter(): void { filterBar.empty(); filterBar.toggleClass('dashboard-pomodoro-filterbar--visible', !!activityFilter); if (!activityFilter) return; const chip = filterBar.createDiv({ cls: 'dashboard-pomodoro-filterbar-chip', text: `筛选：${activityFilter}` }); const clear = chip.createSpan({ text: ' ×' }); clear.addEventListener('click', () => { activityFilter = null; renderAll(); }); }
	function renderAll(): void { renderFilter(); renderSummary(); renderDonut(); renderTrend(); renderRanking(); renderHeatmap(); renderRecent(); }
	manageButton.addEventListener('click', () => openPomodoroTagManager(doc, service, renderAll));
	rangeButtons.forEach((button, index) => button.addEventListener('click', () => { range = RANGES[index]!.key; rangeButtons.forEach((item, itemIndex) => item.toggleClass('dashboard-pomodoro-range-btn--active', itemIndex === index)); activityFilter = null; renderAll(); }));
	renderAll();
}

function dateKey(date: Date): string { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function formatMinutes(minutes: number): string { return minutes >= 60 ? `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ''}` : `${minutes} 分钟`; }
