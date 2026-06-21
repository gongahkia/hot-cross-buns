import type { LocalUndoRepository } from "../data/localRepositories";
import type { UndoDomainService } from "./domainInterfaces";

export function createSqliteUndoDomainService(
  repository: LocalUndoRepository
): UndoDomainService {
  return {
    status: () => repository.status(),
    undo: () => repository.undo(),
    redo: () => repository.redo()
  };
}
