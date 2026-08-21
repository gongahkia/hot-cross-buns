from pathlib import Path

import pytest

from hcb.auth import GoogleAuthenticator, TokenStore
from hcb.models import Account
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


def test_disconnect_removes_secret_and_partition(tmp_path: Path) -> None:
    tokens = TokenStore(FakeKeyring())
    tokens.set("account", "refresh")
    auth = GoogleAuthenticator(CLIENT_CONFIG, tokens)
    with Storage(tmp_path / "db.sqlite") as store:
        store.upsert_account(Account("account", "person@example.test"))
        assert auth.disconnect("account", storage=store)
        assert store.get_account("account") is None
    assert tokens.get("account") is None


def test_invalid_client_and_missing_credentials() -> None:
    with pytest.raises(ValueError):
        GoogleAuthenticator({}, TokenStore(FakeKeyring()))
    auth = GoogleAuthenticator(CLIENT_CONFIG, TokenStore(FakeKeyring()))
    with pytest.raises(LookupError):
        auth.credentials("missing")
