import { App, TFile, TFolder } from 'obsidian';
import type { TaskItem } from './taskParser';
import { buildDailyReport, doneDates, parseMonthlyReports, renderMonthlyReports } from './dailyReportCore';
export {
	DailyReportRecord, buildDailyReport, dailyReportsToCsv, dailyReportsToMarkdownTable,
	doneDates, parseMonthlyReports, renderDailyReport, renderMonthlyReports,
} from './dailyReportCore';
import type { DailyReportRecord } from './dailyReportCore';

export const DAILY_REPORT_FOLDER = '日报';

function monthKey(date: string): string {
	return date.slice(0, 7);
}

function monthKeys(start?: string, end?: string): string[] {
	if (!start || !end) return [];
	const cursor = new Date(start + 'T00:00:00');
	const last = new Date(end + 'T00:00:00');
	const keys: string[] = [];
	while (cursor <= last) {
		keys.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`);
		cursor.setMonth(cursor.getMonth() + 1, 1);
	}
	return [...new Set(keys)];
}

/** 日报月文件读写，任务仍是唯一业务数据源。 */
export class DailyReportStore {
	constructor(private app: App) {}

	filePath(month: string): string {
		return `${DAILY_REPORT_FOLDER}/${month}日报.md`;
	}

	async listRange(start: string, end: string): Promise<DailyReportRecord[]> {
		const months = new Set(monthKeys(start, end));
		const files = this.app.vault.getFiles().filter((file) => {
			const match = file.path.match(new RegExp(`^${DAILY_REPORT_FOLDER}/(\\d{4}-\\d{2})日报\\.md$`));
			return !!match && months.has(match[1]!);
		});
		const records = await Promise.all(files.map(async (file) => parseMonthlyReports(await this.app.vault.cachedRead(file))));
		return records.flat().filter((record) => record.date >= start && record.date <= end).sort((a, b) => b.date.localeCompare(a.date));
	}

	async syncTask(task: TaskItem, allTasks: TaskItem[], previousTask?: TaskItem): Promise<void> {
		const dates = new Set([...doneDates(previousTask ?? task), ...doneDates(task)]);
		for (const date of dates) await this.upsert(buildDailyReport(date, allTasks));
	}

	private writeQueues = new Map<string, Promise<void>>();

	async upsert(record: DailyReportRecord): Promise<void> {
		const path = this.filePath(monthKey(record.date));
		const previous = this.writeQueues.get(path) ?? Promise.resolve();
		const operation = previous.catch(() => undefined).then(async () => {
			await this.ensureFolder();
			const existing = this.app.vault.getAbstractFileByPath(path);
			const records = existing instanceof TFile ? parseMonthlyReports(await this.app.vault.cachedRead(existing)) : [];
			const index = records.findIndex((item) => item.date === record.date);
			if (index >= 0) records[index] = record;
			else records.push(record);
			const content = renderMonthlyReports(records);
			if (existing instanceof TFile) await this.app.vault.modify(existing, content);
			else await this.app.vault.create(path, content);
		});
		this.writeQueues.set(path, operation);
		try { await operation; } finally {
			if (this.writeQueues.get(path) === operation) this.writeQueues.delete(path);
		}
	}

	async writeExport(extension: 'csv' | 'md', content: string): Promise<string> {
		await this.ensureFolder();
		const now = new Date();
		const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
		const path = `${DAILY_REPORT_FOLDER}/日报导出-${stamp}.${extension}`;
		await this.app.vault.create(path, content);
		return path;
	}

	private async ensureFolder(): Promise<void> {
		if (this.app.vault.getAbstractFileByPath(DAILY_REPORT_FOLDER) instanceof TFolder) return;
		await this.app.vault.createFolder(DAILY_REPORT_FOLDER);
	}
}
