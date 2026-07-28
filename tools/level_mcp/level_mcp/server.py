"""FastMCP entry point for a-slow-walk creative drafts."""

from __future__ import annotations

import json

from mcp.server import FastMCP

from . import level_store

mcp = FastMCP(
    "a-slow-walk-levels",
    instructions=(
        "Use only revision-checked draft transactions for level changes. Return generated drafts as estimates when reference scale is unknown. "
        "Validation is advisory; never claim the user has approved a level or use MCP to approve one."
    ),
)


def _json(value: object) -> str:
    return json.dumps(value, indent=2)


@mcp.resource("a-slow-walk://schema/level.v1", name="a-slow-walk level schema", mime_type="application/json")
def level_schema() -> str:
    return _json({"schema": level_store.SCHEMA, "module_kinds": list(level_store.MODULE_KINDS), "module_catalog": level_store.MODULE_CATALOG, "transaction_actions": ["add_module", "update_module", "remove_module", "duplicate_module", "set_metadata", "add_reference", "remove_reference", "set_status"], "mutation_policy": "expected_revision is required; stale edits are rejected without auto-merge"})


@mcp.tool()
def list_modules() -> str:
    """List the curated graybox and movement module catalog."""
    return _json(level_store.MODULE_CATALOG)


@mcp.tool()
def create_draft(draft_id: str = "creative-draft", title: str = "Creative Draft") -> str:
    """Create a local-only draft without overwriting an existing draft."""
    return _json(level_store.create_draft(draft_id, title))


@mcp.tool()
def get_draft(draft_id: str = "creative-draft") -> str:
    """Return the canonical editable JSON for a local creative draft."""
    return _json(level_store.load_draft(draft_id))


@mcp.tool()
def apply_transaction(draft_id: str, expected_revision: int, transaction_json: str) -> str:
    """Apply one revision-checked transaction to a local draft."""
    try:
        transaction = json.loads(transaction_json)
    except json.JSONDecodeError as error:
        return _json({"ok": False, "error": f"transaction_json is invalid JSON: {error.msg}"})
    if not isinstance(transaction, dict):
        return _json({"ok": False, "error": "transaction_json must be an object"})
    return _json(level_store.apply_transaction(draft_id, transaction, expected_revision))


@mcp.tool()
def list_revisions(draft_id: str = "creative-draft") -> str:
    """List durable local draft revisions and their affected module ids."""
    return _json(level_store.list_revisions(draft_id))


@mcp.tool()
def get_revision_diff(draft_id: str, revision: int) -> str:
    """Return the persisted before/after diff for one revision."""
    return _json(level_store.revision_diff(draft_id, revision))


@mcp.tool()
def rollback_draft(draft_id: str, target_revision: int, expected_revision: int) -> str:
    """Create a new revision restored from a retained snapshot."""
    return _json(level_store.rollback(draft_id, target_revision, expected_revision))


@mcp.tool()
def validate_draft(draft_id: str = "creative-draft") -> str:
    """Return advisory schema, bounds, route, reset, and assumption findings."""
    return _json(level_store.validate(level_store.load_draft(draft_id)))


@mcp.tool()
def build_preview(draft_id: str = "creative-draft") -> str:
    """Build a deterministic top-down SVG preview and return validation findings."""
    data = level_store.load_draft(draft_id)
    return _json({"ok": True, "preview": str(level_store.preview_svg(data)), "validation": level_store.validate(data)})


@mcp.tool()
def import_reference(draft_id: str, source_path: str, expected_revision: int) -> str:
    """Copy a local screenshot or blueprint into the draft reference library as estimated-scale input."""
    return _json(level_store.import_reference(draft_id, source_path, expected_revision))


@mcp.tool()
def get_playtest_reports(draft_id: str = "creative-draft") -> str:
    """Return local playtest evidence. This tool cannot approve a level."""
    return _json(level_store.playtest_reports(draft_id))


@mcp.tool()
def publish_draft(draft_id: str, expected_revision: int) -> str:
    """Copy one expected draft revision into tracked levels without asserting approval."""
    return _json(level_store.publish(draft_id, expected_revision))


def run_server() -> None:
    """Start the local stdio MCP server."""
    mcp.run()
