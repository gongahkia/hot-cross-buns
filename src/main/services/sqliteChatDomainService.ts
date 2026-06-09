import type {
  ChatClearRequest,
  ChatListMessagesRequest,
  ChatListSessionsRequest,
  ChatSendRequest
} from "@shared/ipc/contracts";
import type {
  LocalChatRepository,
  LocalPlannerRepository,
  LocalSettingsRepository
} from "../data/localRepositories";
import type { ChatDomainService } from "./domainInterfaces";

export function createSqliteChatDomainService(
  chatRepository: LocalChatRepository,
  plannerRepository: LocalPlannerRepository,
  settingsRepository: LocalSettingsRepository
): ChatDomainService {
  return {
    listSessions: (request: ChatListSessionsRequest) => chatRepository.listSessions(request),
    listMessages: (request: ChatListMessagesRequest) => chatRepository.listMessages(request),
    send: (request: ChatSendRequest) => {
      const context = plannerRepository.search({
        query: request.message,
        mode: settingsRepository.get().semanticSearchEnabled ? "hybrid" : "lexical",
        limit: 8
      });
      return chatRepository.send(
        request,
        settingsRepository.get(),
        context.items.map((item) => `[${item.domain}] ${item.title}: ${item.snippet ?? ""}`).join("\n")
      );
    },
    clear: (request: ChatClearRequest) => chatRepository.clear(request),
    providerHealth: () => chatRepository.providerHealth(settingsRepository.get())
  };
}
