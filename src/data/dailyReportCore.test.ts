import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TaskItem } from './taskParser.ts';
import {
	buildDailyReport, dailyReportsToCsv, dailyReportsToMarkdownTable,
	parseMonthlyReports, renderMonthlyReports,
} from './dailyReportCore.ts';

function task(partial: Partial<TaskItem> = {}): TaskItem {
	return {
		id: '项目/任务.md', content: '默认任务', status: '待办', priority: null,
		startDate: null, dueDate: null, tags: [], type: '普通', repeatRule: null,
		reminder: [], notes: '', completeTime: null, dailyNodes: {}, projectId: '项目',
		color: '#fff', sourceFile: '项目/任务.md', isOverdue: false, remindDate: null,
		parent: '', opportunityIds: [], ...partial,
	};
}

test('日报按完成日期收集今日总结，并只保留本周未完成任务作为计划', () => {
	const report = buildDailyReport('2026-08-30', [
		task({ content: '当天完成', completeTime: '2026-08-30 09:15', projectId: '项目 A' }),
		task({ content: '重复任务完成', dailyNodes: { '2026-08-30': { s: 'done', n: '' } }, projectId: '项目 B' }),
		task({ content: '本周待办', dueDate: '2026-08-28', projectId: '项目 C' }),
		task({ content: '已完成不计划', status: '已完成', dueDate: '2026-09-02', completeTime: '2026-08-29 12:00' }),
		task({ content: '下周待办', dueDate: '2026-09-07' }),
	]);
	assert.deepEqual(report.summary, ['当天完成。（项目 A）', '重复任务完成。（项目 B）']);
	assert.deepEqual(report.plan, ['本周待办。（项目 C）']);
});

test('月报渲染和解析保持日期倒序及日报正文', () => {
	const content = renderMonthlyReports([
		{ date: '2026-08-29', summary: ['较早任务。（项目）'], plan: [] },
		{ date: '2026-08-30', summary: ['最新任务。（项目）'], plan: ['后续任务。（项目）'] },
	]);
	assert.match(content, /^# 2026-08-30/m);
	assert.deepEqual(parseMonthlyReports(content), [
		{ date: '2026-08-30', summary: ['最新任务。（项目）'], plan: ['后续任务。（项目）'] },
		{ date: '2026-08-29', summary: ['较早任务。（项目）'], plan: [] },
	]);
});

test('没有任务的今日日报使用 --- 占位且解析后仍为空数组', () => {
	const content = renderMonthlyReports([{ date: '2026-09-01', summary: [], plan: [] }]);
	assert.match(content, /\*\*今日总结：\*\*\n---/);
	assert.match(content, /\*\*明日计划：\*\*\n---/);
	assert.deepEqual(parseMonthlyReports(content), [{ date: '2026-09-01', summary: [], plan: [] }]);
});

test('导出同时支持 CSV 表格和 Markdown 表格', () => {
	const records = [{ date: '2026-08-30', summary: ['完成任务。（项目）'], plan: ['计划任务。（项目）'] }];
	assert.match(dailyReportsToCsv(records), /^\uFEFF日报时间,日报内容/m);
	assert.match(dailyReportsToMarkdownTable(records), /^\| 日报时间 \| 日报内容 \|/m);
});
