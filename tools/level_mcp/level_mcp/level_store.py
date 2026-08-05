"""local revisioned draft storage for a-slow-walk creative levels."""

from __future__ import annotations

import copy
import json
import os
import re
import shutil
from math import cos, sin
from contextlib import contextmanager
from pathlib import Path
from time import sleep, time
from typing import Any, Iterator

SCHEMA = "a_slow_walk.level.v1"
HISTORY_LIMIT = 100
SNAPSHOT_INTERVAL = 10
PLAYTEST_LIMIT = 20
LOCK_TIMEOUT_SECONDS = 2.0
LOCK_STALE_SECONDS = 15.0
MODULE_KINDS = (
    "platform", "wall", "ramp", "boost", "launch", "grapple_anchor",
    "recharge", "collectible", "reset", "gap", "sign", "building",
    "climbable_trunk", "root_arch", "route_marker", "checkpoint",
)
MODULE_CATALOG = {
    "platform": "walkable rectangular graybox surface; size is [x, y, z]",
    "wall": "solid vertical/static geometry; size is [x, y, z], rotation_y is optional",
    "ramp": "movement ramp; requires start, end, and width",
    "boost": "directional boost trigger; requires direction [x, y, z]",
    "launch": "vertical launch trigger",
    "grapple_anchor": "tether target",
    "recharge": "dash or double-jump recharge trigger",
    "collectible": "style pickup",
    "reset": "reset/respawn trigger; requires spawn",
    "gap": "style gap trigger; optional points",
    "sign": "non-colliding instructional Label3D",
    "building": "interior graybox building; footprint and height",
    "climbable_trunk": "wall-run/wall-jump collision fixture",
    "root_arch": "non-mechanic graybox prop",
    "route_marker": "non-colliding route annotation",
    "checkpoint": "playtest evidence checkpoint; must be crossed before manual approval",
}


def project_root() -> Path:
    configured = os.environ.get("ASW_PROJECT_ROOT")
    return Path(configured).expanduser().resolve() if configured else Path(__file__).resolve().parents[3]


def drafts_root() -> Path:
    root = project_root() / "levels" / "_drafts"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _safe_id(value: str) -> str:
    safe = re.sub(r"[^a-zA-Z0-9_-]+", "-", value).strip("-").lower()
    return safe or "creative-draft"


def draft_path(draft_id: str) -> Path:
    return drafts_root() / f"{_safe_id(draft_id)}.level.json"


def published_path(level_id: str) -> Path:
    return project_root() / "levels" / f"{_safe_id(level_id)}.level.json"


def _history_root(draft_id: str) -> Path:
    return drafts_root() / ".history" / _safe_id(draft_id)


def _playtest_root(draft_id: str) -> Path:
    return drafts_root() / ".playtests" / _safe_id(draft_id)


def _lock_root(draft_id: str) -> Path:
    return drafts_root() / ".locks" / f"{_safe_id(draft_id)}.lock"


def _manifest_path(draft_id: str) -> Path:
    return _history_root(draft_id) / "manifest.json"


def _snapshot_path(draft_id: str, revision: int) -> Path:
    return _history_root(draft_id) / "snapshots" / f"{revision}.level.json"


def _change_path(draft_id: str, revision: int) -> Path:
    return _history_root(draft_id) / "changes" / f"{revision}.json"


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    temporary.replace(path)


def _read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return None


@contextmanager
def _draft_lock(draft_id: str) -> Iterator[bool]:
    lock_path = _lock_root(draft_id)
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    started = time()
    while True:
        try:
            lock_path.mkdir()
            _write_json(lock_path / "owner.json", {"owner": "mcp", "created_at": time()})
            break
        except FileExistsError:
            owner = lock_path / "owner.json"
            if owner.exists() and time() - owner.stat().st_mtime > LOCK_STALE_SECONDS:
                shutil.rmtree(lock_path, ignore_errors=True)
                continue
            if time() - started >= LOCK_TIMEOUT_SECONDS:
                yield False
                return
            sleep(0.025)
    try:
        yield True
    finally:
        shutil.rmtree(lock_path, ignore_errors=True)


def blank_draft(draft_id: str = "creative-draft", title: str = "Creative Draft") -> dict[str, Any]:
    return {
        "schema": SCHEMA, "version": 1, "id": _safe_id(draft_id), "title": title,
        "briefing": "Local creative draft.", "focus": "full style kit", "status": "draft",
        "revision": 0, "world": {"width": 96.0, "length": 96.0, "terrain_style": "summit"},
        "spawn": [0.0, 1.1, 3.0], "modules": [], "routes": [], "references": [],
        "assumptions": [], "history": [],
    }


def normalize(data: Any, draft_id: str = "creative-draft") -> dict[str, Any]:
    if not isinstance(data, dict):
        return blank_draft(draft_id)
    out = copy.deepcopy(data)
    defaults = blank_draft(draft_id)
    for key, value in defaults.items():
        out.setdefault(key, copy.deepcopy(value))
    out["revision"] = int(out.get("revision", 0))
    return out


def load_draft(draft_id: str = "creative-draft") -> dict[str, Any]:
    path = draft_path(draft_id)
    if path.exists():
        return normalize(_read_json(path), draft_id)
    sandbox = project_root() / "levels" / "sandbox.level.json"
    data = normalize(_read_json(sandbox), draft_id) if sandbox.exists() else blank_draft(draft_id)
    data["id"] = _safe_id(draft_id)
    data["title"] = "Creative Draft" if draft_id == "creative-draft" else data["title"]
    data["status"] = "draft"
    save_draft(data)
    return data


def save_draft(data: dict[str, Any]) -> Path:
    normalized = normalize(data, str(data.get("id", "creative-draft")))
    path = draft_path(str(normalized["id"]))
    _write_json(path, normalized)
    manifest = _manifest_path(str(normalized["id"]))
    if not manifest.exists():
        _write_json(_snapshot_path(str(normalized["id"]), int(normalized["revision"])), normalized)
        _write_json(manifest, {"revisions": []})
    return path


def create_draft(draft_id: str = "creative-draft", title: str = "Creative Draft") -> dict[str, Any]:
    draft_id = _safe_id(draft_id)
    with _draft_lock(draft_id) as locked:
        if not locked:
            return {"ok": False, "error": "draft is busy; retry after refreshing"}
        if draft_path(draft_id).exists():
            data = load_draft(draft_id)
            return {"ok": True, "created": False, "draft_id": data["id"], "revision": data["revision"], "path": str(draft_path(draft_id))}
        data = blank_draft(draft_id, title)
        path = save_draft(data)
        return {"ok": True, "created": True, "draft_id": data["id"], "revision": 0, "path": str(path)}


def _vector(value: Any) -> list[float] | None:
    if not isinstance(value, list) or len(value) != 3:
        return None
    if not all(isinstance(item, (int, float)) and not isinstance(item, bool) for item in value):
        return None
    return [float(item) for item in value]


def _modules(data: dict[str, Any]) -> list[Any]:
    return data["modules"] if isinstance(data.get("modules"), list) else []


def _module(data: dict[str, Any], module_id: str) -> dict[str, Any] | None:
    return next((item for item in _modules(data) if isinstance(item, dict) and str(item.get("id", "")) == module_id), None)


def _next_module_id(data: dict[str, Any], kind: str) -> str:
    prefix, index = _safe_id(kind), 1
    ids = {str(item.get("id", "")) for item in _modules(data) if isinstance(item, dict)}
    while f"{prefix}-{index}" in ids:
        index += 1
    return f"{prefix}-{index}"


def _finding(messages: list[str], codes: list[str], code: str, message: str) -> None:
    if code not in codes:
        codes.append(code)
        messages.append(message)


def validate(data: dict[str, Any]) -> dict[str, Any]:
    data = normalize(data)
    errors: list[str] = []
    warnings: list[str] = []
    error_codes: list[str] = []
    warning_codes: list[str] = []
    if data.get("schema") != SCHEMA:
        _finding(errors, error_codes, "schema.unsupported", "Unsupported level schema.")
    if not str(data.get("id", "")):
        _finding(errors, error_codes, "level.id_required", "Level id is required.")
    world = data.get("world") if isinstance(data.get("world"), dict) else {}
    width, length = float(world.get("width", 0)), float(world.get("length", 0))
    if width <= 0 or length <= 0:
        _finding(errors, error_codes, "world.invalid_dimensions", "World width and length must be positive.")
    ids: set[str] = set()
    modules = _modules(data)
    if not modules:
        _finding(warnings, warning_codes, "modules.empty", "Draft has no modules.")
    for module in modules:
        if not isinstance(module, dict):
            _finding(errors, error_codes, "module.not_object", "Module entry is not an object.")
            continue
        module_id, kind, position = str(module.get("id", "")), str(module.get("kind", "")), _vector(module.get("position"))
        if not module_id or module_id in ids:
            _finding(errors, error_codes, "module.id_invalid", "Module ids must be unique and non-empty.")
        ids.add(module_id)
        if kind not in MODULE_KINDS:
            _finding(errors, error_codes, "module.kind_unknown", f"Unknown module kind: {kind}")
        if not position:
            _finding(errors, error_codes, "module.position_invalid", f"Module {module_id} has no valid position.")
            continue
        if abs(position[0]) > width / 2 or position[2] > 16 or position[2] < -length:
            _finding(warnings, warning_codes, "module.out_of_bounds", f"Module {module_id} is outside world bounds.")
        if module.get("estimated") or module.get("confidence") == "estimated":
            _finding(warnings, warning_codes, "module.estimated", f"Module {module_id} uses estimated reference geometry.")
    if not _vector(data.get("spawn")):
        _finding(errors, error_codes, "spawn.invalid", "Spawn must be a three-number vector.")
    if not any(isinstance(item, dict) and item.get("kind") == "reset" for item in modules):
        _finding(warnings, warning_codes, "reset.missing", "Draft has no reset pad.")
    if isinstance(data.get("assumptions"), list) and data["assumptions"]:
        _finding(warnings, warning_codes, "assumptions.unconfirmed", "Draft contains unconfirmed scale or layout assumptions.")
    routes = data.get("routes")
    if not isinstance(routes, list):
        _finding(warnings, warning_codes, "route.invalid_collection", "Routes must be an array.")
    else:
        for route in routes:
            if not isinstance(route, dict):
                _finding(warnings, warning_codes, "route.not_object", "Route entry is not an object.")
                continue
            members = route.get("modules")
            if not isinstance(members, list) or len(members) < 2:
                _finding(warnings, warning_codes, "route.insufficient_members", f"Route {route.get('id', 'unnamed')} has fewer than two markers.")
            elif any(str(member) not in ids for member in members):
                _finding(warnings, warning_codes, "route.missing_module", f"Route {route.get('id', 'unnamed')} references a missing module.")
    references = data.get("references")
    if not isinstance(references, list):
        _finding(warnings, warning_codes, "reference.invalid_collection", "References must be an array.")
    elif any(not isinstance(reference, dict) or not str(reference.get("path", "")) for reference in references):
        _finding(warnings, warning_codes, "reference.invalid", "Reference is missing a path.")
    geometry = [item for item in modules if isinstance(item, dict) and item.get("kind") in {"platform", "wall", "building", "climbable_trunk"}]
    for index, first in enumerate(geometry):
        first_pos, first_size = _vector(first.get("position")), _vector(first.get("size")) or [4, 0.8, 4]
        if not first_pos:
            continue
        for second in geometry[index + 1:]:
            second_pos, second_size = _vector(second.get("position")), _vector(second.get("size")) or [4, 0.8, 4]
            if second_pos and abs(first_pos[1] - second_pos[1]) < (first_size[1] + second_size[1]) / 2 and _oriented_rectangles_overlap(first_pos, first_size, float(first.get("rotation_y", 0)), second_pos, second_size, float(second.get("rotation_y", 0))):
                _finding(warnings, warning_codes, "geometry.overlap", f"Geometry overlaps: {first.get('id', '')} / {second.get('id', '')}")
    return {"schema": SCHEMA, "level_id": str(data.get("id", "")), "revision": int(data["revision"]), "errors": errors, "warnings": warnings, "error_codes": error_codes, "warning_codes": warning_codes, "status": str(data.get("status", "draft")), "manual_approval_required": True}


def _oriented_rectangles_overlap(first_pos: list[float], first_size: list[float], first_rotation: float, second_pos: list[float], second_size: list[float], second_rotation: float) -> bool:
    def axes(rotation: float) -> tuple[tuple[float, float], tuple[float, float]]:
        return (cos(rotation), -sin(rotation)), (sin(rotation), cos(rotation))
    def radius(size: list[float], rotation: float, axis: tuple[float, float]) -> float:
        x_axis, z_axis = axes(rotation)
        return size[0] / 2 * abs(x_axis[0] * axis[0] + x_axis[1] * axis[1]) + size[2] / 2 * abs(z_axis[0] * axis[0] + z_axis[1] * axis[1])
    delta = (second_pos[0] - first_pos[0], second_pos[2] - first_pos[2])
    for axis in (*axes(first_rotation), *axes(second_rotation)):
        if abs(delta[0] * axis[0] + delta[1] * axis[1]) >= radius(first_size, first_rotation, axis) + radius(second_size, second_rotation, axis):
            return False
    return True


def _changed_ids(transaction: dict[str, Any], result: dict[str, Any]) -> list[str]:
    if "changed_module_ids" in result:
        return list(result["changed_module_ids"])
    if "module_id" in result:
        return [str(result["module_id"])]
    if "reference_id" in result:
        return [f"@reference:{result['reference_id']}"]
    return ["*"]


def _history(draft_id: str) -> list[dict[str, Any]]:
    manifest = _read_json(_manifest_path(draft_id))
    return manifest.get("revisions", []) if isinstance(manifest, dict) and isinstance(manifest.get("revisions"), list) else []


def _conflict(draft_id: str, data: dict[str, Any], expected_revision: int) -> dict[str, Any]:
    changed = []
    for record in _history(draft_id):
        if int(record.get("revision", 0)) > expected_revision:
            changed.extend(module_id for module_id in record.get("changed_module_ids", []) if module_id not in changed)
    return {"ok": False, "conflict": True, "error": "draft revision is stale; refresh before editing", "expected_revision": expected_revision, "current_revision": data["revision"], "changed_module_ids": changed}


def _record_history(draft_id: str, before: dict[str, Any], data: dict[str, Any], record: dict[str, Any]) -> None:
    revision = int(data["revision"])
    if revision % SNAPSHOT_INTERVAL == 0 or record["action"] == "rollback":
        _write_json(_snapshot_path(draft_id, revision), data)
    _write_json(_change_path(draft_id, revision), _compact_diff(before, data, record))
    revisions = _history(draft_id)
    revisions.append(record)
    while len(revisions) > HISTORY_LIMIT:
        revisions.pop(0)
    if revisions:
        oldest_revision = int(revisions[0]["revision"])
        base_revision = max((int(path.stem.split(".")[0]) for path in (_history_root(draft_id) / "snapshots").glob("*.level.json") if int(path.stem.split(".")[0]) <= oldest_revision), default=0)
        for path in (_history_root(draft_id) / "snapshots").glob("*.level.json"):
            if int(path.stem.split(".")[0]) < base_revision:
                path.unlink(missing_ok=True)
        for path in (_history_root(draft_id) / "changes").glob("*.json"):
            if int(path.stem) < base_revision + 1:
                path.unlink(missing_ok=True)
    _write_json(_manifest_path(draft_id), {"revisions": revisions})


def _compact_diff(before: dict[str, Any], after: dict[str, Any], record: dict[str, Any]) -> dict[str, Any]:
    before_modules = {str(item.get("id", "")): item for item in _modules(before) if isinstance(item, dict) and str(item.get("id", ""))}
    after_modules = {str(item.get("id", "")): item for item in _modules(after) if isinstance(item, dict) and str(item.get("id", ""))}
    modules = {
        module_id: {"before": before_modules.get(module_id), "after": after_modules.get(module_id)}
        for module_id in sorted(set(before_modules) | set(after_modules))
        if before_modules.get(module_id) != after_modules.get(module_id)
    }
    metadata = {
        key: copy.deepcopy(value)
        for key, value in after.items()
        if key not in {"modules", "history", "revision"} and before.get(key) != value
    }
    return {"revision": int(after["revision"]), "before_revision": int(before.get("revision", 0)), "action": record["action"], "changed_module_ids": record["changed_module_ids"], "metadata": metadata, "modules": modules, "module_order": [str(item.get("id", "")) for item in _modules(after) if isinstance(item, dict)]}


def _materialize_revision(draft_id: str, target_revision: int) -> dict[str, Any] | None:
    snapshots = [path for path in (_history_root(draft_id) / "snapshots").glob("*.level.json") if int(path.stem.split(".")[0]) <= target_revision]
    if not snapshots:
        return None
    base_path = max(snapshots, key=lambda path: int(path.stem.split(".")[0]))
    data = normalize(_read_json(base_path), draft_id)
    base_revision = int(base_path.stem.split(".")[0])
    history = [record for record in _history(draft_id) if base_revision < int(record.get("revision", 0)) <= target_revision]
    for record in history:
        change = _read_json(_change_path(draft_id, int(record["revision"])))
        if not isinstance(change, dict):
            return None
        if isinstance(change.get("after"), dict):
            data = normalize(change["after"], draft_id)
            continue
        for key, value in change.get("metadata", {}).items():
            data[key] = value
        module_map = {str(item.get("id", "")): item for item in _modules(data) if isinstance(item, dict)}
        for module_id, patch in change.get("modules", {}).items():
            if patch.get("after") is None:
                module_map.pop(module_id, None)
            else:
                module_map[module_id] = patch["after"]
        data["modules"] = [module_map[module_id] for module_id in change.get("module_order", []) if module_id in module_map]
        data["revision"] = int(change["revision"])
    data["history"] = [record for record in _history(draft_id) if int(record.get("revision", 0)) <= target_revision]
    return data


def _commit(draft_id: str, before: dict[str, Any], data: dict[str, Any], transaction: dict[str, Any], result: dict[str, Any]) -> dict[str, Any]:
    data["revision"] = int(before.get("revision", 0)) + 1
    changed = _changed_ids(transaction, result)
    record = {"id": str(transaction.get("id") or f"txn-{data['revision']}"), "action": str(transaction["action"]), "revision": data["revision"], "changed_module_ids": changed, "target_revision": transaction.get("target_revision")}
    history = data.setdefault("history", [])
    history.append(record)
    data["history"] = history[-HISTORY_LIMIT:]
    path = save_draft(data)
    _record_history(draft_id, before, data, record)
    return {**result, "draft_id": data["id"], "revision": data["revision"], "changed_module_ids": changed, "path": str(path)}


def apply_transaction(draft_id: str, transaction: dict[str, Any], expected_revision: int | None = None) -> dict[str, Any]:
    draft_id = _safe_id(draft_id)
    with _draft_lock(draft_id) as locked:
        if not locked:
            return {"ok": False, "error": "draft is busy; retry after refreshing"}
        data = load_draft(draft_id)
        if expected_revision is None:
            expected_revision = transaction.get("expected_revision")
        if not isinstance(expected_revision, int):
            return {"ok": False, "error": "expected_revision is required"}
        if expected_revision != data["revision"]:
            return _conflict(draft_id, data, expected_revision)
        action = str(transaction.get("action", ""))
        if not action:
            return {"ok": False, "error": "transaction action is required"}
        before = copy.deepcopy(data)
        result: dict[str, Any]
        if action == "add_module":
            module = transaction.get("module")
            if not isinstance(module, dict) or str(module.get("kind", "")) not in MODULE_KINDS:
                return {"ok": False, "error": "add_module requires a known module kind"}
            next_module = copy.deepcopy(module)
            next_module["id"] = str(next_module.get("id") or _next_module_id(data, str(next_module["kind"])))
            if _module(data, next_module["id"]) or not _vector(next_module.get("position")):
                return {"ok": False, "error": "module id exists or position is invalid"}
            _modules(data).append(next_module)
            result = {"ok": True, "module_id": next_module["id"]}
        elif action == "update_module":
            module_id, patch = str(transaction.get("module_id", "")), transaction.get("patch")
            module = _module(data, module_id)
            if not module or not isinstance(patch, dict):
                return {"ok": False, "error": "update_module requires an existing module and patch"}
            module.update({key: value for key, value in patch.items() if key != "id"})
            if not _vector(module.get("position")):
                return {"ok": False, "error": "module position must be [x, y, z]"}
            result = {"ok": True, "module_id": module_id}
        elif action == "remove_module":
            module_id = str(transaction.get("module_id", ""))
            modules = _modules(data)
            data["modules"] = [item for item in modules if not isinstance(item, dict) or str(item.get("id", "")) != module_id]
            if len(data["modules"]) == len(modules):
                return {"ok": False, "error": "module was not found"}
            result = {"ok": True, "module_id": module_id, "removed": True}
        elif action == "duplicate_module":
            source = _module(data, str(transaction.get("module_id", "")))
            if not source:
                return {"ok": False, "error": "module was not found"}
            duplicate = copy.deepcopy(source)
            duplicate["id"] = _next_module_id(data, str(duplicate.get("kind", "module")))
            offset = _vector(transaction.get("offset")) or [1.5, 0.0, 1.5]
            duplicate["position"] = [duplicate["position"][index] + offset[index] for index in range(3)]
            _modules(data).append(duplicate)
            result = {"ok": True, "module_id": duplicate["id"]}
        elif action == "set_metadata":
            patch = transaction.get("patch")
            if not isinstance(patch, dict):
                return {"ok": False, "error": "set_metadata requires a patch"}
            for key, value in patch.items():
                if key not in {"schema", "modules", "history", "status"}:
                    data[key] = value
            if "references" in patch:
                result = {"ok": True, "references_changed": True, "changed_module_ids": ["@reference:*"]}
            elif "world" in patch:
                result = {"ok": True, "full_rebuild": True, "changed_module_ids": ["*"]}
            else:
                result = {"ok": True, "changed_module_ids": []}
        elif action == "add_reference":
            reference = transaction.get("reference")
            if not isinstance(reference, dict) or not str(reference.get("path", "")):
                return {"ok": False, "error": "add_reference requires a path"}
            references = data["references"] if isinstance(data.get("references"), list) else []
            data["references"] = references
            next_reference = copy.deepcopy(reference)
            next_reference.setdefault("id", f"reference-{len(references) + 1}")
            references.append(next_reference)
            result = {"ok": True, "reference_id": next_reference["id"], "references_changed": True}
        elif action == "remove_reference":
            reference_id = str(transaction.get("reference_id", ""))
            references = data["references"] if isinstance(data.get("references"), list) else []
            data["references"] = [item for item in references if not isinstance(item, dict) or str(item.get("id", "")) != reference_id]
            if len(data["references"]) == len(references):
                return {"ok": False, "error": "reference was not found"}
            result = {"ok": True, "reference_id": reference_id, "references_changed": True}
        elif action == "set_status":
            status = str(transaction.get("status", "draft"))
            if status not in {"draft", "reviewed"}:
                return {"ok": False, "error": "only draft or reviewed may be set by transactions"}
            data["status"] = status
            result = {"ok": True, "status": status}
        else:
            return {"ok": False, "error": f"unknown action: {action}"}
        return _commit(draft_id, before, data, transaction, result)


def list_revisions(draft_id: str = "creative-draft") -> list[dict[str, Any]]:
    return _history(draft_id)


def revision_diff(draft_id: str, revision: int) -> dict[str, Any]:
    value = _read_json(_change_path(draft_id, revision))
    return value if isinstance(value, dict) else {"ok": False, "error": "revision diff was not found"}


def rollback(draft_id: str, target_revision: int, expected_revision: int) -> dict[str, Any]:
    draft_id = _safe_id(draft_id)
    with _draft_lock(draft_id) as locked:
        if not locked:
            return {"ok": False, "error": "draft is busy; retry after refreshing"}
        data = load_draft(draft_id)
        if expected_revision != data["revision"]:
            return _conflict(draft_id, data, expected_revision)
        snapshot = _materialize_revision(draft_id, target_revision)
        if not isinstance(snapshot, dict):
            return {"ok": False, "error": "revision snapshot was not found"}
        before, restored = copy.deepcopy(data), normalize(snapshot, draft_id)
        restored["revision"] = before["revision"]
        return _commit(draft_id, before, restored, {"action": "rollback", "target_revision": target_revision}, {"ok": True, "rolled_back_to": target_revision})


def save_playtest_report(draft_id: str, report: dict[str, Any]) -> dict[str, Any]:
    data = load_draft(draft_id)
    run = copy.deepcopy(report)
    run.update({"level_id": data["id"], "revision": data["revision"], "completed": True, "saved_at": run.get("saved_at") or time()})
    root = _playtest_root(draft_id)
    root.mkdir(parents=True, exist_ok=True)
    path = root / f"run-{int(float(run['saved_at']) * 1000)}.json"
    _write_json(path, run)
    for old in sorted(root.glob("*.json"))[:-PLAYTEST_LIMIT]:
        old.unlink(missing_ok=True)
    return {"ok": True, "path": str(path), "report": run}


def playtest_reports(draft_id: str = "creative-draft") -> list[dict[str, Any]]:
    return [report for path in sorted(_playtest_root(draft_id).glob("*.json"), reverse=True) if isinstance((report := _read_json(path)), dict)]


def preview_svg(data: dict[str, Any]) -> Path:
    data = normalize(data)
    root = drafts_root() / "previews"
    root.mkdir(parents=True, exist_ok=True)
    width, height, scale = 960, 720, 5.5
    colors = {"platform": "#527a48", "wall": "#425e3c", "ramp": "#638951", "boost": "#78b78b", "launch": "#a6d47b", "grapple_anchor": "#c9ec8c", "gap": "#f1d477", "recharge": "#8be6ff", "checkpoint": "#d1a4ff"}
    nodes = [f'<rect width="{width}" height="{height}" fill="#17231d"/>', f'<text x="24" y="34" fill="#edf3d5" font-family="monospace" font-size="20">{data["title"]} / revision {data["revision"]}</text>']
    for module in _modules(data):
        if not isinstance(module, dict) or not (position := _vector(module.get("position"))):
            continue
        kind, x, y = str(module.get("kind", "module")), width / 2 + position[0] * scale, 80 + (-position[2]) * scale
        size = _vector(module.get("size")) or [3.2, 1, 3.2]
        nodes.append(f'<rect x="{x - size[0] * scale / 2:.1f}" y="{y - size[2] * scale / 2:.1f}" width="{size[0] * scale:.1f}" height="{size[2] * scale:.1f}" fill="{colors.get(kind, "#8ab85f")}" fill-opacity="0.82" stroke="#edf3d5" stroke-width="1"/>')
    path = root / f"{data['id']}.svg"
    path.write_text('<svg xmlns="http://www.w3.org/2000/svg" width="960" height="720">' + ''.join(nodes) + '</svg>')
    return path


def import_reference(draft_id: str, source_path: str, expected_revision: int) -> dict[str, Any]:
    source = Path(source_path).expanduser().resolve()
    if not source.is_file() or source.suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp"}:
        return {"ok": False, "error": "reference must be an existing PNG, JPG, JPEG, or WebP file"}
    target_dir = drafts_root() / "references"
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / f"reference-{source.stem}-{source.stat().st_mtime_ns}{source.suffix.lower()}"
    shutil.copy2(source, target)
    relative = target.relative_to(project_root()).as_posix()
    result = apply_transaction(draft_id, {"action": "add_reference", "expected_revision": expected_revision, "reference": {"path": f"res://{relative}", "estimated": True, "position": [0.0, 0.04, -35.0], "size": [20.0, 20.0], "scale_confidence": "estimated"}})
    if result.get("ok"):
        data = load_draft(draft_id)
        if "Reference image scale is estimated; confirm a known dimension before publishing." not in data["assumptions"]:
            data["assumptions"].append("Reference image scale is estimated; confirm a known dimension before publishing.")
            result = apply_transaction(draft_id, {"action": "set_metadata", "patch": {"assumptions": data["assumptions"]}}, int(result["revision"]))
    return result


def publish(draft_id: str, expected_revision: int) -> dict[str, Any]:
    draft_id = _safe_id(draft_id)
    with _draft_lock(draft_id) as locked:
        if not locked:
            return {"ok": False, "error": "draft is busy; retry after refreshing"}
        data = load_draft(draft_id)
        if expected_revision != data["revision"]:
            return _conflict(draft_id, data, expected_revision)
        destination = published_path(str(data["id"]))
        _write_json(destination, data)
        return {"ok": True, "draft_id": data["id"], "revision": data["revision"], "path": str(destination), "status": data["status"], "manual_approval_required": True}
