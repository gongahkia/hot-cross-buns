export type DomainJsonValue = string | number | boolean | null | DomainJsonObject | DomainJsonValue[];
export interface DomainJsonObject { [key: string]: DomainJsonValue; }

export interface NativeDomainService {
  dispose(): void;
}

export interface WebhookDomainService {
  emit(topic: string, payload: DomainJsonObject): void | Promise<void>;
}
