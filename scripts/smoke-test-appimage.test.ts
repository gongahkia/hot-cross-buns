import { createHash } from "node:crypto";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { smokeLinuxAppImageArtifact } from "./smoke-test-appimage";

const versionedAppImage = "Hot-Cross-Buns-2-5.0.0-linux-x86_64.AppImage";
const stableAppImage = "Hot-Cross-Buns-2-linux.AppImage";
const stableX64AppImage = "Hot-Cross-Buns-2-linux-x64.AppImage";
const originalNoSandbox = process.env.HCB_APPIMAGE_SMOKE_NO_SANDBOX;
const originalPackagedMcpSmoke = process.env.HCB_PACKAGED_MCP_SMOKE;
const originalPasswordStore = process.env.HCB_APPIMAGE_SMOKE_PASSWORD_STORE;
const describeAppImageSmoke = process.platform === "win32" ? describe.skip : describe;

beforeEach(() => {
  delete process.env.HCB_PACKAGED_MCP_SMOKE;
  delete process.env.HCB_APPIMAGE_SMOKE_PASSWORD_STORE;
});

afterEach(() => {
  if (originalNoSandbox === undefined) {
    delete process.env.HCB_APPIMAGE_SMOKE_NO_SANDBOX;
  } else {
    process.env.HCB_APPIMAGE_SMOKE_NO_SANDBOX = originalNoSandbox;
  }

  if (originalPackagedMcpSmoke === undefined) {
    delete process.env.HCB_PACKAGED_MCP_SMOKE;
  } else {
    process.env.HCB_PACKAGED_MCP_SMOKE = originalPackagedMcpSmoke;
  }

  if (originalPasswordStore === undefined) {
    delete process.env.HCB_APPIMAGE_SMOKE_PASSWORD_STORE;
  } else {
    process.env.HCB_APPIMAGE_SMOKE_PASSWORD_STORE = originalPasswordStore;
  }
});

async function createReleaseDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "hcb2-appimage-smoke-"));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function appImageScript(desktopExtra = "", launchBody = 'echo "Hot Cross Buns 2 startup"'): string {
  return `#!/bin/sh
if [ "$1" = "--appimage-extract" ]; then
  mkdir -p squashfs-root
  cat > squashfs-root/hot-cross-buns-2.desktop <<'EOF'
Name=Hot Cross Buns 2
Type=Application
Terminal=false
Categories=Office;
GenericName=Planner
StartupWMClass=hot-cross-buns-2
${desktopExtra}EOF
  exit 0
fi
${launchBody}
`;
}

async function writeArtifact(releaseDir: string, name: string, content: string): Promise<string> {
  const filePath = join(releaseDir, name);
  const hash = sha256(content);

  await writeFile(filePath, content);
  await chmod(filePath, 0o755);
  await writeFile(`${filePath}.sha256`, `${hash}  ${basename(filePath)}\n`);

  return hash;
}

async function writeValidArtifacts(releaseDir: string, desktopExtra = "", launchBody?: string): Promise<{
  stableHash: string;
  stableX64Hash: string;
  versionedHash: string;
}> {
  const content = appImageScript(desktopExtra, launchBody);
  const versionedHash = await writeArtifact(releaseDir, versionedAppImage, content);
  const stableHash = await writeArtifact(releaseDir, stableAppImage, content);
  const stableX64Hash = await writeArtifact(releaseDir, stableX64AppImage, content);

  await writeFile(
    join(releaseDir, "SHASUMS256.txt"),
    [
      `${versionedHash}  ${versionedAppImage}`,
      `${stableHash}  ${stableAppImage}`,
      `${stableX64Hash}  ${stableX64AppImage}`
    ].join("\n") + "\n"
  );

  return { stableHash, stableX64Hash, versionedHash };
}

describeAppImageSmoke("Linux AppImage smoke test", () => {
  it("verifies versioned and stable AppImage aliases with checksums and desktop metadata", async () => {
    const releaseDir = await createReleaseDir();

    await writeValidArtifacts(releaseDir);

    await expect(smokeLinuxAppImageArtifact({ releaseDir, minimumBytes: 1 })).resolves.toHaveLength(4);
  });

  it("fails when SHASUMS256.txt does not match an AppImage", async () => {
    const releaseDir = await createReleaseDir();
    const { stableHash, versionedHash } = await writeValidArtifacts(releaseDir);

    await writeFile(
      join(releaseDir, "SHASUMS256.txt"),
      [
        `${versionedHash}  ${versionedAppImage}`,
        `${stableHash}  ${stableAppImage}`,
        `${"0".repeat(64)}  ${stableX64AppImage}`
      ].join("\n") + "\n"
    );

    await expect(smokeLinuxAppImageArtifact({ releaseDir, minimumBytes: 1 })).rejects.toThrow(
      "SHASUMS256.txt hash does not match Hot-Cross-Buns-2-linux-x64.AppImage"
    );
  });

  it("fails when a stable AppImage alias does not match the versioned artifact", async () => {
    const releaseDir = await createReleaseDir();
    const versionedHash = await writeArtifact(releaseDir, versionedAppImage, appImageScript());
    const stableHash = await writeArtifact(releaseDir, stableAppImage, appImageScript("", 'echo "wrong alias"'));
    const stableX64Hash = await writeArtifact(releaseDir, stableX64AppImage, appImageScript());

    await writeFile(
      join(releaseDir, "SHASUMS256.txt"),
      [
        `${versionedHash}  ${versionedAppImage}`,
        `${stableHash}  ${stableAppImage}`,
        `${stableX64Hash}  ${stableX64AppImage}`
      ].join("\n") + "\n"
    );

    await expect(smokeLinuxAppImageArtifact({ releaseDir, minimumBytes: 1 })).rejects.toThrow(
      "Hot-Cross-Buns-2-linux.AppImage does not match Hot-Cross-Buns-2-5.0.0-linux-x86_64.AppImage"
    );
  });

  it("fails when SHASUMS256.txt contains nested unpacked artifacts", async () => {
    const releaseDir = await createReleaseDir();
    const { stableHash, stableX64Hash, versionedHash } = await writeValidArtifacts(releaseDir);

    await writeFile(
      join(releaseDir, "SHASUMS256.txt"),
      [
        `${versionedHash}  ${versionedAppImage}`,
        `${stableHash}  ${stableAppImage}`,
        `${stableX64Hash}  ${stableX64AppImage}`,
        `${"0".repeat(64)}  squashfs-root/resources/helper`
      ].join("\n") + "\n"
    );

    await expect(smokeLinuxAppImageArtifact({ releaseDir, minimumBytes: 1 })).rejects.toThrow(
      "SHASUMS256.txt contains nested artifact squashfs-root/resources/helper"
    );
  });

  it("fails if AppImage metadata registers the unsupported Linux protocol", async () => {
    const releaseDir = await createReleaseDir();

    await writeValidArtifacts(releaseDir, "MimeType=x-scheme-handler/hotcrossbuns;\n");

    await expect(smokeLinuxAppImageArtifact({ releaseDir, minimumBytes: 1 })).rejects.toThrow(
      "AppImage desktop metadata must not register hotcrossbuns://"
    );
  });

  it("launches with the packaged user-data override gate enabled", async () => {
    const releaseDir = await createReleaseDir();

    await writeValidArtifacts(releaseDir, "", `if [ "$HCB_ALLOW_PACKAGED_USER_DATA_DIR" != "1" ]; then
  echo "missing packaged override flag" >&2
  exit 20
fi
if [ ! -d "$HCB_USER_DATA_DIR" ]; then
  echo "missing user data dir" >&2
  exit 21
fi
echo "Hot Cross Buns 2 startup"`);

    await expect(smokeLinuxAppImageArtifact({ launch: true, minimumBytes: 1, releaseDir })).resolves.toEqual(
      expect.arrayContaining([
        expect.stringContaining(`${versionedAppImage} exists`)
      ])
    );
  });

  it("passes no-sandbox only when AppImage smoke opts into the CI launch workaround", async () => {
    const releaseDir = await createReleaseDir();
    process.env.HCB_APPIMAGE_SMOKE_NO_SANDBOX = "1";

    await writeValidArtifacts(releaseDir, "", `if [ "$1" != "--no-sandbox" ]; then
  echo "missing no-sandbox smoke arg" >&2
  exit 22
fi
echo "Hot Cross Buns 2 startup"`);

    await expect(smokeLinuxAppImageArtifact({ launch: true, minimumBytes: 1, releaseDir })).resolves.toEqual(
      expect.arrayContaining([
        expect.stringContaining(`${versionedAppImage} exists`)
      ])
    );
  });

  it("passes the requested Linux password-store backend to the AppImage", async () => {
    const releaseDir = await createReleaseDir();
    process.env.HCB_APPIMAGE_SMOKE_PASSWORD_STORE = "gnome-libsecret";

    await writeValidArtifacts(releaseDir, "", `if [ "$1" != "--password-store=gnome-libsecret" ]; then
  echo "missing password-store smoke arg" >&2
  exit 23
fi
echo "Hot Cross Buns 2 startup"`);

    await expect(smokeLinuxAppImageArtifact({ launch: true, minimumBytes: 1, releaseDir })).resolves.toEqual(
      expect.arrayContaining([
        expect.stringContaining(`${versionedAppImage} exists`)
      ])
    );
  });

  it("reports launch stderr when the AppImage exits early", async () => {
    const releaseDir = await createReleaseDir();

    await writeValidArtifacts(releaseDir, "", `echo "FUSE missing" >&2
exit 2`);

    await expect(smokeLinuxAppImageArtifact({ launch: true, minimumBytes: 1, releaseDir })).rejects.toThrow(
      "Output: FUSE missing"
    );
  });
});
