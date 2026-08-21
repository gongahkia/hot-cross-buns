"""Lazy construction of CLI application dependencies."""

from __future__ import annotations

import json
import os
from collections.abc import Callable
from functools import cached_property
from pathlib import Path
from typing import Any

from .application import ApplicationService
from .auth import GoogleAuthenticator, TokenStore
from .config import Config, ConfigError, load
from .errors import AuthenticationRequired, ConfigurationError, NotFoundError
from .google_client import GoogleApiClient, GoogleGateway
from .paths import AppPaths
from .storage import Storage
from .sync import SyncEngine

GatewayFactory = Callable[[Any], GoogleGateway]


class Runtime:
    """Dependency container which keeps all Google construction behind ``sync``/auth."""

    def __init__(
        self,
        paths: AppPaths | None = None,
        *,
        environ: dict[str, str] | None = None,
        token_store: TokenStore | None = None,
        gateway_factory: GatewayFactory | None = None,
    ) -> None:
        self.paths = paths or AppPaths.discover()
        self.environ = os.environ if environ is None else environ
        self._token_store = token_store
        self._gateway_factory = gateway_factory

    @cached_property
    def config(self) -> Config:
        try:
            return load(self.paths.config_file)
        except ConfigError as exc:
            raise ConfigurationError(str(exc)) from exc

    @cached_property
    def storage(self) -> Storage:
        try:
            return Storage(self.paths.database_file)
        except Exception as exc:
            raise ConfigurationError(f"cannot open local database: {exc}") from exc

    @cached_property
    def application(self) -> ApplicationService:
        return ApplicationService(self.storage)

    @cached_property
    def token_store(self) -> TokenStore:
        return self._token_store or TokenStore()

    def account_id(self, explicit: str | None = None) -> str:
        selected = (
            explicit
            or self.environ.get("HCB_ACCOUNT")
            or self.config.preferences.default_account_id
        )
        if selected:
            if self.storage.get_account(selected) is None:
                raise NotFoundError(f"Account {selected!r} does not exist")
            return selected
        accounts = self.storage.list_accounts()
        if len(accounts) == 1:
            return accounts[0].id
        if not accounts:
            raise AuthenticationRequired("no account is configured", hint="Run `hcb auth connect`.")
        raise ConfigurationError(
            "multiple accounts are configured; select one with --account, HCB_ACCOUNT, "
            "or preferences.default_account_id"
        )

    def _client_config(self) -> dict[str, Any]:
        raw = self.environ.get("HCB_GOOGLE_CLIENT_CONFIG")
        if not raw:
            raise ConfigurationError(
                "HCB_GOOGLE_CLIENT_CONFIG must name a Google OAuth client JSON file"
            )
        try:
            value = json.loads(Path(raw).read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ConfigurationError(
                f"cannot read Google OAuth client configuration: {exc}"
            ) from exc
        if not isinstance(value, dict):
            raise ConfigurationError("Google OAuth client configuration must be an object")
        return value

    @cached_property
    def authenticator(self) -> GoogleAuthenticator:
        try:
            return GoogleAuthenticator(self._client_config(), self.token_store)
        except ValueError as exc:
            raise ConfigurationError(str(exc)) from exc

    def sync_engine(self, account_id: str) -> SyncEngine:
        try:
            credentials = self.authenticator.credentials(account_id)
        except LookupError as exc:
            raise AuthenticationRequired(str(exc), hint="Run `hcb auth connect`.") from exc
        gateway = (
            self._gateway_factory(credentials)
            if self._gateway_factory is not None
            else GoogleApiClient(credentials)
        )
        return SyncEngine(self.storage, gateway)

    def close(self) -> None:
        if "storage" in self.__dict__:
            self.storage.close()
