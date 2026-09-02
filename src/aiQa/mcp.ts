import type { AiQaMcpServer } from '../settings';

export interface McpTool { name: string; description?: string; inputSchema?: Record<string, unknown>; }

/** Minimal MCP JSON-RPC client for user-configured streamable HTTP servers. */
export class AiQaMcpClient {
  constructor(private readonly server: AiQaMcpServer) {}
  async listTools(): Promise<McpTool[]> {
    const result = await this.request('tools/list', {});
    const tools = (result as { tools?: McpTool[] }).tools;
    return Array.isArray(tools) ? tools.filter((tool) => typeof tool.name === 'string') : [];
  }
  async callTool(name: string, argumentsValue: Record<string, unknown>): Promise<unknown> { return this.request('tools/call', { name, arguments: argumentsValue }); }
  private async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (this.server.transport !== 'streamable-http' || !this.server.url) throw new Error('当前仅支持配置好的 Streamable HTTP MCP 服务');
    const response = await fetch(this.server.url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: crypto.randomUUID(), method, params }) });
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
}
