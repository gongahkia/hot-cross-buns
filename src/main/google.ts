/** Minimal renderer-safe account shape shared with the native shell. */
export interface GoogleAccountConnectionStatusDto {
  accountId?: string;
  email?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  connectionState: string;
}
