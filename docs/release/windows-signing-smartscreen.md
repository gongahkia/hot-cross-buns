# Windows Signing And SmartScreen

Status: expected policy only. This has not been verified against an installed
Hot Cross Buns 2 NSIS artifact on Windows 11 25H2.

## Unsigned Preview Policy

- Windows NSIS preview artifacts may be unsigned only for local/internal QA.
- Do not publish unsigned Windows artifacts as public support-ready builds.
- Do not tell users to disable SmartScreen, Defender, reputation-based
  protection, or browser download warnings.
- Release notes must label unsigned Windows artifacts as internal preview
  artifacts and require checksum verification before install.

## Expected SmartScreen Behavior

Microsoft Defender SmartScreen uses app, URL, download, and signing reputation.
Unsigned or low-reputation Windows installers can show warnings such as
unrecognized app, unknown publisher, uncommon download, or blocked download.
Those warnings do not prove malware by themselves, and a valid signature alone
does not guarantee SmartScreen will stay silent for a new or low-prevalence app.

For this repo, that means:

- unsigned NSIS preview installers should be expected to show Windows/browser
  trust warnings;
- OV/CA signing can identify the publisher and protect integrity, but new signed
  binaries may still need reputation;
- public Windows distribution requires a signing decision before release;
- SmartScreen observations must be recorded from a real Windows 11 25H2 install run
  before any Windows support claim.

## Signing Paths To Evaluate

- Microsoft Store/MSIX path, where Microsoft re-signs submissions.
- Azure Artifact Signing / Trusted Signing, if the project can satisfy identity
  and account requirements.
- Public CA Authenticode certificate for NSIS `.exe` artifacts.
- Managed-enterprise or self-signed trust only for private testing, never public
  preview downloads.

## QA Evidence To Capture

For each Windows preview artifact:

- installer filename and SHA-256;
- whether the file is signed, and with which publisher;
- browser download warning text, if any;
- SmartScreen dialog text, if any;
- Defender/firewall prompt text, if any;
- whether Start Menu identity, taskbar grouping, notifications, and protocol
  registration still work after install;
- uninstall behavior and retained user-data behavior.

## References

- Microsoft SmartScreen reputation for app developers:
  https://learn.microsoft.com/windows/apps/package-and-deploy/smartscreen-reputation
- Microsoft Defender SmartScreen overview:
  https://learn.microsoft.com/windows/security/operating-system-security/virus-and-threat-protection/microsoft-defender-smartscreen/
- Electron code signing:
  https://www.electronjs.org/docs/latest/tutorial/code-signing
- electron-builder Windows code signing:
  https://www.electron.build/code-signing.html
