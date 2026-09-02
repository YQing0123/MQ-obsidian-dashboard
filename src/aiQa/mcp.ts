import type { AiQaMcpServer } from '../settings';

export interface McpTool { name: string; description?: string; inputSchema?: Record<string, unknown>; }

/** Minimal MCP JSON-RPC client for user-configured streamable HTTP servers. */
export class AiQaMcpClient {
  constructor(private readonly server: AiQaMcpServer, private readonly authHeaders: Record<string, string> = {}) {}
  async listTools(): Promise<McpTool[]> {
    const result = await this.request('tools/list', {});
    const tools = (result as { tools?: McpTool[] }).tools;
    return Array.isArray(tools) ? tools.filter((tool) => typeof tool.name === 'string') : [];
  }
  async callTool(name: string, argumentsValue: Record<string, unknown>): Promise<unknown> { return this.request('tools/call', { name, arguments: argumentsValue }); }
  private async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (this.server.transport !== 'streamable-http' || !this.server.url) throw new Error('当前仅支持配置好的 Streamable HTTP MCP 服务');
    const body = JSON.stringify({ jsonrpc: '2.0', id: crypto.randomUUID(), method, params });
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(this.server.headers ?? {}), ...this.authHeaders };
    let response: Response;
    try { response = await fetch(this.server.url, { method: 'POST', headers, body }); }
    catch (error) {
      try { response = await this.nodeRequest(body, headers); }
      catch (fallbackError) { throw new Error(`${error instanceof Error ? error.message : String(error)}；Node MCP 回退失败：${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`); }
    }
    if (!response.ok) throw new Error(`MCP 请求失败 (${response.status})`);
    const raw = await response.text();
    let data: { result?: unknown; error?: { message?: string } } = {};
    try { data = JSON.parse(raw) as typeof data; } catch {
      const eventData = raw.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).find(Boolean);
      if (eventData) data = JSON.parse(eventData) as typeof data;
    }
    if (data.error) throw new Error(data.error.message || 'MCP 服务返回错误');
    return data.result;
  }
  private nodeRequest(body: string, headers: Record<string, string>): Promise<Response> {
    return new Promise((resolve, reject) => {
      try {
        const nodeRequire = typeof require === 'function' ? require : undefined; const target = new URL(this.server.url!); const client = nodeRequire?.(target.protocol === 'https:' ? 'https' : 'http');
        if (!client) return reject(new Error('当前 Obsidian 不支持 Node MCP 网络通道'));
        const request = client.request({ protocol: target.protocol, hostname: target.hostname, port: target.port || undefined, path: `${target.pathname}${target.search}`, method: 'POST', headers });
        const chunks: Buffer[] = []; request.on('response', (res: { statusCode?: number; headers?: Record<string, string | string[]>; on: Function }) => { res.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk))); res.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode ?? 0, headers: Object.fromEntries(Object.entries(res.headers ?? {}).map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : String(value)])) }))); res.on('error', reject); }); request.on('error', reject); request.write(body); request.end();
      } catch (error) { reject(error); }
    });
  }
}
