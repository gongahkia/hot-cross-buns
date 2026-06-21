import type {
  AgentActionApplyRequest,
  AgentActionApplyResponse,
  AgentActionListRequest,
  AgentActionRejectRequest,
  AgentActionRejectResponse
} from "@shared/ipc/contracts";
import type { LocalAgentRepository } from "../data/localRepositories";
import type { McpToolRegistry } from "../mcp/toolRegistry";
import type { AgentActionDomainService } from "./domainInterfaces";

export function createSqliteAgentDomainService(
  repository: LocalAgentRepository,
  toolRegistry?: McpToolRegistry
): AgentActionDomainService {
  return {
    listActions: (request: AgentActionListRequest) => repository.list(request),
    applyAction: async (request: AgentActionApplyRequest): Promise<AgentActionApplyResponse> => {
      const action = repository.requirePending(request.id);
      if (!toolRegistry) {
        repository.markFailed(request.id, "MCP tool registry is unavailable.");
        return { action: repository.requireSummary(request.id) };
      }
      const result = await toolRegistry.callTool(
        action.toolName,
        {
          ...action.argumentsObject,
          dryRun: false,
          confirmationId: action.id
        },
        {
          permissionMode: action.permissionMode,
          credentialRevision: action.credentialRevision,
          clientKey: action.clientKey,
          now: new Date()
        }
      );
      return { action: repository.requireSummary(request.id), result };
    },
    rejectAction: (request: AgentActionRejectRequest): AgentActionRejectResponse => ({
      action: repository.reject(request.id)
    }),
    clearExpired: () => ({ cleared: repository.clearExpired() })
  };
}
