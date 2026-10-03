#!/usr/bin/env python3
"""Generate or verify the checked-in architecture PNG with diagrams-as-code."""

from __future__ import annotations

import argparse
import filecmp
import shutil
import tempfile
from pathlib import Path

from diagrams import Cluster, Diagram, Edge
from diagrams.custom import Custom
from diagrams.generic.storage import Storage
from diagrams.onprem.client import Client, User
from diagrams.programming.framework import React
from diagrams.programming.language import TypeScript

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "docs/assets/hot-cross-buns-architecture.png"
ELECTRON_LOGO = ROOT / "docs/assets/architecture-icons/electron.png"
GOOGLE_CLOUD_LOGO = ROOT / "docs/assets/architecture-icons/google-cloud.png"
SQLITE_LOGO = ROOT / "docs/assets/architecture-icons/sqlite.png"
GOOGLE_CALENDAR_LOGO = ROOT / "src/renderer/src/assets/google-calendar.png"
GOOGLE_TASKS_LOGO = ROOT / "src/renderer/src/assets/google-tasks.png"


def icon(label: str, path: Path, *, width: str | None = None, height: str | None = None) -> Custom:
    """Create a custom-icon node, failing clearly when a checked-in asset is absent."""
    if not path.is_file():
        raise FileNotFoundError(f"Missing architecture icon: {path.relative_to(ROOT)}")

    node = Custom(label, str(path))
    if width is not None:
        node._attrs["width"] = width
    if height is not None:
        node._attrs["height"] = height
    return node


def render(target: Path) -> None:
    """Render a clean, left-to-right view with all cross-boundary paths in one lane."""
    node_style = {
        "fontname": "Arial",
        "fontsize": "20",
        "fontcolor": "#202124",
        "margin": "0.18,0.11",
        "penwidth": "1.3",
    }
    with Diagram(
        "Hot Cross Buns current runtime architecture",
        filename=str(target.with_suffix("")),
        direction="LR",
        curvestyle="ortho",
        outformat="png",
        show=False,
        graph_attr={
            "bgcolor": "#ffffff",
            "pad": "0.45",
            "nodesep": "0.75",
            "ranksep": "1.15",
            "dpi": "180",
            "splines": "ortho",
            "fontname": "Arial",
            "fontcolor": "#202124",
            "fontsize": "26",
            "labelloc": "t",
        },
        node_attr=node_style,
        edge_attr={
            "fontname": "Arial",
            "fontsize": "16",
            "fontcolor": "#3c4043",
            "color": "#5f6368",
            "penwidth": "1.25",
        },
    ):
        user = User("User")

        with Cluster(
            "Hot Cross Buns desktop application",
            graph_attr={
                "bgcolor": "#f8fbff",
                "pencolor": "#8ab4f8",
                "fontname": "Arial",
                "fontsize": "22",
                "fontcolor": "#174ea6",
                "margin": "24",
            },
        ):
            renderer = React("React renderer\n(unprivileged UI)")
            preload = TypeScript("Hardened preload\nwindow.hcb bridge")
            ipc = icon("Electron main\nvalidated IPC", ELECTRON_LOGO, width="1.45", height="1.45")
            core = TypeScript("CoreStore and\napp services")
            sync = TypeScript("Google OAuth\nand sync services")
            native = icon("Native desktop\nadapters", ELECTRON_LOGO, width="1.45", height="1.45")

        with Cluster(
            "Local device",
            graph_attr={
                "bgcolor": "#f7fbf7",
                "pencolor": "#81c995",
                "fontname": "Arial",
                "fontsize": "22",
                "fontcolor": "#137333",
                "margin": "24",
            },
        ):
            sqlite = icon("SQLite local cache\nsettings and outbox", SQLITE_LOGO, width="2.2", height="1.05")
            credentials = Storage("Encrypted OS credentials\nElectron safeStorage")

        browser = Client("Default browser\nOAuth consent")

        with Cluster(
            "Google services",
            graph_attr={
                "bgcolor": "#fefaf3",
                "pencolor": "#fdd663",
                "fontname": "Arial",
                "fontsize": "22",
                "fontcolor": "#a15c00",
                "margin": "24",
            },
        ):
            cloud = icon(
                "Google Cloud Platform\nOAuth and Google APIs",
                GOOGLE_CLOUD_LOGO,
                width="5.0",
                height="0.82",
            )
            calendar = icon("Google Calendar\nCalendar API", GOOGLE_CALENDAR_LOGO)
            tasks = icon("Google Tasks\nTasks API", GOOGLE_TASKS_LOGO)

        # Main path: the renderer stays unprivileged and reaches services through
        # the hardened preload bridge and validated Electron IPC boundary.
        user >> Edge(label="input") >> renderer
        renderer >> Edge(label="typed window.hcb calls") >> preload
        preload >> Edge(label="validated IPC") >> ipc
        ipc >> Edge(label="allow-listed dispatch") >> core
        core >> Edge(label="sync work") >> sync

        # Local persistence fans out below the main path; Google integration is a
        # separate right-hand lane, so its edges neither overlap nor cross.
        core >> Edge(label="cache, settings, outbox", color="#5f7f65") >> sqlite
        core >> Edge(label="encrypted credentials", color="#5f7f65") >> credentials
        core >> Edge(label="desktop integration", color="#5f7f65") >> native
        sync >> Edge(label="explicit user consent", color="#8b6b2e") >> browser
        browser >> Edge(label="OAuth consent", color="#8b6b2e") >> cloud
        sync >> Edge(label="direct OAuth and API requests") >> cloud
        cloud >> Edge(label="Calendar API") >> calendar
        cloud >> Edge(label="Tasks API") >> tasks


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="fail when the checked-in PNG is stale")
    args = parser.parse_args()

    with tempfile.TemporaryDirectory(dir=ROOT, prefix="architecture-diagram-") as directory:
        candidate = Path(directory) / OUTPUT.name
        render(candidate)
        if args.check:
            if not OUTPUT.is_file() or not filecmp.cmp(candidate, OUTPUT, shallow=False):
                raise SystemExit("Architecture diagram is stale. Run: corepack pnpm architecture:generate")
            print("Architecture diagram is current.")
            return

        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(candidate, OUTPUT)
        print(f"Generated {OUTPUT.relative_to(ROOT)} with diagrams-as-code.")


if __name__ == "__main__":
    main()
