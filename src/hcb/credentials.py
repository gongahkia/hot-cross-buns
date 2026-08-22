"""Local, per-account Google OAuth credential files.

Client identifiers are deliberately kept in a user-managed ``.env`` file.  A
refresh token, when one is issued, is encrypted in that same file with a
per-file Fernet key held by the operating-system keyring.
"""

from __future__ import annotations

import hashlib
import os
import re
import stat
import tempfile
from pathlib import Path
from typing import Any

from cryptography.fernet import Fernet, InvalidToken

from .auth import TokenStore

CLIENT_ID_KEY = "HCB_GOOGLE_CLIENT_ID"
CLIENT_SECRET_KEY = "HCB_GOOGLE_CLIENT_SECRET"
REFRESH_TOKEN_KEY = "HCB_GOOGLE_REFRESH_TOKEN_ENCRYPTED"
_ASSIGNMENT = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*)$")


class CredentialFileError(ValueError):
    """The local credential file is missing, malformed, or unsafe to use."""


def load_client_config(path: Path) -> dict[str, Any]:
    """Return a google-auth-oauthlib desktop-client configuration from *path*."""

    values = read_environment(path)
    client_id = values.get(CLIENT_ID_KEY, "").strip()
    if not client_id:
        raise CredentialFileError(f"{path} is missing {CLIENT_ID_KEY}")

    installed = {
        "client_id": client_id,
        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
        "token_uri": "https://oauth2.googleapis.com/token",
        "redirect_uris": ["http://localhost"],
    }
    client_secret = values.get(CLIENT_SECRET_KEY, "").strip()
    if client_secret:
        installed["client_secret"] = client_secret
    return {"installed": installed}


def read_environment(path: Path) -> dict[str, str]:
    """Read a deliberately small, predictable subset of dotenv syntax."""

    _check_permissions(path)
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise CredentialFileError(f"credential file does not exist: {path}") from exc

    values: dict[str, str] = {}
    for line_number, raw_line in enumerate(text.splitlines(), start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        match = _ASSIGNMENT.match(line)
        if match is None:
            raise CredentialFileError(f"invalid assignment in {path}:{line_number}")
        key, value = match.groups()
        values[key] = _unquote(value.strip(), path, line_number)
    return values


def _unquote(value: str, path: Path, line_number: int) -> str:
    if not value:
        return ""
    if value[0] not in {"'", '"'}:
        return value.split(" #", maxsplit=1)[0].rstrip()
    if len(value) < 2 or value[-1] != value[0]:
        raise CredentialFileError(f"unterminated quoted value in {path}:{line_number}")
    return value[1:-1]


def _quote(value: str) -> str:
    if value and all(character.isalnum() or character in "._-:/" for character in value):
        return value
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def _check_permissions(path: Path) -> None:
    try:
        mode = stat.S_IMODE(path.stat().st_mode)
    except FileNotFoundError:
        return
    if mode & (stat.S_IRWXG | stat.S_IRWXO):
        raise CredentialFileError(
            f"credential file must not be readable or writable by group or others: {path}"
        )


def _write_environment(path: Path, values: dict[str, str]) -> None:
    _check_permissions(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    lines = [f"{key}={_quote(value)}" for key, value in sorted(values.items())]
    content = "\n".join(lines) + "\n"
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", dir=path.parent, text=True
    )
    temporary_path = Path(temporary_name)
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(content)
        temporary_path.replace(path)
    except BaseException:
        temporary_path.unlink(missing_ok=True)
        raise


class EncryptedFileTokenStore:
    """Refresh-token storage encrypted in an account's local credential file."""

    def __init__(self, account_id: str, path: Path, keyring_store: TokenStore) -> None:
        self.account_id = account_id
        self.path = path.expanduser().resolve()
        self.keyring_store = keyring_store

    def get(self, account_id: str) -> str | None:
        self._check_account(account_id)
        if not self.path.exists():
            return None
        encrypted = read_environment(self.path).get(REFRESH_TOKEN_KEY)
        if not encrypted:
            return None
        key = self.keyring_store.get(self._key_account())
        if key is None:
            raise CredentialFileError(
                f"encryption key for {self.path} is not available in the system keyring"
            )
        try:
            return Fernet(key.encode("ascii")).decrypt(encrypted.encode("ascii")).decode("utf-8")
        except (InvalidToken, UnicodeDecodeError, ValueError) as exc:
            raise CredentialFileError(f"cannot decrypt refresh token in {self.path}") from exc

    def set(self, account_id: str, refresh_token: str) -> None:
        self._check_account(account_id)
        values = read_environment(self.path)
        key = self.keyring_store.get(self._key_account())
        if key is None:
            key = Fernet.generate_key().decode("ascii")
            self.keyring_store.set(self._key_account(), key)
        values[REFRESH_TOKEN_KEY] = (
            Fernet(key.encode("ascii")).encrypt(refresh_token.encode("utf-8")).decode("ascii")
        )
        _write_environment(self.path, values)

    def delete(self, account_id: str) -> bool:
        self._check_account(account_id)
        if not self.path.exists():
            return False
        values = read_environment(self.path)
        if REFRESH_TOKEN_KEY not in values:
            return False
        del values[REFRESH_TOKEN_KEY]
        _write_environment(self.path, values)
        self.keyring_store.delete(self._key_account())
        return True

    def _key_account(self) -> str:
        digest = hashlib.sha256(str(self.path).encode("utf-8")).hexdigest()
        return f"credential-file-key-{digest}"

    def _check_account(self, account_id: str) -> None:
        if account_id != self.account_id:
            raise ValueError("credential store account does not match requested account")
