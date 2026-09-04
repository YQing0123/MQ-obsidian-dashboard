import { App, Modal, setIcon } from 'obsidian';
import { UI_TEXT } from '../constants';

/* ============================================================
   Task Creation Modal — Full form with all fields
   ============================================================ */

interface ProjectInfo { name: string; path: string }
interface TaskInfo { id: string; title: string; projectId: string }

export interface TaskFormData {
	title: string;
	project: string;
	parent: string;
	startDate: string;
	endDate: string;
	priority: string;
	status: string;
	type: string;
	// Structured repeat settings (replaces free-text 重复详情)
	repeatFreq: string;            // 'daily' | 'weekly' | 'monthly' | ''
	repeatInterval: number;        // daily: every N days (>=1)
	repeatWorkdaysOnly: boolean;   // daily: workdays only
	repeatWeekdays: number[];      // weekly: 1=Mon .. 7=Sun
	repeatMonthDay: number;        // monthly: day of month 1..31
	noEndDate: boolean;            // recurring: no end bound
	reminders: string[];
	tags: string[];
	notes: string;
}

interface TaskModalOptions {
	app: App;
	projects: ProjectInfo[];
	allTasks?: TaskInfo[];
	defaultProject?: string;
	defaultParent?: string;
	defaultTitle?: string;
	onSave: (data: TaskFormData) => void;
}

const PRIORITIES = [
	{ value: '重要且紧急', label: '🔴 重要且紧急' },
	{ value: '重要不紧急', label: '🟡 重要不紧急' },
	{ value: '紧急不重要', label: '🔵 紧急不重要' },
	{ value: '不重要不紧急', label: '⚪ 不重要不紧急' },
	{ value: '', label: UI_TEXT.notSet },
];

const STATUSES = [
	{ value: 'todo', label: '待办' },
	{ value: 'in-progress', label: '进行中' },
	{ value: 'blocked', label: '已阻塞' },
	{ value: 'done', label: '已完成' },
	{ value: 'cancelled', label: '已取消' },
];

const TYPES = [
	{ value: 'task', label: '普通' },
	{ value: 'recurring', label: '重复' },
];

// Repeat frequency — "每年" removed per product decision.
const REPEAT_FREQS = [
	{ value: '', label: '选择频率' },
	{ value: 'daily', label: '每天' },
	{ value: 'weekly', label: '每周' },
	{ value: 'monthly', label: '每月' },
];

// 周一..周日 with internal value 1..7 (1=Mon, 7=Sun)
const WEEKDAYS = [
	{ value: 1, label: '周一' },
	{ value: 2, label: '周二' },
	{ value: 3, label: '周三' },
	{ value: 4, label: '周四' },
	{ value: 5, label: '周五' },
	{ value: 6, label: '周六' },
	{ value: 7, label: '周日' },
];

const REMINDER_OPTIONS = [
	'任务当天', '提前 1 天', '提前 3 天', '提前 1 周',
];

const getToday = (): string => {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Convert a YYYY-MM-DD to a weekday number 1..7 (1=Mon, 7=Sun). */
const dateToDow = (s: string): number => {
	const d = s ? new Date(s + 'T00:00:00') : new Date();
	if (isNaN(d.getTime())) return 1;
	return ((d.getDay() + 6) % 7) + 1;
};

export class TaskModal extends Modal {
	private opts: TaskModalOptions;
	private tags: string[] = ['\u4EFB\u52A1'];
	private selectedReminders: string[] = [];

	constructor(opts: TaskModalOptions) {
		super(opts.app);
		this.opts = opts;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass('mq-ad-task-modal');
		contentEl.createEl('h3', { cls: 'mq-ad-modal-title', text: '新建任务' });

		// ---- Title ----
		this.field('任务名称 *', (wrap) => {
			const input = wrap.createEl('input', { cls: 'mq-ad-modal-input mq-ad-input-title', attr: { type: 'text', placeholder: '输入任务名称' } });
			input.value = this.opts.defaultTitle || '';
		});

		// ---- Project + Parent (side by side) ----
		const row1 = contentEl.createDiv({ cls: 'mq-ad-modal-row' });

		const projCol = row1.createDiv({ cls: 'mq-ad-modal-col' });
		this.label(projCol, '所属项目 *');
		const projSel = projCol.createEl('select', { cls: 'mq-ad-modal-input' });
		for (const p of this.opts.projects) {
			projSel.createEl('option', { text: p.name, attr: { value: p.name } });
		}
		const initialProject = this.opts.defaultProject ?? this.opts.projects[0]?.name;
		if (initialProject) {
			const match = Array.from(projSel.options).find((o) => o.value === initialProject);
			if (match) match.selected = true;
			else projSel.value = initialProject;
		}

		const parentCol = row1.createDiv({ cls: 'mq-ad-modal-col' });
		this.label(parentCol, '父任务');
		const parentPicker = parentCol.createDiv({ cls: 'mq-ad-parent-combobox' });
		const parentInput = parentPicker.createEl('input', {
			cls: 'mq-ad-modal-input',
			attr: {
				type: 'search', placeholder: '搜索或选择父任务', 'aria-label': '搜索或选择父任务',
				role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': 'false', autocomplete: 'off',
			},
		});
		const parentToggle = parentPicker.createEl('button', { cls: 'mq-ad-parent-combobox__toggle', attr: { type: 'button', 'aria-label': '展开父任务列表', title: '展开父任务列表' } });
		setIcon(parentToggle, 'chevron-down');
		const parentMenu = parentPicker.createDiv({ cls: 'mq-ad-parent-combobox__menu', attr: { role: 'listbox' } });
		const parentOptionsId = `mq-ad-parent-options-${crypto.randomUUID()}`;
		parentMenu.id = parentOptionsId;
		parentInput.setAttribute('aria-controls', parentOptionsId);

		const parentCandidates = (projectName: string): TaskInfo[] => {
			const byTitle = new Map<string, TaskInfo>();
			for (const task of this.opts.allTasks || []) if (task.projectId === projectName && !byTitle.has(task.title)) byTitle.set(task.title, task);
			return [...byTitle.values()].sort((left, right) => left.title.localeCompare(right.title, 'zh-CN'));
		};
		let parentMenuOpen = false;
		let activeParentIndex = 0;
		let visibleParents: Array<{ value: string; label: string }> = [];
		const closeParentMenu = (): void => {
			parentMenuOpen = false;
			parentMenu.removeClass('is-open');
			parentInput.setAttribute('aria-expanded', 'false');
			parentToggle.removeClass('is-open');
		};
		const selectParent = (value: string): void => {
			parentInput.value = value;
			parentInput.removeClass('mq-ad-input-error');
			closeParentMenu();
		};
		const renderParentMenu = (): void => {
			const keyword = parentInput.value.trim().toLocaleLowerCase();
			visibleParents = [{ value: '', label: '无（顶级任务）' }, ...parentCandidates(projSel.value)
				.filter((task) => !keyword || task.title.toLocaleLowerCase().includes(keyword))
				.map((task) => ({ value: task.title, label: task.title }))];
			activeParentIndex = Math.max(0, Math.min(activeParentIndex, visibleParents.length - 1));
			parentMenu.empty();
			for (const [index, parent] of visibleParents.entries()) {
				const option = parentMenu.createEl('button', {
					cls: `mq-ad-parent-combobox__option${index === activeParentIndex ? ' is-active' : ''}${parent.value === parentInput.value ? ' is-selected' : ''}`,
					text: parent.label,
					attr: { type: 'button', role: 'option', 'aria-selected': String(parent.value === parentInput.value) },
				});
				option.addEventListener('click', () => selectParent(parent.value));
			}
			if (visibleParents.length === 1 && keyword) parentMenu.createDiv({ cls: 'mq-ad-parent-combobox__empty', text: '没有匹配的父任务' });
		};
		const openParentMenu = (): void => {
			parentMenuOpen = true;
			activeParentIndex = 0;
			renderParentMenu();
			parentMenu.addClass('is-open');
			parentInput.setAttribute('aria-expanded', 'true');
			parentToggle.addClass('is-open');
		};

		if (this.opts.defaultParent) parentInput.value = this.opts.defaultParent;

		projSel.addEventListener('change', () => {
			parentInput.value = '';
			closeParentMenu();
		});
		parentInput.addEventListener('focus', openParentMenu);
		parentInput.addEventListener('input', () => { activeParentIndex = 0; parentInput.removeClass('mq-ad-input-error'); if (!parentMenuOpen) openParentMenu(); else renderParentMenu(); });
		parentInput.addEventListener('keydown', (event) => {
			if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
				event.preventDefault();
				if (!parentMenuOpen) openParentMenu();
				else { activeParentIndex = (activeParentIndex + (event.key === 'ArrowDown' ? 1 : -1) + visibleParents.length) % visibleParents.length; renderParentMenu(); }
			} else if (event.key === 'Enter' && parentMenuOpen) {
				event.preventDefault();
				const parent = visibleParents[activeParentIndex];
				if (parent) selectParent(parent.value);
			} else if (event.key === 'Escape') closeParentMenu();
		});
		parentToggle.addEventListener('click', () => {
			if (parentMenuOpen) closeParentMenu();
			else { parentInput.focus(); openParentMenu(); }
		});
		parentPicker.addEventListener('focusout', () => window.setTimeout(() => { if (!parentPicker.contains(document.activeElement)) closeParentMenu(); }, 0));

		// ---- Dates (side by side) ----
		const row2 = contentEl.createDiv({ cls: 'mq-ad-modal-row' });

		const startCol = row2.createDiv({ cls: 'mq-ad-modal-col' });
		const startLabel = startCol.createEl('label', { cls: 'mq-ad-modal-label', text: '开始日期 *' });
		const startInput = startCol.createEl('input', { cls: 'mq-ad-modal-input', attr: { type: 'date' } });
		startInput.value = getToday();

		const endCol = row2.createDiv({ cls: 'mq-ad-modal-col' });
		const endLabel = endCol.createEl('label', { cls: 'mq-ad-modal-label', text: '结束日期' });
		const endInput = endCol.createEl('input', { cls: 'mq-ad-modal-input', attr: { type: 'date' } });
		endInput.value = getToday();

		// "No end date" — only relevant for recurring tasks
		const noEndWrap = contentEl.createDiv({ cls: 'mq-ad-modal-row mq-ad-hidden' });
		const noEndCol = noEndWrap.createDiv({ cls: 'mq-ad-modal-col' });
		const noEndLbl = noEndCol.createEl('label', { cls: 'mq-ad-rem-item' });
		const noEndCb = noEndLbl.createEl('input', { attr: { type: 'checkbox' } });
		noEndLbl.createSpan({ text: '无结束日期（无限重复）' });
		noEndCb.addEventListener('change', () => {
			endInput.disabled = noEndCb.checked;
			if (noEndCb.checked) endInput.value = '';
		});

		// ---- Priority + Status + Type (side by side) ----
		const row3 = contentEl.createDiv({ cls: 'mq-ad-modal-row' });

		const prioCol = row3.createDiv({ cls: 'mq-ad-modal-col' });
		this.label(prioCol, '优先级');
		const prioSel = prioCol.createEl('select', { cls: 'mq-ad-modal-input' });
		for (const p of PRIORITIES) prioSel.createEl('option', { text: p.label, attr: { value: p.value } });

		const statusCol = row3.createDiv({ cls: 'mq-ad-modal-col' });
		this.label(statusCol, '状态 *');
		const statusSel = statusCol.createEl('select', { cls: 'mq-ad-modal-input' });
		for (const s of STATUSES) statusSel.createEl('option', { text: s.label, attr: { value: s.value } });

		const typeCol = row3.createDiv({ cls: 'mq-ad-modal-col' });
		this.label(typeCol, '类型 *');
		const typeSel = typeCol.createEl('select', { cls: 'mq-ad-modal-input' });
		for (const t of TYPES) typeSel.createEl('option', { text: t.label, attr: { value: t.value } });

		// ---- Repeat (conditional, structured) ----
		const repeatWrap = contentEl.createDiv({ cls: 'mq-ad-modal-row mq-ad-repeat-section mq-ad-hidden' });

		const freqCol = repeatWrap.createDiv({ cls: 'mq-ad-modal-col' });
		this.label(freqCol, '重复频率');
		const freqSel = freqCol.createEl('select', { cls: 'mq-ad-modal-input' });
		for (const f of REPEAT_FREQS) freqSel.createEl('option', { text: f.label, attr: { value: f.value } });

		// Dynamic options container (re-rendered on frequency change)
		const repeatOptsWrap = contentEl.createDiv({ cls: 'mq-ad-repeat-opts mq-ad-hidden' });

		const renderRepeatOpts = (): void => {
			repeatOptsWrap.empty();
			const f = freqSel.value;
			if (!f) { repeatOptsWrap.addClass('mq-ad-hidden'); return; }
			repeatOptsWrap.removeClass('mq-ad-hidden');

			if (f === 'daily') {
				const row = repeatOptsWrap.createDiv({ cls: 'mq-ad-modal-row' });
				const c1 = row.createDiv({ cls: 'mq-ad-modal-col' });
				this.label(c1, '每 N 天');
				const interval = c1.createEl('input', { cls: 'mq-ad-modal-input mq-ad-repeat-interval', attr: { type: 'number', min: '1', value: '1' } });
				const c2 = row.createDiv({ cls: 'mq-ad-modal-col' });
				const wdLbl = c2.createEl('label', { cls: 'mq-ad-rem-item' });
				const wd = wdLbl.createEl('input', { cls: 'mq-ad-repeat-workdays', attr: { type: 'checkbox' } });
				wdLbl.createSpan({ text: '仅工作日' });
			} else if (f === 'weekly') {
				const row = repeatOptsWrap.createDiv({ cls: 'mq-ad-modal-row' });
				const c = row.createDiv({ cls: 'mq-ad-modal-col' });
				this.label(c, '重复星期（可多选）');
				const wdRow = c.createDiv({ cls: 'mq-ad-repeat-weekdays' });
				const startDow = dateToDow(startInput.value);
				for (const wd of WEEKDAYS) {
					const lbl = wdRow.createEl('label', { cls: 'mq-ad-rem-item' });
					const cb = lbl.createEl('input', { cls: 'mq-ad-repeat-weekday', attr: { type: 'checkbox', value: String(wd.value) } });
					if (wd.value === startDow) cb.checked = true;
					lbl.createSpan({ text: wd.label });
				}
			} else if (f === 'monthly') {
				const row = repeatOptsWrap.createDiv({ cls: 'mq-ad-modal-row' });
				const c = row.createDiv({ cls: 'mq-ad-modal-col' });
				this.label(c, '每月几号');
				const mdVal = startInput.value ? new Date(startInput.value + 'T00:00:00').getDate() : 1;
				c.createEl('input', { cls: 'mq-ad-modal-input mq-ad-repeat-monthday', attr: { type: 'number', min: '1', max: '31', value: String(mdVal) } });
			}
		};

		freqSel.addEventListener('change', renderRepeatOpts);

		// Type change: show/hide repeat UI, status picker, no-end checkbox, relabel dates
		const applyType = (): void => {
			const isRecurring = typeSel.value === 'recurring';
			repeatWrap.toggleClass('mq-ad-hidden', !isRecurring);
			noEndWrap.toggleClass('mq-ad-hidden', !isRecurring);
			statusCol.toggleClass('mq-ad-hidden', isRecurring); // recurring is always 进行中
			if (isRecurring) {
				startLabel.textContent = '首次发生日期 *';
				endLabel.textContent = '结束日期（界限）';
				renderRepeatOpts();
			} else {
				startLabel.textContent = '开始日期 *';
				endLabel.textContent = '结束日期';
			}
		};
		typeSel.addEventListener('change', applyType);

		// ---- Reminders ----
		this.label(contentEl, '提醒');
		const remWrap = contentEl.createDiv({ cls: 'mq-ad-rem-group' });
		for (const opt of REMINDER_OPTIONS) {
			const lbl = remWrap.createEl('label', { cls: 'mq-ad-rem-item' });
			const cb = lbl.createEl('input', { attr: { type: 'checkbox' } });
			cb.addEventListener('change', () => {
				if (cb.checked) this.selectedReminders.push(opt);
				else this.selectedReminders = this.selectedReminders.filter((r) => r !== opt);
			});
			lbl.createSpan({ text: opt });
		}

		// ---- Tags ----
		this.label(contentEl, '标签');
		const tagWrap = contentEl.createDiv({ cls: 'mq-ad-tag-wrap' });
		const tagChips = tagWrap.createDiv({ cls: 'mq-ad-tag-chips' });
		const tagInput = tagWrap.createEl('input', {
			cls: 'mq-ad-modal-input mq-ad-tag-input',
			attr: { type: 'text', placeholder: '输入后回车添加' },
		});
		tagInput.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				const val = tagInput.value.trim();
				if (val && !this.tags.includes(val)) {
					this.tags.push(val);
					this.renderTagChip(tagChips, val);
				}
				tagInput.value = '';
			}
		});
		this.tags.forEach((tag) => this.renderTagChip(tagChips, tag));

		// ---- Notes ----
		this.label(contentEl, '备注');
		const notesArea = contentEl.createEl('textarea', {
			cls: 'mq-ad-modal-input',
			attr: { rows: '5', placeholder: '补充说明…' },
		});

		// ---- Buttons ----
		const btns = contentEl.createDiv({ cls: 'mq-ad-modal-btns' });
		btns.createEl('button', { cls: 'mq-ad-modal-btn', text: UI_TEXT.cancel })
			.addEventListener('click', () => this.close());
		btns.createEl('button', { cls: 'mq-ad-modal-btn mq-ad-modal-btn--primary', text: '创建任务' })
			.addEventListener('click', () => {
				contentEl.querySelectorAll('.mq-ad-input-error').forEach((el) => el.removeClass('mq-ad-input-error'));

					const titleEl = contentEl.querySelector('.mq-ad-input-title') as HTMLInputElement;
					const title = titleEl?.value?.trim();
					const parent = parentInput.value.trim();
					if (parent && !parentCandidates(projSel.value).some((candidate) => candidate.title === parent)) {
						parentInput.addClass('mq-ad-input-error');
						parentInput.focus();
						return;
					}

				const fields: [HTMLElement | null, string][] = [
					[titleEl, title || ''],
					[projSel, projSel.value],
					[startInput, startInput.value],
					[typeSel, typeSel.value],
				];
				// For normal tasks, status is required; for recurring it's fixed to 进行中.
				if (typeSel.value !== 'recurring') fields.push([statusSel, statusSel.value]);

				let firstError: HTMLElement | null = null;
				for (const [el, val] of fields) {
					if (!val && el) {
						el.addClass('mq-ad-input-error');
						if (!firstError) firstError = el;
					}
				}
				if (firstError) { firstError.focus(); return; }

				const isRecurring = typeSel.value === 'recurring';
				const noEnd = isRecurring && noEndCb.checked;
				const intervalEl = repeatOptsWrap.querySelector('.mq-ad-repeat-interval');
				const workdayEl = repeatOptsWrap.querySelector('.mq-ad-repeat-workdays');
				const weekdayEls = repeatOptsWrap.querySelectorAll('.mq-ad-repeat-weekday');
				const monthDayEl = repeatOptsWrap.querySelector('.mq-ad-repeat-monthday');

				const data: TaskFormData = {
					title,
					project: projSel.value,
						parent,
					startDate: startInput.value || getToday(),
					endDate: noEnd ? '' : (endInput.value || startInput.value || getToday()),
					priority: (prioSel).value,
					status: (statusSel).value || 'todo',
					type: (typeSel).value || 'task',
					repeatFreq: isRecurring ? freqSel.value : '',
					repeatInterval: intervalEl instanceof HTMLInputElement ? (parseInt(intervalEl.value, 10) || 1) : 1,
					repeatWorkdaysOnly: !!(workdayEl instanceof HTMLInputElement && workdayEl.checked),
					repeatWeekdays: Array.from(weekdayEls).filter((cb): cb is HTMLInputElement => cb instanceof HTMLInputElement).map((cb) => parseInt(cb.value, 10)),
					repeatMonthDay: monthDayEl instanceof HTMLInputElement ? (parseInt(monthDayEl.value, 10) || 1) : 1,
					noEndDate: noEnd,
					reminders: [...this.selectedReminders],
					tags: [...this.tags],
					notes: (notesArea).value.trim(),
				};
				this.opts.onSave(data);
				this.close();
			});

		(contentEl.querySelector('.mq-ad-input-title') as HTMLInputElement)?.focus();
	}

	private label(parent: HTMLElement, text: string): void {
		parent.createEl('label', { cls: 'mq-ad-modal-label', text });
	}

	private field(labelText: string, build: (wrap: HTMLElement) => void): void {
		const wrap = this.contentEl.createDiv({ cls: 'mq-ad-modal-field' });
		this.label(wrap, labelText);
		build(wrap);
	}

	private renderTagChip(container: HTMLElement, tag: string): void {
		const chip = container.createSpan({ cls: 'mq-ad-tag-chip' });
		chip.createSpan({ text: tag });
		const x = chip.createSpan({ cls: 'mq-ad-tag-x', text: '\u00D7' });
		x.addEventListener('click', () => {
			this.tags = this.tags.filter((t) => t !== tag);
			chip.remove();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
