export interface LocalDataServicePlaceholder {
  status: "not-initialized";
}

export interface ServiceContainer {
  localData: LocalDataServicePlaceholder;
}

export function createServiceContainer(): ServiceContainer {
  return {
    localData: {
      status: "not-initialized"
    }
  };
}
