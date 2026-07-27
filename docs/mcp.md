# MCP Status

The current native macOS app does not expose an MCP server or CLI. The capability report therefore marks MCP loopback unsupported. Earlier MCP HTTP, bearer-token, vault, and CLI documentation described the retired Electron implementation and is not an available product surface.

MCP may be designed after macOS Calendar/Tasks release acceptance. It must then use the same C++ domain services as the UI, bind only to loopback, keep credentials outside SQLite, and require explicit confirmation for destructive writes.
