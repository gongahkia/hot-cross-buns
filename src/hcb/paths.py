"""Platform-appropriate application paths."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from platformdirs import PlatformDirs


@dataclass(frozen=True, slots=True)
class AppPaths:
    config_dir: Path
    data_dir: Path
    cache_dir: Path

    @classmethod
    def discover(cls) -> AppPaths:
        dirs = PlatformDirs("hcb", "hot-cross-buns", ensure_exists=False)
        return cls(Path(dirs.user_config_dir), Path(dirs.user_data_dir), Path(dirs.user_cache_dir))

    @property
    def config_file(self) -> Path:
        return self.config_dir / "config.toml"

    @property
    def database_file(self) -> Path:
        return self.data_dir / "hcb.sqlite3"

    def ensure(self) -> None:
        for directory in (self.config_dir, self.data_dir, self.cache_dir):
            directory.mkdir(parents=True, exist_ok=True)
