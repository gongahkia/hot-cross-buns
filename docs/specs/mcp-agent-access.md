# MCP Agent Access Status

MCP is not implemented in the current C++/Qt macOS application. The capability report exposes it as unsupported. Earlier main-process/IPC MCP plans are historical only.

If revived, MCP must be a loopback-only C++ service using the same validated domain services as the UI, with credentials outside SQLite, bounded requests, redacted diagnostics, dry-run support, and explicit confirmation for destructive changes.
