export const HCB_MCP_RUNTIME_FILE_NAME = "mcp-runtime.json";

export interface HcbMcpRuntimeFile {
  running: boolean;
  url: "http://127.0.0.1";
  port: number;
  pid: number;
  updatedAt: string;
}
