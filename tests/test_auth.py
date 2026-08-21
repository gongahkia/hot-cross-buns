import json
from pathlib import Path

import pytest

from hcb.auth import GoogleAuthenticator, TokenStore
from hcb.models import Account
from hcb.paths import AppPaths
from hcb.runtime import Runtime
from hcb.storage import Storage


class FakeKeyring:
    def __init__(self) -> None:
        self.values: dict[tuple[str, str], str] = {}

    def get_password(self, service_name: str, username: str) -> str | None:
        return self.values.get((service_name, username))

    def set_password(self, service_name: str, username: str, password: str) -> None:
        self.values[(service_name, username)] = password

    def delete_password(self, service_name: str, username: str) -> None:
        del self.values[(service_name, username)]


CLIENT_CONFIG = {
    "installed": {
        "client_id": "client-id.apps.googleusercontent.com",
        "client_secret": "not-a-real-secret",
        "token_uri": "https://oauth2.googleapis.com/token",
        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
        "redirect_uris": ["http://localhost"],
    }
}


def test_token_store_round_trip_and_idempotent_delete() -> None:
    tokens = TokenStore(FakeKeyring())
    assert tokens.get("account") is None
    tokens.set("account", "refresh")
    assert tokens.get("account") == "refresh"
    assert tokens.delete("account")
    assert not tokens.delete("account")
    with pytest.raises(ValueError):
        tokens.set("account", "")


def test_credentials_are_built_without_network() -> None:
    tokens = TokenStore(FakeKeyring())
    tokens.set("account", "refresh")
    credentials = GoogleAuthenticator(CLIENT_CONFIG, tokens).credentials("account")
    assert credentials.refresh_token == "refresh"
    assert credentials.client_id == "client-id.apps.googleusercontent.com"


def test_disconnect_retains_cache_and_explicit_reset_removes_it(tmp_path: Path) -> None:
    tokens = TokenStore(FakeKeyring())
    tokens.set("account", "refresh")
    auth = GoogleAuthenticator(CLIENT_CONFIG, tokens)
    with Storage(tmp_path / "db.sqlite") as store:
        store.upsert_account(Account("account", "person@example.test"))
        assert auth.disconnect("account", storage=store)
        assert store.get_account("account") is not None
        auth.disconnect("account", storage=store, reset_local_data=True)
        assert store.get_account("account") is None
    assert tokens.get("account") is None


def test_invalid_client_and_missing_credentials() -> None:
    with pytest.raises(ValueError):
        GoogleAuthenticator({}, TokenStore(FakeKeyring()))
    auth = GoogleAuthenticator(CLIENT_CONFIG, TokenStore(FakeKeyring()))
    with pytest.raises(LookupError):
        auth.credentials("missing")


def test_diagnostics_config_and_sqlite_dump_never_contain_credentials(
    tmp_path: Path,
) -> None:
    refresh_token = "refresh-token-sentinel-never-export"
    access_token = "access-token-sentinel-never-export"
    backend = FakeKeyring()
    tokens = TokenStore(backend)
    tokens.set("account", refresh_token)
    paths = AppPaths(tmp_path / "config", tmp_path / "data", tmp_path / "cache")
    client_file = tmp_path / "desktop-client.json"
    client_file.write_text(json.dumps(CLIENT_CONFIG))
    runtime = Runtime(paths, environ={}, token_store=tokens)
    runtime.save_onboarding(
        client_json=str(client_file),
        account_id="account",
        email="redacted@example.test",
        time_zone="UTC",
        theme="mono",
        reminders_enabled=False,
    )

    diagnostics = json.dumps(runtime.application.diagnostics(), sort_keys=True)
    config_text = paths.config_file.read_text()
    sqlite_dump = "\n".join(runtime.storage.connection.iterdump())
    combined = diagnostics + config_text + sqlite_dump
    assert refresh_token not in combined
    assert access_token not in combined
    assert "client_secret" not in config_text
    assert "redacted@example.test" not in diagnostics
    runtime.close()
