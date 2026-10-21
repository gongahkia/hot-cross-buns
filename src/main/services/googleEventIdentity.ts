export function deterministicGoogleEventId(localId: string): string {
  // Calendar IDs use lower-case base32hex; UUID hex is a valid subset.
  return `hcb${String(localId).replace(/[^a-f0-9]/gi, "").toLowerCase()}`.slice(0, 1024);
}

export function claimedLocalEventId(remote: Record<string, any>): string | null {
  const id = remote.extendedProperties?.private?.hcbLocalEventId;
  return typeof id === "string" && id.length <= 200 && remote.id === deterministicGoogleEventId(id) ? id : null;
}
