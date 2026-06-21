import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  localHosterManifestSchema,
  localHosterProtocolCompatibility,
  localHosterProtocolCompatibilitySchema,
  localHosterSignalPayloadSchema
} from "./hosters";

describe("local hoster protocol compatibility", () => {
  it("keeps v1 golden fixtures parseable", () => {
    const manifest = fixture("manifest-v1.json");
    const signalPayload = fixture("signal-payload-v1.json");
    const compatibility = fixture("protocol-compatibility-v1.json");

    expect(localHosterManifestSchema.parse(manifest)).toEqual(manifest);
    expect(localHosterSignalPayloadSchema.parse(signalPayload)).toEqual(signalPayload);
    expect(localHosterProtocolCompatibilitySchema.parse(compatibility)).toEqual(compatibility);
    expect(localHosterProtocolCompatibility()).toEqual(compatibility);
  });

  it("rejects unsupported format versions before import or dispatch", () => {
    const manifest = fixture("manifest-v1.json");
    const signalPayload = fixture("signal-payload-v1.json");

    expect(localHosterManifestSchema.safeParse({ ...manifest, formatVersion: 2 }).success).toBe(false);
    expect(localHosterSignalPayloadSchema.safeParse({ ...signalPayload, formatVersion: 2 }).success).toBe(false);
  });
});

function fixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(process.cwd(), "tests", "fixtures", "local-hoster", name), "utf8")) as Record<string, unknown>;
}
