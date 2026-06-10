import type {
  WebhookDeleteRequest,
  WebhookListRequest,
  WebhookTestRequest,
  WebhookUpsertRequest
} from "@shared/ipc/contracts";
import type { LocalSettingsRepository, LocalWebhookRepository } from "../data/localRepositories";
import type { DomainJsonObject, WebhookDomainService } from "./domainInterfaces";

export function createSqliteWebhookDomainService(
  repository: LocalWebhookRepository,
  settingsRepository: LocalSettingsRepository
): WebhookDomainService {
  return {
    list: (request: WebhookListRequest) => repository.list(request),
    upsert: (request: WebhookUpsertRequest) => repository.upsert(request),
    delete: (request: WebhookDeleteRequest) => repository.delete(request),
    test: (request: WebhookTestRequest) => repository.test(request.id),
    emit: (event, payload: DomainJsonObject) =>
      repository.emit({ event, payload }, settingsRepository.get().webhooksEnabled),
    drainDue: async () => {
      if (settingsRepository.get().webhooksEnabled) {
        await repository.deliverDue();
      }
    }
  };
}
