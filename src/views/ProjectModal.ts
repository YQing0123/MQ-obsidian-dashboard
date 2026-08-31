import { App, Modal } from 'obsidian';
import { LONG_TERM_STAGES, ProjectType, PROJECT_TYPE_LIST, isLongTermProject } from '../data/taskParser';
import { UI_TEXT } from '../constants';

export interface ProjectFormData {
	name: string;
	color: string;
	startDate: string;
	endDate: string;
	description: string;
	stage: number;
	type: ProjectType;
}

interface ProjectModalOptions {
	app: App;
	onSave: (data: ProjectFormData) => void;
	editData?: ProjectFormData;
	stages?: string[];
}

const COLORS = [
	'#3b82f6', '#6366f1', '#a855f7', '#ec4899',
	'#ef4444', '#f97316', '#eab308', '#22c55e',
	'#14b8a6', '#06b6d4',
];

const getToday = (): string => {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export class ProjectModal extends Modal {
	private opts: ProjectModalOptions;
	private selectedColor: string = COLORS[0] ?? '#3b82f6';
	private isEdit: boolean;
	private selectedStage: number = 0;
	private selectedType: ProjectType = 'stage';

	constructor(opts: ProjectModalOptions) {
		super(opts.app);
		this.opts = opts;
		this.isEdit = !!opts.editData;
		if (opts.editData) {
			this.selectedColor = opts.editData.color;
			this.selectedStage = opts.editData.stage ?? 0;
		this.selectedType = opts.editData.type === 'nostage' ? 'longterm' : (opts.editData.type ?? 'stage');
		}
	}

	onOpen(): void {
		const { contentEl } = this;
		const ed = this.opts.editData;
		contentEl.addClass('mq-ad-task-modal');
		contentEl.createEl('h3', { cls: 'mq-ad-modal-title', text: this.isEdit ? '编辑项目' : '新建项目' });

		contentEl.createEl('label', { cls: 'mq-ad-modal-label', text: '项目名称 *' });
		const nameInput = contentEl.createEl('input', {
			cls: 'mq-ad-modal-input mq-ad-input-name',
			attr: { type: 'text', placeholder: '输入项目名称' },
		});
		if (ed) {
			(nameInput).value = ed.name;
			(nameInput).disabled = true;
		}

		// Project type selector
		contentEl.createEl('label', { cls: 'mq-ad-modal-label', text: '项目类型' });
		const typeWrap = contentEl.createDiv({ cls: 'mq-ad-modal-row' });
		const typeSelect = typeWrap.createEl('select', { cls: 'mq-ad-modal-input' });
		for (const opt of PROJECT_TYPE_LIST) {
			typeSelect.createEl('option', { value: opt.value, text: opt.label });
		}
		typeSelect.value = this.selectedType;
		typeSelect.addEventListener('change', () => {
			this.selectedType = (typeSelect.value as ProjectType) || 'stage';
			populateStages();
		});

		contentEl.createEl('label', { cls: 'mq-ad-modal-label', text: '项目颜色（用于甘特图）' });
		const colorWrap = contentEl.createDiv({ cls: 'mq-ad-color-group' });
		for (const c of COLORS) {
			const swatch = colorWrap.createEl('button', {
				cls: 'mq-ad-color-swatch' + (c === this.selectedColor ? ' is-selected' : ''),
				attr: { type: 'button', 'data-color': c },
			});
			swatch.style.background = c;
			swatch.addEventListener('click', () => {
				colorWrap.querySelectorAll('.mq-ad-color-swatch').forEach((s) => s.removeClass('is-selected'));
				swatch.addClass('is-selected');
				this.selectedColor = c;
			});
		}

		const row = contentEl.createDiv({ cls: 'mq-ad-modal-row' });

		const startCol = row.createDiv({ cls: 'mq-ad-modal-col' });
		startCol.createEl('label', { cls: 'mq-ad-modal-label', text: '开始日期 *' });
		const startInput = startCol.createEl('input', { cls: 'mq-ad-modal-input', attr: { type: 'date' } });
		(startInput).value = ed ? (ed.startDate || getToday()) : getToday();

		const endCol = row.createDiv({ cls: 'mq-ad-modal-col' });
		endCol.createEl('label', { cls: 'mq-ad-modal-label', text: '结束日期' });
		const endInput = endCol.createEl('input', { cls: 'mq-ad-modal-input', attr: { type: 'date' } });
		if (ed) (endInput).value = ed.endDate || '';
		// Keep manual YYYY-MM-DD entry, while explicitly opening the native calendar
		// when the field is clicked in Obsidian's embedded Chromium view.
		for (const input of [startInput, endInput]) {
			input.addEventListener('click', () => {
				const picker = input as HTMLInputElement & { showPicker?: () => void };
				try { picker.showPicker?.(); } catch { /* browser may require a trusted event */ }
			});
		}

		contentEl.createEl('label', { cls: 'mq-ad-modal-label', text: '项目描述' });
		const descArea = contentEl.createEl('textarea', {
			cls: 'mq-ad-modal-input',
			attr: { rows: '3', placeholder: '简要描述项目目标和范围…' },
		});
		if (ed) (descArea).value = ed.description;

		// Both project types have a stage pipeline. Long-term projects use the
		// fixed lifecycle 立项 → 迭代 → 完结.
		const configuredStages = this.opts.stages || ['立项', '规划', '开发', '测试', '上线'];
		const stageField = contentEl.createDiv({ cls: 'mq-ad-modal-field' });
		stageField.createEl('label', { cls: 'mq-ad-modal-label', text: '项目阶段' });
		const stageWrap = stageField.createDiv({ cls: 'mq-ad-modal-row' });
		const stageSelect = stageWrap.createEl('select', { cls: 'mq-ad-modal-input' });
		const populateStages = (): void => {
			const stages = isLongTermProject(this.selectedType) ? LONG_TERM_STAGES : configuredStages;
			stageSelect.empty();
			stages.forEach((label, i) => stageSelect.createEl('option', { value: String(i), text: label }));
			this.selectedStage = Math.max(0, Math.min(this.selectedStage, stages.length - 1));
			stageSelect.value = String(this.selectedStage);
		};
		populateStages();
		stageSelect.addEventListener('change', () => {
			this.selectedStage = parseInt(stageSelect.value) || 0;
		});
		stageField.style.display = '';

		const btns = contentEl.createDiv({ cls: 'mq-ad-modal-btns' });
		btns.createEl('button', { cls: 'mq-ad-modal-btn', text: UI_TEXT.cancel })
			.addEventListener('click', () => this.close());
		btns.createEl('button', { cls: 'mq-ad-modal-btn mq-ad-modal-btn--primary', text: this.isEdit ? UI_TEXT.save : '创建项目' })
			.addEventListener('click', () => {
				const name = String((nameInput).value || '').trim();
				if (!name) { (nameInput).focus(); return; }
				this.opts.onSave({
					name,
					color: this.selectedColor,
					startDate: String((startInput).value || getToday()),
					endDate: String((endInput).value || ''),
					description: String((descArea).value || '').trim(),
					stage: this.selectedStage,
					type: this.selectedType,
				});
				this.close();
			});

		if (!this.isEdit) (nameInput).focus();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
