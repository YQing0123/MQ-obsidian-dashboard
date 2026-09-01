import type { TaskItem } from './taskParser';

export interface DailyReportRecord {
	date: string;
	summary: string[];
	plan: string[];
}

function dateFromString(value: string): Date {
	return new Date(value + 'T00:00:00');
}

function weekRange(date: string): { start: string; end: string } {
	const start = dateFromString(date);
	const day = start.getDay() || 7;
	start.setDate(start.getDate() - day + 1);
	const end = new Date(start);
	end.setDate(end.getDate() + 6);
	const format = (value: Date): string => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
	return { start: format(start), end: format(end) };
}

function lineForTask(task: TaskItem): string {
	return `${task.content}。（${task.projectId || '未归属项目'}）`;
}

export function doneDates(task: TaskItem): string[] {
	const dates = new Set<string>();
	if (/^\d{4}-\d{2}-\d{2}/.test(task.completeTime || '')) dates.add((task.completeTime || '').slice(0, 10));
	for (const [date, node] of Object.entries(task.dailyNodes || {})) {
		if (node.s === 'done' && /^\d{4}-\d{2}-\d{2}$/.test(date)) dates.add(date);
	}
	return [...dates];
}

/** 根据任务快照生成指定日期的日报正文。 */
export function buildDailyReport(date: string, tasks: TaskItem[]): DailyReportRecord {
	const summary = tasks
		.filter((task) => doneDates(task).includes(date))
		.sort((a, b) => a.projectId.localeCompare(b.projectId, 'zh-CN') || a.content.localeCompare(b.content, 'zh-CN'))
		.map(lineForTask);
	const range = weekRange(date);
	const plan = tasks
		.filter((task) => task.status !== '已完成' && task.status !== '已取消')
		.filter((task) => !!task.dueDate && task.dueDate >= range.start && task.dueDate <= range.end)
		.sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || '') || a.content.localeCompare(b.content, 'zh-CN'))
		.map(lineForTask);
	return { date, summary, plan };
}

export function renderDailyReport(record: DailyReportRecord): string {
	const list = (items: string[], empty: string): string => items.length
		? items.map((item, index) => `${index + 1}、${item}`).join('\n')
		: empty;
	return [
		`# ${record.date}`,
		'**今日总结：**',
		list(record.summary, '---'),
		'',
		'**明日计划：**',
		list(record.plan, '---'),
	].join('\n');
}

export function renderMonthlyReports(records: DailyReportRecord[]): string {
	return [...records]
		.sort((a, b) => b.date.localeCompare(a.date))
		.map(renderDailyReport)
		.join('\n\n') + (records.length ? '\n' : '');
}

export function parseMonthlyReports(content: string): DailyReportRecord[] {
	const headers: Array<{ date: string; index: number; length: number }> = [];
	const pattern = /^# (\d{4}-\d{2}-\d{2})\s*$/gm;
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(content)) !== null) headers.push({ date: match[1]!, index: match.index, length: match[0].length });
	const records: DailyReportRecord[] = [];
	for (let index = 0; index < headers.length; index++) {
		const header = headers[index]!;
		const bodyStart = header.index + header.length;
		const bodyEnd = headers[index + 1]?.index ?? content.length;
		const body = content.slice(bodyStart, bodyEnd);
		const section = (label: string): string[] => {
			const found = body.match(new RegExp(`\\*\\*${label}：\\*\\*\\s*\\n([\\s\\S]*?)(?=\\n\\s*\\*\\*(?:今日总结|明日计划)：\\*\\*|$)`));
			if (!found?.[1]) return [];
			return found[1].split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
				.filter((line) => line !== '---' && !line.startsWith('暂无'))
				.map((line) => line.replace(/^\d+、/, ''));
		};
		records.push({ date: header.date, summary: section('今日总结'), plan: section('明日计划') });
	}
	return records.sort((a, b) => b.date.localeCompare(a.date));
}

function csvCell(value: string): string {
	return `"${value.replace(/"/g, '""')}"`;
}

export function dailyReportsToCsv(records: DailyReportRecord[]): string {
	const rows = ['日报时间,日报内容'];
	for (const record of records) {
		const content = `今日总结：\n${record.summary.map((item, index) => `${index + 1}、${item}`).join('\n') || '---'}\n\n明日计划：\n${record.plan.map((item, index) => `${index + 1}、${item}`).join('\n') || '---'}`;
		rows.push([record.date, content].map(csvCell).join(','));
	}
	return '\uFEFF' + rows.join('\n') + '\n';
}

export function dailyReportsToMarkdownTable(records: DailyReportRecord[]): string {
	const rows = ['| 日报时间 | 日报内容 |', '| --- | --- |'];
	for (const record of records) {
		const content = `**今日总结：**<br>${record.summary.map((item, index) => `${index + 1}、${item}`).join('<br>') || '---'}<br><br>**明日计划：**<br>${record.plan.map((item, index) => `${index + 1}、${item}`).join('<br>') || '---'}`;
		rows.push(`| ${record.date} | ${content.replace(/\|/g, '\\|')} |`);
	}
	return rows.join('\n') + '\n';
}
