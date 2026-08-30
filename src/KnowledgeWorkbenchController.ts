import type { KnowledgeWorkbenchSettings } from './settings';

type NodeChild = {
	kill(signal?: string): void;
	stdout?: { on(event: string, cb: (chunk: unknown) => void): void };
	stderr?: { on(event: string, cb: (chunk: unknown) => void): void };
	on?(event: string, cb: (...args: unknown[]) => void): void;
};

type NodeRequire = (id: string) => any;

function getNodeRequire(): NodeRequire | null {
	try {
		return Function('return typeof require === "function" ? require : null')() as NodeRequire | null;
	} catch {
		return null;
	}
}

function getNodeProcessEnv(): Record<string, string | undefined> {
	const nodeGlobal = globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } };
	return { ...(nodeGlobal.process?.env ?? {}) };
}

export class KnowledgeWorkbenchController {
	private child: NodeChild | null = null;
	private starting: Promise<boolean> | null = null;
	private lastError = '';

	constructor(
		private readonly getSettings: () => KnowledgeWorkbenchSettings,
		private readonly onLog?: (message: string) => void,
		private readonly onSettingsChanged?: () => void | Promise<void>,
	) {}

	get error(): string { return this.lastError; }

	getUrl(page = 'dashboard'): string {
		const s = this.getSettings();
		return `http://${s.host || '127.0.0.1'}:${s.port || 5173}/#/${encodeURIComponent(page)}`;
	}

	private runtimePaths(): { serverPath: string; configPath: string; runtimeDir: string } {
		const req = getNodeRequire();
		if (!req) throw new Error('当前 Obsidian 环境无法访问 Node.js 模块');
		const path = req('path') as { join(...parts: string[]): string };
		const root = this.getSettings().serverRoot.trim();
		const runtimeDir = path.join(root, 'runtime');
		return {
			serverPath: path.join(runtimeDir, '工作台', 'server.js'),
			configPath: path.join(runtimeDir, 'knowledge-workbench.config.json'),
			runtimeDir,
		};
	}

	private writeRuntimeConfig(): void {
		const req = getNodeRequire();
		if (!req) throw new Error('当前 Obsidian 环境无法写入 Knowledge Workbench 配置');
		const fs = req('fs') as { existsSync(path: string): boolean; readFileSync(path: string, encoding: string): string; mkdirSync(path: string, opts?: { recursive?: boolean }): void; writeFileSync(path: string, data: string, encoding: string): void };
		const paths = this.runtimePaths();
		const s = this.getSettings();
		fs.mkdirSync(paths.runtimeDir, { recursive: true });
		let existing: Record<string, unknown> = {};
		try {
			if (fs.existsSync(paths.configPath)) existing = JSON.parse(fs.readFileSync(paths.configPath, 'utf-8')) as Record<string, unknown>;
		} catch { /* 损坏配置由下面的受控默认值覆盖 */ }
		fs.writeFileSync(paths.configPath, JSON.stringify({ ...existing,
			vaultRoot: s.vaultRoot,
			host: s.host || '127.0.0.1',
			port: s.port || 5173,
			rawRoots: ['原始素材/外部', '原始素材/热点', '原始素材/文章'],
			extraRawScanPaths: (s.extraRawScanPaths || []).filter((v) => v.trim()),
			dailyRoot: '日常',
			outputRoot: '输出',
			knowledgeRoot: '知识层',
			bookshelfRoot: '书架',
			aiServiceAutomationId: typeof existing.aiServiceAutomationId === 'string' ? existing.aiServiceAutomationId : '',
		}, null, 2) + '\n', 'utf-8');
	}

	private async isHealthy(): Promise<boolean> {
		const s = this.getSettings();
		try {
			const ctl = new AbortController();
			const timer = window.setTimeout(() => ctl.abort(), 900);
			const response = await fetch(`http://${s.host || '127.0.0.1'}:${s.port || 5173}/api/stats`, { signal: ctl.signal });
			window.clearTimeout(timer);
			if (!response.ok) return false;
			/* 不能只看 HTTP 200：5173 可能被别的本地服务占用。 */
			/* 不能只看 HTTP 200：5173 可能被别的本地服务占用。工作台 API 明确返回 JSON。 */
			return (response.headers.get('content-type') || '').includes('application/json');
		} catch {
			return false;
		}
	}

	private async isPortAvailable(port: number): Promise<boolean> {
		const req = getNodeRequire();
		if (!req) return false;
		/* macOS 上 wildcard 监听（0.0.0.0）可能与 127.0.0.1 分别 bind 成功；
		 * 先用 lsof 检查所有地址，避免选到看似可用但实际已被占用的端口。 */
		try {
			const cp = req('child_process') as { execFileSync(command: string, args: string[], opts: Record<string, unknown>): Buffer | string };
			const output = cp.execFileSync('/usr/sbin/lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
			if (String(output).trim()) return false;
		} catch { /* lsof 无输出时返回非零，继续使用 net 探测 */ }
		const net = req('net') as { createServer(): { once(event: string, cb: () => void): void; listen(port: number, host: string, cb: () => void): void; close(cb: () => void): void } };
		const host = this.getSettings().host || '127.0.0.1';
		return new Promise((resolve) => {
			const server = net.createServer();
			let settled = false;
			const finish = (available: boolean): void => {
				if (settled) return;
				settled = true;
				resolve(available);
			};
			server.once('error', () => finish(false));
			server.listen(port, host, () => server.close(() => finish(true)));
		});
	}

	private async selectPort(): Promise<number> {
		const s = this.getSettings();
		const preferred = Number(s.port) || 5173;
		if (await this.isPortAvailable(preferred)) return preferred;
		for (let port = 5174; port <= 5180; port += 1) {
			if (await this.isPortAvailable(port)) {
				this.onLog?.(`端口 ${preferred} 已被占用，切换到 ${port}`);
				s.port = port;
				await this.onSettingsChanged?.();
				return port;
			}
		}
		throw new Error(`端口 ${preferred} 已被占用，且 5174～5180 均不可用`);
	}

	private async waitForHealth(timeoutMs = 12000, failed?: () => boolean): Promise<boolean> {
		const start = Date.now();
		while (Date.now() - start < timeoutMs) {
			if (await this.isHealthy()) return true;
			if (failed?.()) return false;
			await new Promise((resolve) => window.setTimeout(resolve, 250));
		}
		return false;
	}

	private resolveNodeCommand(): string {
		const req = getNodeRequire();
		if (!req) throw new Error('无法启动本地服务：Node.js 模块不可用');
		const fs = req('fs') as { existsSync(path: string): boolean };
		const path = req('path') as { isAbsolute(value: string): boolean };
		const requested = this.getSettings().nodePath.trim() || 'node';
		if (path.isAbsolute(requested)) {
			if (fs.existsSync(requested)) return requested;
			throw new Error(`Node 路径不存在：${requested}`);
		}
		const env = getNodeProcessEnv();
		const pathEntries = String(env.PATH || '').split(':').filter(Boolean);
		for (const dir of pathEntries) {
			const candidate = `${dir.replace(/\/$/, '')}/${requested}`;
			if (fs.existsSync(candidate)) return candidate;
		}
		/* Obsidian 从 Finder 启动时常常没有继承 shell PATH，补查 macOS 常见 Node 安装位置。 */
		for (const candidate of ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node']) {
			if (fs.existsSync(candidate)) return candidate;
		}
		throw new Error(`找不到 Node 命令：${requested}。请在设置中填写 Node 的绝对路径。`);
	}

	async ensureStarted(): Promise<boolean> {
		const s = this.getSettings();
		if (!s.enabled) return false;
		if (this.starting) return this.starting;
		this.starting = (async () => {
			this.lastError = '';
			if (await this.isHealthy()) return true;
			const req = getNodeRequire();
			if (!req) throw new Error('无法启动本地服务：Node.js 模块不可用');
			const fs = req('fs') as { existsSync(path: string): boolean };
			const paths = this.runtimePaths();
			if (!fs.existsSync(paths.serverPath)) throw new Error(`找不到服务文件：${paths.serverPath}`);
			await this.selectPort();
			this.writeRuntimeConfig();
			const cp = req('child_process') as { spawn(command: string, args: string[], opts: Record<string, unknown>): NodeChild };
			const nodeCommand = this.resolveNodeCommand();
			this.onLog?.(`使用 Node：${nodeCommand}`);
			const env = getNodeProcessEnv();
			env.WB_CONFIG_PATH = paths.configPath;
			env.WB_KB_ROOT = s.vaultRoot;
			env.WB_HOST = s.host || '127.0.0.1';
			env.PORT = String(s.port || 5173);
			let spawnError: Error | null = null;
			let processExit: { code?: number | null; signal?: string | null } | null = null;
			let stderrTail = '';
			this.child = cp.spawn(nodeCommand, [paths.serverPath], {
				cwd: paths.runtimeDir,
				env,
				stdio: ['ignore', 'pipe', 'pipe'],
			});
			this.child.stdout?.on('data', (chunk) => this.onLog?.(String(chunk).trim()));
			this.child.stderr?.on('data', (chunk) => {
				const message = String(chunk).trim();
				if (message) stderrTail = `${stderrTail}\n${message}`.slice(-1200);
				this.onLog?.(message);
			});
			this.child.on?.('error', (error) => {
				spawnError = error instanceof Error ? error : new Error(String(error));
				this.lastError = `Node 服务进程启动失败：${spawnError.message}`;
				this.onLog?.(this.lastError);
			});
			this.child.on?.('exit', (code, signal) => {
				processExit = { code: typeof code === 'number' ? code : null, signal: typeof signal === 'string' ? signal : null };
				this.child = null;
			});
			if (!(await this.waitForHealth(30000, () => spawnError !== null || processExit !== null))) {
				/* 最后再检查一次，覆盖服务刚好在轮询窗口结束时完成监听的竞态。 */
				if (await this.isHealthy()) return true;
				if (spawnError) throw new Error(`服务进程启动失败：${spawnError.message}`);
				if (processExit) {
					/* 启动竞态：已有工作台进程刚好在本次检查之后开始监听，
					 * 新子进程会收到 EADDRINUSE；确认接口属于本工作台后直接复用。 */
					if (stderrTail.includes('EADDRINUSE') && await this.isHealthy()) {
						this.onLog?.(`端口 ${s.port || 5173} 已有可用知识工作台服务，复用现有进程`);
						return true;
					}
					const reason = processExit.signal ? `signal ${processExit.signal}` : `exit code ${processExit.code ?? 'unknown'}`;
					const detail = stderrTail.trim() ? `：${stderrTail.trim().slice(-800)}` : '';
					throw new Error(`服务进程已退出（${reason}）${detail}`);
				}
				throw new Error(`服务启动超时，请检查端口 ${s.port || 5173} 或 Node 路径`);
			}
			return true;
		})().catch((error) => {
			this.lastError = error instanceof Error ? error.message : String(error);
			this.onLog?.(this.lastError);
			return false;
		}).finally(() => { this.starting = null; });
		return this.starting;
	}

	async stopOwnedProcess(): Promise<void> {
		const child = this.child;
		this.child = null;
		if (!child) return;
		try { child.kill('SIGTERM'); } catch { /* 已退出 */ }
	}
}
