import { Buffer } from "node:buffer";

const googleTaskUrlPattern = /https:\/\/tasks\.google\.com\/task\/([A-Za-z0-9_-]+)/;

export function googleTaskIdFromCalendarDescription(value: string | null | undefined): string | null {
  const token = value?.match(googleTaskUrlPattern)?.[1];

  return token ? Buffer.from(token).toString("base64url") : null;
}
