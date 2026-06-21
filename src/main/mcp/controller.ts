import type { McpStatusResponse, SettingsSnapshot } from "@shared/ipc/contracts";
import { LocalMcpServer } from "./server";
import { KeychainMcpCredentialAdapter } from "./keychainCredentials";
import { removeMcpRuntimeFile, writeMcpRuntimeFile } from "./runtimeFile";
import type { McpToolRegistry } from "./toolRegistry";
import type { McpPermissionMode } from "./types";

export interface LocalMcpServerControllerOptions {
  credentialAdapter: KeychainMcpCredentialAdapter;
  toolRegistry: McpToolRegistry;
  getSettings: () => SettingsSnapshot;
  onPortAssigned?: (port: number) => void;
  runtimeFilePath?: string;
}

export class LocalMcpServerController {
  private readonly server: LocalMcpServer;
  private runningPort: number | undefined;
  private lastError: string | undefined;

  constructor(private readonly options: LocalMcpServerControllerOptions) {
    this.server = new LocalMcpServer({
      credentialAdapter: options.credentialAdapter,
      permissionProvider: {
        getMode: () => this.options.getSettings().mcpPermissionMode as McpPermissionMode
      },
      toolRegistry: options.toolRegistry
    });
  }

  async applySettings(settings: SettingsSnapshot): Promise<void> {
    if (!settings.mcpEnabled) {
      await this.stop();
      this.lastError = undefined;
      return;
    }

    await this.start(settings.mcpPort);
  }

  async start(port: number): Promise<void> {
    try {
      await this.options.credentialAdapter.loadBearerToken();
      const runningPort = await this.server.start(port);
      this.runningPort = runningPort;
      this.lastError = undefined;
      this.options.onPortAssigned?.(runningPort);
      this.writeRuntimeFile(runningPort);
    } catch (error) {
      this.runningPort = undefined;
      this.removeRuntimeFile();
      this.lastError = error instanceof Error ? error.message : "MCP loopback failed to start.";
    }
  }

  async stop(): Promise<void> {
    await this.server.stop();
    this.runningPort = undefined;
    this.removeRuntimeFile();
  }

  async resetToken(): Promise<void> {
    await this.options.credentialAdapter.resetBearerToken();

    if (this.runningPort !== undefined) {
      const settings = this.options.getSettings();
      await this.stop();
      await this.start(settings.mcpPort);
    }
  }

  async status(base: McpStatusResponse): Promise<McpStatusResponse> {
    let configured = false;

    try {
      configured = await this.options.credentialAdapter.isConfigured();
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : "MCP credential status is unavailable.";
    }

    return {
      ...base,
      running: this.runningPort !== undefined,
      port: this.runningPort ?? base.port,
      tokenState: base.tokenState === "rotated" ? "rotated" : configured ? "configured" : "not_configured",
      ...(this.runningPort === undefined ? {} : { url: "http://127.0.0.1" })
    };
  }

  diagnosticsMessage(): string | undefined {
    return this.lastError;
  }

  async dispose(): Promise<void> {
    await this.stop();
  }

  private writeRuntimeFile(port: number): void {
    if (!this.options.runtimeFilePath) {
      return;
    }

    try {
      writeMcpRuntimeFile(this.options.runtimeFilePath, port);
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : "MCP runtime discovery file could not be written.";
    }
  }

  private removeRuntimeFile(): void {
    if (!this.options.runtimeFilePath) {
      return;
    }

    try {
      removeMcpRuntimeFile(this.options.runtimeFilePath);
    } catch {
      // best effort; stale files are handled by the CLI pid check
    }
  }
}
