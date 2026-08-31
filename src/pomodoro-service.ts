import { Notice } from 'obsidian';
import type Dashboard from './main';
import type { PomodoroRecord, PomodoroSession, PomodoroSettings, PomodoroTag } from './settings';

export type PomodoroPhase = 'work' | 'short-break' | 'long-break';
export type PomodoroStatus = 'idle' | 'running' | 'paused';
export interface PomodoroState { phase: PomodoroPhase; status: PomodoroStatus; remainingSeconds: number; totalSeconds: number; completedWorkSessions: number; }

const DEFAULTS: PomodoroSettings = {
	pomodoroWorkMinutes: 25, pomodoroShortBreakMinutes: 5, pomodoroLongBreakMinutes: 15,
	pomodoroLongBreakInterval: 4, pomodoroDailyGoal: 8, pomodoroAutoStartBreak: true, pomodoroSoundEnabled: true,
};

/** Timer and history owned solely by this dashboard's data.json. */
export class PomodoroService {
	private phase: PomodoroPhase = 'work';
	private status: PomodoroStatus = 'idle';
	private startedAt = 0;
	private remainingSeconds = 0;
	private completedWorkSessions = 0;
	private focusedSeconds = 0;
	private focusResumedAt = 0;
	private interruptions = 0;
	private pendingBreak: { record: PomodoroRecord; startedAt: number } | null = null;
	private tickTimer: number | null = null;
	private tickCallback: (() => void) | null = null;
	private completeCallback: (() => void) | null = null;

	constructor(private plugin: Dashboard) { this.reset(); }

	private get config(): PomodoroSettings { return { ...DEFAULTS, ...(this.plugin.settings.pomodoro ?? {}) }; }
	private durationFor(phase: PomodoroPhase): number {
		const c = this.config;
		return (phase === 'work' ? c.pomodoroWorkMinutes : phase === 'short-break' ? c.pomodoroShortBreakMinutes : c.pomodoroLongBreakMinutes) * 60;
	}
	private get sessions(): PomodoroSession[] { return this.plugin.settings.pomodoroSessions ?? []; }

	getState(): PomodoroState {
		const remaining = this.status === 'running'
			? Math.max(0, Math.ceil(this.remainingSeconds - (Date.now() - this.startedAt) / 1000))
			: this.remainingSeconds;
		return { phase: this.phase, status: this.status, remainingSeconds: remaining, totalSeconds: this.durationFor(this.phase), completedWorkSessions: this.completedWorkSessions };
	}
	start(): void {
		if (this.status === 'running') return;
		this.remainingSeconds ||= this.durationFor(this.phase);
		this.startedAt = Date.now();
		if (this.phase === 'work') { if (this.status === 'idle') { this.focusedSeconds = 0; this.interruptions = 0; } this.focusResumedAt = this.startedAt; }
		this.status = 'running'; this.ensureTickTimer(); this.tickCallback?.();
	}
	pause(): void {
		if (this.status !== 'running') return;
		this.remainingSeconds = this.getState().remainingSeconds;
		if (this.phase === 'work' && this.focusResumedAt) { this.focusedSeconds += (Date.now() - this.focusResumedAt) / 1000; this.focusResumedAt = 0; this.interruptions++; }
		this.status = 'paused'; this.clearTickTimer(); this.tickCallback?.();
	}
	reset(): void {
		this.clearTickTimer(); this.settlePendingBreak(false); this.phase = 'work'; this.status = 'idle'; this.remainingSeconds = this.durationFor('work'); this.completedWorkSessions = 0; this.focusedSeconds = 0; this.focusResumedAt = 0; this.interruptions = 0; this.tickCallback?.();
	}
	skip(): void { this.moveToNextPhase(); }
	setOnTick(callback: (() => void) | null): void { this.tickCallback = callback; }
	setOnComplete(callback: (() => void) | null): void { this.completeCallback = callback; }
	destroy(): void { this.clearTickTimer(); this.tickCallback = null; this.completeCallback = null; }

	getActivity(): string { return this.plugin.settings.pomodoroActivity ?? ''; }
	setActivity(activity: string): void { const name = activity.trim(); this.plugin.settings.pomodoroActivity = name; this.upsertTag(name); void this.plugin.saveSettings(); }
	getTags(): PomodoroTag[] { return [...(this.plugin.settings.pomodoroTags ?? [])].sort((a, b) => a.pinned === b.pinned ? a.name.localeCompare(b.name) : a.pinned ? -1 : 1); }
	getRecentActivities(limit = 6): string[] { const pinned = this.getTags().filter((tag) => tag.pinned).map((tag) => tag.name); const seen = new Set(pinned); const recent = this.getRecentRecords().map((record) => record.activity).filter((name) => !!name && !seen.has(name) && (seen.add(name), true)); return [...pinned, ...recent].slice(0, limit); }
	async setTagPinned(name: string, pinned: boolean): Promise<void> { this.upsertTag(name); this.plugin.settings.pomodoroTags = (this.plugin.settings.pomodoroTags ?? []).map((tag) => tag.name === name ? { ...tag, pinned } : tag); await this.plugin.saveSettings(); }
	async renameTag(oldName: string, newName: string): Promise<boolean> { const name = newName.trim(); if (!name || oldName === name || this.getTags().some((tag) => tag.name === name)) return false; this.plugin.settings.pomodoroTags = (this.plugin.settings.pomodoroTags ?? []).map((tag) => tag.name === oldName ? { ...tag, name } : tag); this.plugin.settings.pomodoroActivity = this.getActivity() === oldName ? name : this.getActivity(); this.replaceActivity(oldName, name); await this.plugin.saveSettings(); return true; }
	async deleteTag(name: string): Promise<void> { this.plugin.settings.pomodoroTags = (this.plugin.settings.pomodoroTags ?? []).filter((tag) => tag.name !== name); this.plugin.settings.pomodoroActivity = this.getActivity() === name ? '' : this.getActivity(); this.replaceActivity(name, '专注'); await this.plugin.saveSettings(); }
	async mergeTags(source: string, destination: string): Promise<boolean> { if (source === destination || !this.getTags().some((tag) => tag.name === destination)) return false; this.plugin.settings.pomodoroTags = (this.plugin.settings.pomodoroTags ?? []).filter((tag) => tag.name !== source); this.plugin.settings.pomodoroActivity = this.getActivity() === source ? destination : this.getActivity(); this.replaceActivity(source, destination); await this.plugin.saveSettings(); return true; }
	getTodayCount(): number { return this.sessions.find((s) => s.date === dateKey(new Date()))?.completed ?? 0; }
	getTodayGoal(): { completed: number; goal: number } { return { completed: this.getTodayCount(), goal: Math.max(1, this.config.pomodoroDailyGoal) }; }
	getTotalFocusMinutes(): number { return this.sessions.reduce((total, session) => total + sessionMinutes(session, this.config.pomodoroWorkMinutes), 0); }
	getTodayFocusMinutes(): number { const session = this.sessions.find((s) => s.date === dateKey(new Date())); return session ? sessionMinutes(session, this.config.pomodoroWorkMinutes) : 0; }
	getTodayInterruptions(): number { return this.getRecordsForDate(dateKey(new Date())).reduce((sum, record) => sum + (record.interruptions ?? 0), 0); }
	getBreakAdherence(days = 30): number | null { const from = new Date(); from.setDate(from.getDate() - days); const records = this.sessions.filter((session) => session.date >= dateKey(from)).flatMap((session) => session.records ?? []).filter((record) => record.breakCompleted !== undefined); return records.length ? Math.round(records.filter((record) => record.breakCompleted).length / records.length * 100) : null; }
	getTodayScore(): number { const { completed, goal } = this.getTodayGoal(); return Math.max(0, Math.round(Math.min(1, completed / goal) * 100 - Math.min(40, this.getTodayInterruptions() * 5))); }
	getRecentRecords(limit = 60): PomodoroRecord[] { return this.sessions.flatMap((s) => s.records ?? []).sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, limit); }
	getRecordsForDate(date: string): PomodoroRecord[] { return [...(this.sessions.find((session) => session.date === date)?.records ?? [])].sort((a, b) => a.timestamp.localeCompare(b.timestamp)); }
	getActivityBreakdown(from?: string): Map<string, number> {
		const result = new Map<string, number>();
		for (const session of this.sessions) {
			if (from && session.date < from) continue;
			for (const record of session.records ?? []) result.set(record.activity || '默认专注', (result.get(record.activity || '默认专注') ?? 0) + record.duration);
		}
		return result;
	}
	getDailyMinutes(days: number): { date: string; minutes: number }[] {
		const sessionByDate = new Map(this.sessions.map((s) => [s.date, s]));
		return Array.from({ length: days }, (_, index) => {
			const date = new Date(); date.setDate(date.getDate() - (days - index - 1)); const key = dateKey(date);
			const session = sessionByDate.get(key); return { date: key, minutes: session ? sessionMinutes(session, this.config.pomodoroWorkMinutes) : 0 };
		});
	}
	getRecent7AvgMinutes(): number { const data = this.getDailyMinutes(7); return Math.round(data.reduce((sum, day) => sum + day.minutes, 0) / data.length); }
	getStreak(): number {
		const active = new Set(this.sessions.filter((s) => s.completed > 0).map((s) => s.date)); let date = new Date();
		if (!active.has(dateKey(date))) date.setDate(date.getDate() - 1);
		let streak = 0; while (active.has(dateKey(date))) { streak++; date.setDate(date.getDate() - 1); } return streak;
	}
	getRangeFocusMinutes(range: 'day' | 'week' | 'month' | 'year' | 'all'): number {
		if (range === 'all') return this.getTotalFocusMinutes(); const now = new Date();
		if (range === 'week') now.setDate(now.getDate() - ((now.getDay() + 6) % 7));
		if (range === 'month') now.setDate(1);
		if (range === 'year') { now.setMonth(0); now.setDate(1); }
		const from = dateKey(now); return this.sessions.filter((s) => s.date >= from).reduce((sum, session) => sum + sessionMinutes(session, this.config.pomodoroWorkMinutes), 0);
	}

	private ensureTickTimer(): void { if (this.tickTimer === null) this.tickTimer = window.setInterval(() => this.tick(), 1000); }
	private upsertTag(name: string): void { if (!name || this.getTags().some((tag) => tag.name === name)) return; this.plugin.settings.pomodoroTags = [...(this.plugin.settings.pomodoroTags ?? []), { name, pinned: false }]; }
	private replaceActivity(from: string, to: string): void { this.plugin.settings.pomodoroSessions = this.sessions.map((session) => ({ ...session, records: (session.records ?? []).map((record) => record.activity === from ? { ...record, activity: to } : record) })); }
	private clearTickTimer(): void { if (this.tickTimer !== null) { window.clearInterval(this.tickTimer); this.tickTimer = null; } }
	private tick(): void { if (this.status !== 'running') return; if (this.getState().remainingSeconds <= 0) this.completePhase(); else this.tickCallback?.(); }
	private completePhase(): void {
		if (this.phase === 'work') { this.completedWorkSessions++; this.recordCompletedWork(); new Notice('专注完成，开始休息。'); }
		else { this.settlePendingBreak(true); new Notice('休息结束，准备下一轮专注。'); }
		this.playSound(); this.completeCallback?.(); this.moveToNextPhase();
	}
	private moveToNextPhase(): void {
		const c = this.config;
		if (this.phase !== 'work') this.settlePendingBreak(false);
		if (this.phase === 'work') this.phase = this.completedWorkSessions >= c.pomodoroLongBreakInterval ? 'long-break' : 'short-break';
		else this.phase = 'work';
		if (this.phase === 'long-break') this.completedWorkSessions = 0;
		this.remainingSeconds = this.durationFor(this.phase); this.focusedSeconds = 0; this.focusResumedAt = 0; this.interruptions = 0;
		this.status = c.pomodoroAutoStartBreak ? 'running' : 'paused'; this.startedAt = this.status === 'running' ? Date.now() : 0;
		if (this.status === 'running') this.ensureTickTimer(); else this.clearTickTimer(); this.tickCallback?.();
	}
	private recordCompletedWork(): void {
		const date = dateKey(new Date()); const elapsed = this.focusedSeconds + (this.focusResumedAt ? (Date.now() - this.focusResumedAt) / 1000 : 0); const record: PomodoroRecord = { timestamp: new Date().toISOString(), activity: this.getActivity() || '默认专注', duration: Math.max(1, Math.round(elapsed / 60)), interruptions: this.interruptions };
		const found = this.sessions.find((session) => session.date === date);
		this.plugin.settings.pomodoroSessions = found
			? this.sessions.map((session) => session.date === date ? { ...session, completed: session.completed + 1, records: [...(session.records ?? []), record] } : session)
			: [...this.sessions, { date, completed: 1, records: [record] }];
		this.pendingBreak = { record, startedAt: Date.now() }; void this.plugin.saveSettings();
	}
	private settlePendingBreak(completed: boolean): void { const pending = this.pendingBreak; this.pendingBreak = null; if (!pending) return; pending.record.breakCompleted = completed; pending.record.breakMinutes = completed ? Math.max(1, Math.round((Date.now() - pending.startedAt) / 60000)) : 0; const date = pending.record.timestamp.slice(0, 10); this.plugin.settings.pomodoroSessions = this.sessions.map((session) => session.date === date ? { ...session, records: (session.records ?? []).map((record) => record.timestamp === pending.record.timestamp ? { ...record, ...pending.record } : record) } : session); void this.plugin.saveSettings(); }
	private playSound(): void {
		if (!this.config.pomodoroSoundEnabled) return;
		try { const context = new AudioContext(); const oscillator = context.createOscillator(); const gain = context.createGain(); oscillator.connect(gain); gain.connect(context.destination); oscillator.frequency.value = 800; gain.gain.setValueAtTime(0.18, context.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.5); oscillator.start(); oscillator.stop(context.currentTime + 0.5); oscillator.onended = () => context.close(); } catch { /* unavailable */ }
	}
}

function sessionMinutes(session: PomodoroSession, fallback: number): number { return session.records?.length ? session.records.reduce((sum, record) => sum + record.duration, 0) : session.completed * fallback; }
function dateKey(date: Date): string { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }

/** Same deterministic color allocation used by the Apex activity chips/charts. */
export function activityColor(activity: string): string {
	const colors = ['#e67e22', '#3498db', '#9b59b6', '#2ecc71', '#e74c3c', '#1abc9c', '#f1c40f', '#e84393'];
	let hash = 0;
	for (let index = 0; index < activity.length; index++) hash = (hash * 31 + activity.charCodeAt(index)) | 0;
	return colors[Math.abs(hash) % colors.length]!;
}
