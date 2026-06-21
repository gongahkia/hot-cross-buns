import type { SyncRunNowRequest, SyncRunNowResponse, SyncStatusResponse } from "@shared/ipc/contracts";
import type {
  GoogleAccountConnectionStatusDto,
  GoogleCalendarReadTransport,
  GoogleTasksReadTransport
} from "../google";
import type {
  LocalHistoryRepository,
  LocalSettingsRepository
} from "../data/localRepositories";
import { appLogger } from "../diagnostics/appLogger";
import { GoogleReadSyncService } from "../sync/readSyncService";
import type { GoogleSyncRepository } from "../sync/readSyncRepository";
import type { ReadSyncResource } from "../sync/types";
import { GooglePendingMutationWorker } from "../sync/mutationWorker";
import type { SyncControlDomainService } from "./domainInterfaces";

type SyncStatusListener = (status: SyncStatusResponse) => void;

export const noopTasksTransport: GoogleTasksReadTransport = {
  listTaskLists: async () => [],
  listTasks: async () => ({ tasks: [], serverDate: new Date().toISOString() })
};

export const noopCalendarTransport: GoogleCalendarReadTransport = {
  listCalendarLists: async () => [],
  listEvents: async () => ({ events: [], nextSyncToken: null })
};

export class LocalSyncControlService implements SyncControlDomainService {
  private readonly repository: GoogleSyncRepository;
  private readonly settingsRepository: LocalSettingsRepository;
  private readonly historyRepository: LocalHistoryRepository | undefined;
  private readonly readSync: GoogleReadSyncService;
  private readonly mutationWorker: GooglePendingMutationWorker | undefined;
  private readonly afterRun: (() => void | Promise<void>) | undefined;
  private readonly listeners = new Set<SyncStatusListener>();
  private running = false;

  constructor(options: {
    repository: GoogleSyncRepository;
    settingsRepository: LocalSettingsRepository;
    historyRepository?: LocalHistoryRepository;
    tasksTransport: GoogleTasksReadTransport;
    calendarTransport: GoogleCalendarReadTransport;
    mutationWorker?: GooglePendingMutationWorker;
    afterRun?: () => void | Promise<void>;
  }) {
    this.repository = options.repository;
    this.settingsRepository = options.settingsRepository;
    this.historyRepository = options.historyRepository;
    this.mutationWorker = options.mutationWorker;
    this.afterRun = options.afterRun;
    this.readSync = new GoogleReadSyncService({
      repository: options.repository,
      tasks: options.tasksTransport,
      calendar: options.calendarTransport
    });
  }

  status(): SyncStatusResponse {
    const settings = this.settingsRepository.get();
    if (settings.storageBackend !== "google") {
      const status = this.repository.syncStatus();
      return {
        ...status,
        state: this.running ? "running" : "idle",
        offline: false,
        stale: false
      };
    }

    const account = this.repository.latestAccountStatus();
    const status = this.repository.syncStatus();
    const offline = account?.connectionState !== "connected";

    return {
      ...status,
      state: this.running ? "running" : status.state,
      offline,
      stale: isStale(status)
    };
  }

  async runNow(request: SyncRunNowRequest): Promise<SyncRunNowResponse> {
    const settings = this.settingsRepository.get();
    const drainOnly = request.drainOnly ?? false;
    if (settings.storageBackend !== "google") {
      return {
        accepted: !this.running,
        dryRun: request.dryRun ?? false,
        drainOnly,
        resources: []
      };
    }

    const resources = drainOnly
      ? []
      : normalizedResources(request.resources).filter((resource) => {
          if (resource === "tasks") {
            return settings.syncTasksEnabled;
          }

          return settings.syncCalendarEventsEnabled;
        });

    if (request.dryRun) {
      return {
        accepted: true,
        dryRun: true,
        drainOnly,
        resources
      };
    }

    if (this.running) {
      return {
        accepted: false,
        dryRun: false,
        drainOnly,
        resources
      };
    }

    this.running = true;
    this.emit();

    try {
      const mutationRun = await this.mutationWorker?.drainDue();

      if (mutationRun) {
        appLogger.info("mutation drain completed", "mutation", mutationRun);
      }
      if (resources.length > 0) {
        const result = await this.readSync.runReadSync({
          account: this.repository.latestAccountStatus() ?? signedOutAccount(),
          resources,
          full: request.full ?? false,
          eventRetentionDaysBack: settings.eventRetentionDaysBack,
          completedTaskRetentionDaysBack: settings.completedTaskRetentionDaysBack
        });
        this.recordSyncHistory(result.summaries, result.ok);
      }
      await this.afterRun?.();
    } finally {
      this.running = false;
      this.emit();
    }

    return {
      accepted: true,
      dryRun: false,
      drainOnly,
      resources
    };
  }

  subscribeStatus(listener: SyncStatusListener): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    const status = this.status();

    for (const listener of this.listeners) {
      listener(status);
    }
  }

  private recordSyncHistory(
    summaries: ReadonlyArray<{ resource: ReadSyncResource; itemCount: number; listCount: number; durationMs: number }>,
    ok: boolean
  ): void {
    for (const summary of summaries) {
      this.historyRepository?.record({
        kind: summary.resource === "tasks" ? "sync.task" : "sync.event",
        summary: ok ? "Synced Google resource" : "Google resource sync failed",
        metadata: {
          resource: summary.resource,
          itemCount: summary.itemCount,
          listCount: summary.listCount,
          durationMs: summary.durationMs
        }
      });
    }
  }
}

function normalizedResources(resources: SyncRunNowRequest["resources"]): ReadSyncResource[] {
  return [...new Set(resources ?? ["tasks", "calendar"])] as ReadSyncResource[];
}

function signedOutAccount(): GoogleAccountConnectionStatusDto {
  const now = new Date().toISOString();

  return {
    accountId: "local-google-account",
    connectionState: "signed_out",
    grantedScopes: [],
    missingScopes: [
      "https://www.googleapis.com/auth/tasks",
      "https://www.googleapis.com/auth/calendar"
    ],
    updatedAt: now
  };
}

function isStale(status: SyncStatusResponse): boolean {
  if (status.lastCompletedAt === undefined) {
    return true;
  }

  return Date.now() - Date.parse(status.lastCompletedAt) > 15 * 60 * 1000;
}
