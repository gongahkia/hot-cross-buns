import { describe, expect, it } from "vitest";

import { taskReminderFromNotes, validatePushSubscription } from "../src/reliableSyncService.js";

describe("self-hosted reminder payloads", () => {
  it("extracts an exact portable task reminder only from a terminal HCB envelope", () => {
    const notes = "Pay rent\n\n[HCB-TASK v1]\n{\"m\":{\"t\":\"08:00\",\"z\":\"Asia/Singapore\"}}\n[/HCB-TASK]";

    expect(taskReminderFromNotes(notes)).toEqual({ time: "08:00", timeZone: "Asia/Singapore" });
    expect(taskReminderFromNotes(`${notes}\nextra`)).toBeUndefined();
  });

  it("accepts only HTTPS subscriptions with the required key material", () => {
    expect(validatePushSubscription({ endpoint: "https://push.example.test/subscription", keys: { p256dh: "key", auth: "auth" } })).toEqual({ endpoint: "https://push.example.test/subscription", keys: { p256dh: "key", auth: "auth" } });
    expect(validatePushSubscription({ endpoint: "http://push.example.test/subscription", keys: { p256dh: "key", auth: "auth" } })).toBeUndefined();
  });
});
