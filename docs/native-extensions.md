# Native extensions

Wukong treats `.gdextension` descriptors and native library files as opaque
package content. They participate in the same content hash, lockfile,
ownership checks, and transactional materialisation as other addon files.
Wukong never executes a package script, compiles a native extension, or loads a
library while installing it.

This does not prove that a binary is compatible with the active Godot version,
target architecture, operating system, or runtime dependencies. Package
authors remain responsible for distributing compatible artifacts. Use an
explicit Godot validation only on a trusted machine after installation.
