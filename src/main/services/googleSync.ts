import { open, stat } from "node:fs/promises";
import { basename } from "node:path";
import { createHash } from "node:crypto";
import { setImmediate } from "node:timers/promises";
import { CoreStore, CoreStoreError } from "./coreStore";
import type { GoogleOAuthController } from "./googleOAuth";
import { GoogleSyncService as SharedGoogleSyncService } from "../../shared/google/GoogleSyncService";
export * from "../../shared/google/GoogleSyncService";

/** Native file access stays outside the browser dependency graph. */
export class GoogleSyncService extends SharedGoogleSyncService {
  constructor(store: CoreStore, oauth: GoogleOAuthController) {
    super(store, oauth, { yieldToRequests: setImmediate, fingerprint: value => createHash("sha256").update(value).digest("hex") });
  }

  async uploadLocalDriveFile(input: { accountId?: unknown; filePath: string }): Promise<Record<string, any>> {
    const file = await stat(input.filePath).catch(() => null);
    if (!file?.isFile()) throw new CoreStoreError("The selected file is no longer available.");
    const handle = await open(input.filePath, "r");
    try {
      return await this.uploadDriveSource({ accountId: input.accountId, source: {
        name: basename(input.filePath), size: file.size,
        read: async (offset, length) => {
          const buffer = new Uint8Array(length);
          const read = await handle.read(buffer, 0, length, offset);
          if (read.bytesRead !== length) throw new CoreStoreError("The selected file changed while it was uploading.");
          return buffer;
        }
      } });
    } finally { await handle.close(); }
  }
}
