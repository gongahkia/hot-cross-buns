import type {
  LocalHosterCreateRequest,
  LocalHosterExportRequest,
  LocalHosterImportRequest,
  LocalHosterMutationResponse,
  LocalHosterRemoveRequest,
  LocalHosterStatusResponse,
  LocalHosterTestRequest
} from "@shared/ipc/contracts";
import type { LocalHosterRepository } from "../data/localRepositories";
import type { MaybePromise } from "./domainInterfaces";

export interface LocalHosterDomainService {
  status: () => MaybePromise<LocalHosterStatusResponse>;
  create: (request: LocalHosterCreateRequest) => MaybePromise<LocalHosterMutationResponse>;
  export: (request: LocalHosterExportRequest) => MaybePromise<LocalHosterMutationResponse>;
  import: (request: LocalHosterImportRequest) => MaybePromise<LocalHosterMutationResponse>;
  remove: (request: LocalHosterRemoveRequest) => MaybePromise<LocalHosterMutationResponse>;
  test: (request: LocalHosterTestRequest) => MaybePromise<LocalHosterMutationResponse>;
}

export function createSqliteHosterDomainService(input: {
  repository: LocalHosterRepository;
  statusBase: () => Omit<LocalHosterStatusResponse, "profiles">;
  endpoint: () => string;
}): LocalHosterDomainService {
  return {
    status: () => input.repository.status(input.statusBase()),
    create: (request) => input.repository.create(request, input.endpoint()),
    export: (request) => input.repository.export(request),
    import: (request) => input.repository.import(request),
    remove: (request) => input.repository.remove(request),
    test: (request) => input.repository.test(request)
  };
}
