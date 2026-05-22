import { createAppSqliteConnection, type SqliteConnection } from "../data/sqliteConnection";
import { McpToolRegistry } from "../mcp/toolRegistry";
import type { AppDomainServices } from "./domainInterfaces";
import { createPlaceholderDomainServices } from "./placeholderDomainServices";

export interface LocalDataServicePlaceholder {
  status: "not-initialized";
  createConnection: () => SqliteConnection;
}

export interface ServiceContainer {
  domain: AppDomainServices;
  localData: LocalDataServicePlaceholder;
  mcpTools: McpToolRegistry;
}

export interface ServiceContainerOptions {
  appSupportDirectory: string;
}

export function createServiceContainer(options: ServiceContainerOptions): ServiceContainer {
  const domain = createPlaceholderDomainServices();

  return {
    domain,
    localData: {
      status: "not-initialized",
      createConnection: () =>
        createAppSqliteConnection({
          appSupportDirectory: options.appSupportDirectory
        })
    },
    mcpTools: new McpToolRegistry(domain.mcpTools)
  };
}
