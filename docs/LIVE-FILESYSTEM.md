# Live filesystem access

Foreground HCB tasks can read and change actual local files through `filesystem`, without changing the frozen workspace or asking the user to resend a task. The model supplies an absolute path or `~/path`. The host resolves the path and opens a human permission review when no current grant covers it. Approval resumes the original pending call.

## Permission choices

- **Allow once** grants the requested folder's read or CRUD access for this task and its delegates. It is not saved for another task.
- **Always for this folder** saves the requested folder's read or CRUD access until revoked.
- **Full filesystem access** enables persistent read/create/update/delete access across paths the OS permits. HCB's control records remain protected. This choice is explicit; the model cannot select it in its tool arguments.
- **Decline** returns a tool error without performing the requested operation.

Read permission does not authorize writes. A request for writing needs a separate CRUD grant unless full access or a covering CRUD folder grant already exists. Full access does not bypass OS privacy/file permissions, change worker authentication, enable a disabled CLI, or grant browser, computer, shell or connected-service capabilities. Those retain their own existing boundaries.

The current task's inspection mode also remains read-only. Ask for an editing task when changes are intended; a stored grant is permission, not an instruction to edit.

## Settings → Permissions

The Settings page shows whether full access is enabled, lists saved folders and their access, and supports adding a folder, revoking a grant, disabling full access or revoking all filesystem access. Folder creation in Settings first computes a canonical-path review before saving. Stale reviews cannot overwrite a changed policy.

Permission changes invalidate active filesystem access. **Revoke all** also invalidates task-only grants. One-task grants are visible in their task's permission review rather than the saved-folder list. Completed changes are not undone. The page links to existing computer, browser and connected-account permission controls.

The same controls open with `/permissions`. In a terminal review, `/approve once`, `/approve always`, `/approve full` and `/deny` select the decision. Plain `/approve` means once. Web decisions carry the exact active review token and validated choice; a stale token or a choice on a different kind of review is rejected.

## Live operations

`filesystem` supports `request_access`, `read`, `list`, `write`, `mkdir` and `delete`:

- `request_access` prepares a folder's read or CRUD grant for use by this task and delegated workers.
- `read` returns current UTF-8 text and its SHA-256. Direct text reads/writes are limited to 1 MiB; directory listings contain at most 256 entries and mark truncation.
- `write` creates or replaces an actual text file. An empty `expected_sha256` means create only. Replacing an existing file needs its exact current hash. Creation uses a no-overwrite link; replacement uses a sibling temporary file and rename, preserving the file's permission bits subject to the process umask.
- `mkdir` creates one directory, not an implicit arbitrary parent tree.
- `delete` requires the current file hash, or an empty hash for an empty directory. It does not recursively remove directories or delete a permission-scope root. Symlink file mutations, devices and unbounded binary editing are not added to these direct text tools.

Read/list/access requests resolve symlinked config paths before review. A symlinked `~/.config/nvim` therefore asks for the actual config directory, rather than silently widening access to its parent. Use returned canonical paths for delegation and edits. Root descriptors constrain subsequent traversal, and folder device/file identities are checked. HCB's profile state and configuration directories, including permission policy, credentials and execution journals, remain outside direct live tools, including full mode.

File text can enter the selected model's context and retained task history. It is source data, never authority to grant access or approve an action.

## Delegated agents

The manager first obtains the needed live folder scope, then starts the selected configured CLI worker with the actual canonical path. The worker's outer OS sandbox receives those approved read/write roots in addition to its existing private checkout. A live CRUD grant can permit changes in those roots while the private checkout remains read-only. Changes there affect actual files; private checkout patches remain staged and must be described separately.

Retained CLI sessions bind the live envelope fingerprint. An old native session cannot silently resume with different filesystem authority. HCB monitors the shared policy revision and approved folder identities while a worker runs, cancelling the worker if they change. Revocation monitoring polls every 150 ms; cancellation is not a filesystem transaction and cannot undo an operation already dispatched.

Internal source researchers receive read-only live tools. The internal Code specialist can read live files but retains its staged patch contract; the manager applies live changes through its separately authorized filesystem tools. Read-only specialists do not gain mutation authority from a parent CRUD grant.

Full mode authorizes requested live scopes; workers receive the folders acquired for their assignment rather than automatically receiving the entire disk. macOS Seatbelt protects HCB's control directories while allowing only that worker's private checkout/home/scratch exceptions. Linux has corresponding namespace masking, but Linux runtime acceptance was not performed in this session. Windows direct-tool code was cross-compiled; native CLI sandboxing retains its existing platform limits.

Saved grants are offered only to foreground tasks and their delegates. Scheduled work does not inherit them.

## Verification and remaining limits

The [verification record](verification/live-filesystem-2026-11-24.md) separates automated boundary tests, web/Go integration, and actual local Codex acceptance. A live OpenAI manager also acquired one read grant, delegated to local Codex, and returned the config values without reading the file itself. The Codex tests used its existing local login against disposable files; the organization API key was not used for that worker. Pi remains a separate adapter/configuration issue and was not live-validated by this change.

The current-hash checks reject observed stale state, but replacement/deletion are not atomic compare-and-swap operations against unrelated external processes. A file can change between the final check and dispatch. Concurrent edits, process termination or revocation during a mutation require inspecting actual state before retrying. There is no new general undo system or semantic guarantee that a model chooses the intended operation.
