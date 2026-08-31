/**
 * Calendar text adapter for the Xove renderer.
 *
 * The existing MQ plugin keeps its compact Chinese constants instead of
 * adopting Xove's application-wide language switch. These keys mirror the
 * calendar dictionary used by Xove so the renderer can be ported unchanged.
 */
const STRINGS: Record<string, string> = {
	'home.calNodeDone': '已完成',
	'home.calNodeSkip': '已跳过',
	'home.calNodeTodo': '未完成',
	'home.nodeDone': '✅ {date} 已完成',
	'home.nodeSkipped': '⏭️ {date} 已跳过',
	'home.nodeTodo': '📝 {date} 标记未做',
	'ui.calDayFmt': '{m}月{d}日',
	'ui.calOverdueDays': '逾期 {n} 天',
	'ui.calProgress': '总进度：{done} / {total}',
	'ui.calCtxDelete': '删除',
	'ui.calCtxOpenSource': '打开源文件',
	'ui.calViewMonth': '月',
	'ui.calViewWeek': '周',
	'ui.calMonthFmt': '{y}年{m}月',
	'ui.calOverflowRow': '当日溢出任务',
	'ui.calAgendaToday': '今天',
	'ui.calTaskCount': '{n} 项任务',
	'ui.noTaskOnDay': '该日期暂无任务',
	'ui.calNewTask': '+ 新建任务',
};

const ARRAYS: Record<string, string[]> = {
	'status.months': ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
};

export function t(path: string, params?: Record<string, string | number>): string {
	let value = STRINGS[path] ?? path;
	for (const [key, param] of Object.entries(params ?? {})) {
		value = value.replace(new RegExp('\\{' + key + '\\}', 'g'), String(param));
	}
	return value;
}

export function tArr(path: string): string[] {
	return ARRAYS[path] ?? [];
}
