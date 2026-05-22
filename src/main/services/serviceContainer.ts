import { createAppSqliteConnection, type SqliteConnection } from "../data/sqliteConnection";

export interface LocalDataServicePlaceholder {
  status: "not-initialized";
  createConnection: () => SqliteConnection;
}

export interface ServiceContainer {
  localData: LocalDataServicePlaceholder;
}

export interface ServiceContainerOptions {
  appSupportDirectory: string;
}

export function createServiceContainer(options: ServiceContainerOptions): ServiceContainer {
  return {
    localData: {
      status: "not-initialized",
      createConnection: () =>
        createAppSqliteConnection({
          appSupportDirectory: options.appSupportDirectory
        })
    }
  };
}
