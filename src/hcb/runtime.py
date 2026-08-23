"""Lazy construction of CLI application dependencies."""

from __future__ import annotations

import os
from collections.abc import Callable
from dataclasses import replace
from functools import cached_property
from pathlib import Path
from typing import Any

from .application import ApplicationService
from .auth import GoogleAuthenticator, TokenStore
from .config import Config, ConfigError, Theme, ThemeColors, load, save
from .credentials import CredentialFileError, EncryptedFileTokenStore, load_client_config
from .errors import AuthenticationRequired, ConfigurationError, NotFoundError, StorageError
from .google_client import GoogleApiClient, GoogleGateway
from .models import Account
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
        credential_file: Path | None = None,
    ) -> None:
        self.paths = paths or AppPaths.discover()
        self.environ = os.environ if environ is None else environ
        self._token_store = token_store
        self._gateway_factory = gateway_factory
        self.credential_file_override = credential_file

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
            raise StorageError(f"cannot open local database: {exc}") from exc

    @cached_property
    def application(self) -> ApplicationService:
        return ApplicationService(self.storage)

    @cached_property
    def keyring_store(self) -> TokenStore:
        return self._token_store or TokenStore()

    def credential_file(self, account_id: str) -> Path:
        """Resolve one credential file per account, with explicit process overrides."""
        configured = self.credential_file_override or self.environ.get("HCB_ENV_FILE")
        if configured:
            return Path(configured).expanduser()
        return self.paths.config_dir / "accounts" / f"{account_id}.env"

    def token_store_for(self, account_id: str) -> EncryptedFileTokenStore:
        return EncryptedFileTokenStore(
            account_id, self.credential_file(account_id), self.keyring_store
        )

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

    def _client_config(self, account_id: str) -> dict[str, Any]:
        try:
            return load_client_config(self.credential_file(account_id))
        except (OSError, CredentialFileError) as exc:
            raise ConfigurationError(str(exc)) from exc

    def save_onboarding(
        self,
        *,
        account_id: str,
        email: str,
        time_zone: str,
        reminders_enabled: bool,
    ) -> None:
        if not account_id.strip() or any(character.isspace() for character in account_id):
            raise ValueError("account identifier is required and cannot contain whitespace")
        if "@" not in email or email.strip() != email:
            raise ValueError("a valid account email is required")
        preferences = replace(
            self.config.preferences,
            default_account_id=account_id,
            time_zone=time_zone,
            reminders_enabled=reminders_enabled,
        )
        updated = replace(
            self.config,
            preferences=preferences,
        )
        # Constructing Preferences validates the IANA zone before any state is written.
        save(updated, self.paths.config_file)
        with self.storage.transaction():
            self.storage.upsert_account(Account(account_id, email))
        self.__dict__["config"] = updated

    def authenticator(self, account_id: str) -> GoogleAuthenticator:
        try:
            return GoogleAuthenticator(
                self._client_config(account_id), self.token_store_for(account_id)
            )
        except ValueError as exc:
            raise ConfigurationError(str(exc)) from exc

    def sync_engine(self, account_id: str) -> SyncEngine:
        try:
            credentials = self.authenticator(account_id).credentials(account_id)
        except (LookupError, CredentialFileError) as exc:
            raise AuthenticationRequired(str(exc), hint="Run `hcb auth connect`.") from exc
        gateway = (
            self._gateway_factory(credentials)
            if self._gateway_factory is not None
            else GoogleApiClient(credentials)
        )
        return SyncEngine(self.storage, gateway)

    def disconnect(self, account_id: str, *, reset_local_data: bool = False) -> bool:
        """Remove local credentials without requiring a client configuration to be readable."""
        removed = self.token_store_for(account_id).delete(account_id)
        if reset_local_data:
            with self.storage.transaction():
                self.storage.delete_account(account_id)
        return removed

    def update_tui_settings(
        self,
        *,
        profile: str,
        density: str,
        borders: str,
        focus: str,
        mouse: bool,
        loader: str,
        week_starts_on: int,
        colors: ThemeColors,
    ) -> Config:
        """Persist interactive presentation settings through the runtime boundary."""
        current = self.config
        updated = replace(
            current,
            preferences=replace(current.preferences, week_starts_on=week_starts_on),
            theme=replace(
                current.theme,
                profile=profile,
                preset=None,
                density=density,
                borders=borders,
                focus=focus,
                mouse=mouse,
                loader=loader,
                colors=colors,
            ),
        )
        save(updated, self.paths.config_file)
        self.__dict__["config"] = updated
        return updated

    def update_theme(self, theme: Theme) -> Config:
        """Persist a complete visual theme selected by the CLI or a custom file."""
        updated = replace(self.config, theme=theme)
        save(updated, self.paths.config_file)
        self.__dict__["config"] = updated
        return updated

    def close(self) -> None:
        if "storage" in self.__dict__:
            self.storage.close()
