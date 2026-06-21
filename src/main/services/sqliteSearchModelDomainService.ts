import type {
  SearchModelDomainService
} from "./domainInterfaces";
import type {
  SearchIndexRebuildResponse,
  SearchModelMutationResponse
} from "@shared/ipc/contracts";
import type {
  LocalPlannerRepository,
  LocalSettingsRepository
} from "../data/localRepositories";

export function createSqliteSearchModelDomainService(
  plannerRepository: LocalPlannerRepository,
  settingsRepository: LocalSettingsRepository
): SearchModelDomainService {
  return {
    listModels: () => {
      const settings = settingsRepository.get();
      return {
        models: settings.semanticSearchModels,
        selectedModelId: settings.embeddingModelId,
        enabled: settings.semanticSearchEnabled
      };
    },
    installModel: (request) => {
      const now = new Date().toISOString();
      const settings = settingsRepository.get();
      const nextModels = settings.semanticSearchModels.map((model) =>
        model.id === request.modelId
          ? {
              ...model,
              installed: true,
              installState: "installed" as const,
              lastError: null,
              updatedAt: now
            }
          : model
      );
      const model = nextModels.find((candidate) => candidate.id === request.modelId);

      if (!model) {
        throw new Error("Unknown semantic model.");
      }

      settingsRepository.update({
        embeddingModelId: request.modelId,
        semanticSearchEnabled: true,
        semanticSearchModels: nextModels
      });
      return modelMutationResponse(settingsRepository, model);
    },
    uninstallModel: (request) => {
      if (request.modelId === "hcb-local-hash-384") {
        throw new Error("The built-in semantic fallback cannot be uninstalled.");
      }

      const now = new Date().toISOString();
      const settings = settingsRepository.get();
      const fallbackModelId = "hcb-local-hash-384";
      const nextModels = settings.semanticSearchModels.map((model) =>
        model.id === request.modelId
          ? {
              ...model,
              installed: false,
              installState: "not-installed" as const,
              cachePath: null,
              lastError: null,
              updatedAt: now
            }
          : model
      );
      const model = nextModels.find((candidate) => candidate.id === request.modelId);

      if (!model) {
        throw new Error("Unknown semantic model.");
      }

      settingsRepository.update({
        embeddingModelId: settings.embeddingModelId === request.modelId ? fallbackModelId : settings.embeddingModelId,
        semanticSearchEnabled: settings.embeddingModelId === request.modelId ? false : settings.semanticSearchEnabled,
        semanticSearchModels: nextModels
      });
      return modelMutationResponse(settingsRepository, model);
    },
    rebuildIndex: (request) => {
      const settings = settingsRepository.get();
      const modelId = request.modelId ?? settings.embeddingModelId;
      const model = settings.semanticSearchModels.find((candidate) => candidate.id === modelId);

      if (!model?.installed) {
        return {
          modelId,
          indexedCount: 0,
          staleCount: plannerRepository.semanticIndexStats(modelId).staleCount,
          unavailableReason: "Semantic model is not installed."
        } satisfies SearchIndexRebuildResponse;
      }

      return {
        modelId,
        ...plannerRepository.rebuildSemanticIndex(modelId)
      };
    }
  };
}

function modelMutationResponse(
  settingsRepository: LocalSettingsRepository,
  model: SearchModelMutationResponse["model"]
): SearchModelMutationResponse {
  const settings = settingsRepository.get();
  return {
    model,
    selectedModelId: settings.embeddingModelId,
    enabled: settings.semanticSearchEnabled
  };
}
