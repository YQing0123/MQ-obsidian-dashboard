import type { TaskItem, TaskStatus } from './taskParser';

export interface TaskHierarchyNode {
	task: TaskItem;
	parent: TaskItem | null;
	children: TaskItem[];
	depth: number;
}

function parentKey(task: TaskItem): string {
	return `${task.projectId}\u0000${task.parent}`;
}

/** Build a stable hierarchy from the legacy 父任务 name field. */
export function buildTaskHierarchy(tasks: TaskItem[]): Map<string, TaskHierarchyNode> {
	const nodes = new Map<string, TaskHierarchyNode>();
	const byId = new Map<string, TaskItem>();
	const byProjectName = new Map<string, TaskItem>();
	for (const task of tasks) {
		nodes.set(task.id, { task, parent: null, children: [], depth: 0 });
		byId.set(task.id, task);
		byProjectName.set(`${task.projectId}\u0000${task.content}`, task);
	}
	for (const task of tasks) {
		if (!task.parent) continue;
		const parent = byId.get(task.parent) || byProjectName.get(parentKey(task));
		if (!parent || parent.id === task.id) continue;
		const node = nodes.get(task.id);
		const parentNode = nodes.get(parent.id);
		if (!node || !parentNode) continue;
		node.parent = parent;
		parentNode.children.push(task);
	}
	const visiting = new Set<string>();
	const setDepth = (task: TaskItem, depth: number): void => {
		const node = nodes.get(task.id);
		if (!node || visiting.has(task.id)) return;
		visiting.add(task.id);
		node.depth = depth;
		for (const child of node.children) setDepth(child, depth + 1);
		visiting.delete(task.id);
	};
	for (const node of nodes.values()) if (!node.parent) setDepth(node.task, 0);
	for (const node of nodes.values()) if (node.depth === 0 && node.parent) setDepth(node.task, 1);
	return nodes;
}

/** Keep parent and descendants adjacent while preserving the caller's sort order. */
export function orderTasksByHierarchy(tasks: TaskItem[], compare: (a: TaskItem, b: TaskItem) => number): TaskItem[] {
	const hierarchy = buildTaskHierarchy(tasks);
	const roots = tasks.filter((task) => !hierarchy.get(task.id)?.parent).sort(compare);
	const ordered: TaskItem[] = [];
	const seen = new Set<string>();
	const visit = (task: TaskItem): void => {
		if (seen.has(task.id)) return;
		seen.add(task.id);
		ordered.push(task);
		const node = hierarchy.get(task.id);
		for (const child of [...(node?.children ?? [])].sort(compare)) visit(child);
	};
	for (const root of roots) visit(root);
	for (const task of [...tasks].sort(compare)) visit(task);
	return ordered;
}

/** Human-readable title for reports: parent-child, including deeper ancestry. */
export function taskDisplayTitle(task: TaskItem, tasks: TaskItem[]): string {
	const hierarchy = buildTaskHierarchy(tasks);
	const parts: string[] = [];
	let current: TaskItem | null = task;
	const seen = new Set<string>();
	while (current && !seen.has(current.id)) {
		seen.add(current.id);
		parts.unshift(current.content);
		current = hierarchy.get(current.id)?.parent ?? null;
	}
	return parts.join('-');
}

export interface TaskStatusUpdate { task: TaskItem; status: TaskStatus; }

function resolved(status: TaskStatus): boolean {
	return status === '已完成';
}

/** Calculate completion propagation without touching files. */
export function completionCascade(tasks: TaskItem[], target: TaskItem, nextStatus: TaskStatus): TaskStatusUpdate[] {
	const hierarchy = buildTaskHierarchy(tasks);
	const byId = new Map(tasks.map((task) => [task.id, task]));
	const updates = new Map<string, TaskStatus>();
	const setStatus = (task: TaskItem, status: TaskStatus): void => {
		if (task.status !== status) updates.set(task.id, status);
	};
	const targetTask = byId.get(target.id) || target;
	setStatus(targetTask, nextStatus);
	if (nextStatus === '已完成') {
		const completeChildren = (task: TaskItem): void => {
			for (const child of hierarchy.get(task.id)?.children ?? []) {
				setStatus(child, '已完成');
				completeChildren(child);
			}
		};
		completeChildren(targetTask);
	}
	let parent = hierarchy.get(targetTask.id)?.parent ?? null;
	while (parent) {
		const children = hierarchy.get(parent.id)?.children ?? [];
		const statuses = children.map((child) => updates.get(child.id) || child.status);
		if (statuses.length && statuses.every(resolved)) setStatus(parent, '已完成');
		else if (parent.status === '已完成' && nextStatus !== '已完成') setStatus(parent, '待办');
		parent = hierarchy.get(parent.id)?.parent ?? null;
	}
	return [...updates.entries()].map(([id, status]) => ({ task: byId.get(id) || target, status }));
}
