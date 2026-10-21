export interface SyncResolutionPreview {
  id: string;
  reviewId: string;
  affectedCount: number;
  uncertainCreation: boolean;
  canKeepLocal: boolean;
  message: string;
  items: Array<{
    id: string;
    kind: string;
    title: string;
    local: Record<string, unknown> | null;
    google: Record<string, unknown> | null;
  }>;
}
