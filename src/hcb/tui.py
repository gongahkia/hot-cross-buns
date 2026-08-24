"""Textual workspace for the local-first HCB application."""

from __future__ import annotations

import calendar
import json
import re
import shlex
import tempfile
import webbrowser
from collections.abc import Callable
from dataclasses import asdict
from datetime import UTC, date, datetime, timedelta
from html.parser import HTMLParser
from pathlib import Path
from threading import Event as ThreadEvent
from threading import Lock
from typing import ClassVar, Literal, cast
from urllib.parse import urlparse
from zoneinfo import ZoneInfo, available_timezones

from rich._emoji_codes import EMOJI as RICH_EMOJI
from rich.style import Style
from rich.text import Text
from textual import events, work
from textual.app import App, ComposeResult, SuspendNotSupported
from textual.binding import Binding
from textual.containers import Horizontal, Vertical
from textual.theme import Theme as TextualTheme
from textual.widgets import (
    Button,
    Footer,
    ListView,
    Static,
    TextArea,
)
from textual.widgets import (
    Input as TextualInput,
)

from .application import (
    BatchActionPreview,
    BatchMovePreview,
    ResponseStatus,
    SearchResult,
    TimeSlot,
)
from .config import Config, ConfigError, ThemeColors, load
from .environment import LocalEnvironment, detect_local_environment
from .errors import AuthenticationRequired, ConfigurationError, HcbError
from .loaders import LOADER_PRESETS
from .models import DateTimeKind, DriveFile, Event, EventDateTime, Task, TaskStatus
from .runtime import Runtime
from .storage import Storage
from .themes import preset, presets

SURFACES = ("Tasks", "Notes", "Agenda", "Day", "Week", "Month")
MIN_SIDEBAR_WIDTH = 22
MIN_CENTER_WIDTH = 28
MIN_INSPECTOR_WIDTH = 24
SPLITTER_WIDTH = 1
PALETTE_COMMANDS = (
    ("Create item", "create"),
    ("Sync now", "sync"),
    ("Refresh recurring instances", "refresh-instances"),
    ("Find a time", "find-time"),
    ("Calendars", "calendars"),
    ("Settings", "settings"),
    ("Doctor", "doctor"),
    ("Bulk actions", "bulk"),
    ("Schedule task", "schedule"),
    ("Import", "import"),
    ("Conflicts", "conflicts"),
    ("First-run setup", "onboarding"),
)

PROFILE_OPTIONS = (
    ("Terminal", "terminal"),
    ("Dark", "dark"),
    ("Light", "light"),
)
DENSITY_OPTIONS = (
    ("Comfortable", "comfortable"),
    ("Compact", "compact"),
)
BORDER_OPTIONS = (
    ("ASCII", "ascii"),
    ("Unicode", "unicode"),
)
FOCUS_OPTIONS = (
    ("ASCII", "ascii"),
    ("Underline", "underline"),
    ("Reverse", "reverse"),
)
BOOLEAN_OPTIONS = (
    ("Enabled", "true"),
    ("Disabled", "false"),
)
WEEK_START_OPTIONS = (
    ("Monday", "0"),
    ("Tuesday", "1"),
    ("Wednesday", "2"),
    ("Thursday", "3"),
    ("Friday", "4"),
    ("Saturday", "5"),
    ("Sunday", "6"),
)
DATE_TIME_FORMAT_OPTIONS = (
    ("Friendly · 26 May 2026, 7:23pm", "friendly"),
    ("24-hour · 26 May 2026, 19:23", "friendly_24h"),
    ("ISO 8601 (with seconds)", "iso"),
)
CURRENT_THEME_VALUE = "__current_theme__"
TIME_ZONE_OPTIONS = tuple((time_zone, time_zone) for time_zone in sorted(available_timezones()))
DUE_DAY_OPTIONS = tuple((f"{day:02d}", str(day)) for day in range(1, 32))
DUE_MONTH_OPTIONS = tuple((calendar.month_name[month], str(month)) for month in range(1, 13))

_EMOJI_QUERY = re.compile(r":([A-Za-z0-9_+\-]+)$")
_EMOJI_SUGGESTION_LIMIT = 8
_EMOJI_NAMES = tuple(sorted(RICH_EMOJI))
_URL_PATTERN = re.compile(r"https?://[^\s<>'\"]+")
_HTML_TAG_PATTERN = re.compile(r"</?[A-Za-z][^>]*>")
_MARKDOWN_HEADING_PATTERN = re.compile(r"^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+)?$")
_MARKDOWN_LIST_PATTERN = re.compile(r"^(\s*)(?:[-+*]|\d+[.)])\s+(.*)$")
_MARKDOWN_QUOTE_PATTERN = re.compile(r"^\s*>\s?(.*)$")
_INLINE_MARKDOWN_PATTERN = re.compile(
    r"(?P<link>\[(?P<link_label>[^\]\n]+)\]\((?P<link_url>[^)\s]+)\))"
    r"|(?P<bold_asterisk>\*\*(?P<bold_asterisk_text>[^*\n]+)\*\*)"
    r"|(?P<bold_underscore>__(?P<bold_underscore_text>[^_\n]+)__)"
    r"|(?P<code>`(?P<code_text>[^`\n]+)`)"
)
_ITALIC_MARKDOWN_PATTERN = re.compile(
    r"(?P<asterisk>(?<!\*)\*(?P<asterisk_text>[^*\n]+)\*(?!\*))"
    r"|(?P<underscore>(?<!\w)_(?P<underscore_text>[^_\n]+)_(?!\w))"
)


def emoji_suggestions(text: str, cursor: int) -> tuple[int, tuple[tuple[str, str], ...]] | None:
    """Return the active ``:emoji`` token and its Rich-backed prefix matches."""
    match = _EMOJI_QUERY.search(text[: max(0, min(cursor, len(text)))])
    if match is None:
        return None
    query = match.group(1).casefold()
    candidates = tuple(
        (name, RICH_EMOJI[name]) for name in _EMOJI_NAMES if name.casefold().startswith(query)
    )[:_EMOJI_SUGGESTION_LIMIT]
    return (match.start(), candidates) if candidates else None


def is_web_url(value: str) -> bool:
    """Return whether a URL is safe to open in the user's browser."""
    parsed = urlparse(value)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def linkify_urls(value: str | Text) -> Text:
    """Underline and attach click targets to every safe web URL in displayed text."""
    text = value.copy() if isinstance(value, Text) else Text(value)
    for match in _URL_PATTERN.finditer(text.plain):
        url = match.group().rstrip(".,;:!?")
        while url.endswith(")") and url.count("(") < url.count(")"):
            url = url[:-1]
        if url and is_web_url(url):
            text.stylize(Style(link=url, underline=True), match.start(), match.start() + len(url))
    return text


class _InspectorHtmlParser(HTMLParser):
    """Turn a safe, readable HTML subset into Markdown before Rich rendering."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.links: list[str | None] = []
        self.suppressed_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.casefold()
        if tag in {"script", "style"}:
            self.suppressed_depth += 1
            return
        if self.suppressed_depth:
            return
        attributes = {key.casefold(): value for key, value in attrs}
        if tag in {"p", "div", "section", "article", "ul", "ol"}:
            self.parts.append("\n\n")
        elif tag == "br":
            self.parts.append("\n")
        elif tag in {"h1", "h2", "h3", "h4", "h5", "h6"}:
            self.parts.append(f"\n\n{'#' * int(tag[1])} ")
        elif tag == "li":
            self.parts.append("\n- ")
        elif tag == "blockquote":
            self.parts.append("\n\n> ")
        elif tag == "hr":
            self.parts.append("\n\n---\n\n")
        elif tag in {"b", "strong"}:
            self.parts.append("**")
        elif tag in {"i", "em"}:
            self.parts.append("_")
        elif tag in {"code", "kbd"}:
            self.parts.append("`")
        elif tag == "pre":
            self.parts.append("\n\n```\n")
        elif tag == "a":
            href = attributes.get("href")
            target = href if isinstance(href, str) and is_web_url(href) else None
            self.links.append(target)
            if target is not None:
                self.parts.append("[")
        elif tag == "img":
            alt = attributes.get("alt")
            if isinstance(alt, str):
                self.parts.append(alt)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)
        self.handle_endtag(tag)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.casefold()
        if tag in {"script", "style"}:
            self.suppressed_depth = max(0, self.suppressed_depth - 1)
            return
        if self.suppressed_depth:
            return
        if tag in {"p", "div", "section", "article", "h1", "h2", "h3", "h4", "h5", "h6"}:
            self.parts.append("\n\n")
        elif tag == "li":
            self.parts.append("\n")
        elif tag == "blockquote":
            self.parts.append("\n\n")
        elif tag in {"b", "strong"}:
            self.parts.append("**")
        elif tag in {"i", "em"}:
            self.parts.append("_")
        elif tag in {"code", "kbd"}:
            self.parts.append("`")
        elif tag == "pre":
            self.parts.append("\n```\n\n")
        elif tag == "a" and self.links:
            target = self.links.pop()
            if target is not None:
                self.parts.append(f"]({target})")

    def handle_data(self, data: str) -> None:
        if not self.suppressed_depth:
            self.parts.append(data)

    def markdown(self) -> str:
        return re.sub(r"\n{3,}", "\n\n", "".join(self.parts)).strip()


def _html_to_markdown(value: str) -> str:
    if not _HTML_TAG_PATTERN.search(value):
        return value
    parser = _InspectorHtmlParser()
    parser.feed(value)
    parser.close()
    return parser.markdown()


def _render_markdown_inline(value: str) -> Text:
    """Render links, bold, italics, and code without interpreting terminal markup."""
    result = Text()
    position = 0
    for match in _INLINE_MARKDOWN_PATTERN.finditer(value):
        result.append(value[position : match.start()])
        if match.group("link") is not None:
            label = _render_markdown_inline(match.group("link_label"))
            url = match.group("link_url")
            if is_web_url(url):
                label.stylize(Style(link=url, underline=True), 0, len(label))
            result.append_text(label)
        elif match.group("bold_asterisk") is not None:
            bold = _render_markdown_inline(match.group("bold_asterisk_text"))
            bold.stylize("bold", 0, len(bold))
            result.append_text(bold)
        elif match.group("bold_underscore") is not None:
            bold = _render_markdown_inline(match.group("bold_underscore_text"))
            bold.stylize("bold", 0, len(bold))
            result.append_text(bold)
        else:
            code = Text(match.group("code_text"))
            code.stylize(Style(reverse=True), 0, len(code))
            result.append_text(code)
        position = match.end()
    result.append(value[position:])

    rendered = Text()
    position = 0
    for match in _ITALIC_MARKDOWN_PATTERN.finditer(result.plain):
        rendered.append_text(result[position : match.start()])
        italic = Text(match.group("asterisk_text") or match.group("underscore_text") or "")
        italic.stylize("italic", 0, len(italic))
        rendered.append_text(italic)
        position = match.end()
    rendered.append_text(result[position:])
    return rendered


def render_inspector_markup(value: str) -> Text:
    """Render the supported Markdown and HTML subset used by Google descriptions."""
    source = _html_to_markdown(value)
    rendered = Text()
    lines = source.splitlines() or [""]
    for index, line in enumerate(lines):
        heading = _MARKDOWN_HEADING_PATTERN.match(line)
        list_item = _MARKDOWN_LIST_PATTERN.match(line)
        quote = _MARKDOWN_QUOTE_PATTERN.match(line)
        if heading is not None:
            body = _render_markdown_inline(heading.group(2))
            body.stylize(Style(bold=True, underline=len(heading.group(1)) <= 2), 0, len(body))
            rendered.append_text(body)
        elif list_item is not None:
            rendered.append(list_item.group(1) + "• ")
            rendered.append_text(_render_markdown_inline(list_item.group(2)))
        elif quote is not None:
            body = _render_markdown_inline(quote.group(1))
            body.stylize("dim", 0, len(body))
            rendered.append_text(body)
        else:
            rendered.append_text(_render_markdown_inline(line))
        if index < len(lines) - 1:
            rendered.append("\n")
    return linkify_urls(rendered)


class HcbApp(App[None]):
    """Configurable, cached terminal workspace."""

    CSS_PATH = "tui.tcss"
    TITLE = "Hot Cross Buns"
    SUB_TITLE = "local-first tasks and calendar"
    BINDINGS: ClassVar[list[Binding | tuple[str, str] | tuple[str, str, str]]] = [
        Binding("q", "quit", "Quit"),
        Binding("/", "palette", "Command"),
        Binding("ctrl+p", "palette", "Command"),
        Binding("n", "create", "New"),
        Binding("e", "edit", "Edit"),
        Binding("space", "complete", "Complete"),
        Binding("d", "delete", "Delete"),
        Binding("r", "sync", "Sync"),
        Binding("g", "jump", "Date"),
        Binding("x", "mark", "Mark"),
        Binding("v", "rsvp", "RSVP"),
        Binding("u", "undo", "Undo"),
        Binding("ctrl+r", "redo", "Redo"),
        Binding("1", "surface('Tasks')", "Tasks", show=False),
        Binding("2", "surface('Notes')", "Notes", show=False),
        Binding("3", "surface('Agenda')", "Agenda", show=False),
        Binding("4", "surface('Day')", "Day", show=False),
        Binding("5", "surface('Week')", "Week", show=False),
        Binding("6", "surface('Month')", "Month", show=False),
        Binding("ctrl+alt+left", "resize_sidebar(-2)", "Narrow sidebar", show=False),
        Binding("ctrl+alt+right", "resize_sidebar(2)", "Widen sidebar", show=False),
        Binding("ctrl+alt+shift+left", "resize_inspector(2)", "Widen inspector", show=False),
        Binding("ctrl+alt+shift+right", "resize_inspector(-2)", "Narrow inspector", show=False),
    ]

    def __init__(
        self,
        runtime: Runtime | None = None,
        *,
        account: str | None = None,
        selected_date: date | None = None,
        editor_runner: EditorRunner | None = None,
        suspend: SuspendContext | None = None,
        url_opener: UrlOpener | None = None,
        local_environment: LocalEnvironment | None = None,
    ) -> None:
        super().__init__()
        self.runtime = runtime or Runtime()
        self.explicit_account = account
        self.account_id: str | None = None
        self.selected_date = selected_date or self._present_date()
        self.surface = "Tasks"
        self.cache = CachedWorkspace()
        self.selected: tuple[str, str] | None = None
        self.resource_filter: tuple[str, str] | None = None
        self.marked: set[str] = set()
        self.marked_events: set[str] = set()
        self._mini_month_days: dict[str, date] = {}
        self.sidebar_width = 27
        self.inspector_width = 32
        self._resize_target: Literal["sidebar", "inspector"] | None = None
        self._resize_handle: Static | None = None
        self._resize_anchor_x = 0
        self.loading_operation: str | None = None
        self._loading_screen: LoadingScreen | None = None
        self._sync_cancel = ThreadEvent()
        self._sync_lock = Lock()
        self._theme_revision = 0
        self._observed_config_marker: tuple[int, int] | None = None
        self._emoji_target: EmojiTarget | None = None
        self._emoji_token_start: int | None = None
        self._emoji_matches: tuple[tuple[str, str], ...] = ()
        self._emoji_selection = 0
        self._emoji_popup: EmojiCompletion | None = None
        self._emoji_popup_screen: object | None = None
        self._editor_runner = editor_runner or _run_editor
        self._editor_suspend = suspend or self.suspend
        self._url_opener = url_opener or _open_url
        self.local_environment = local_environment
        self._set_visual_state(self.runtime.config)

    def compose(self) -> ComposeResult:
        yield Static(id="topbar")
        yield Horizontal(
            *[Button(name, id=f"surface-{name.lower()}") for name in SURFACES],
            id="tabs",
        )
        with Horizontal(id="workspace"):
            with Vertical(id="sidebar"):
                with Vertical(id="mini-month"):
                    yield Static(id="mini-month-title")
                    yield Static(id="mini-month-weekdays")
                    for week in range(6):
                        with Horizontal(classes="mini-month-week"):
                            for weekday in range(7):
                                yield Button(
                                    "",
                                    id=f"mini-day-{week}-{weekday}",
                                    classes="mini-day",
                                )
                yield Static("Resources", classes="section-title")
                yield ListView(id="resources")
                yield Static(id="sync-state")
            yield Static(id="sidebar-resize", classes="column-resize-handle")
            with Vertical(id="center"):
                yield Static(id="surface-title")
                yield ListView(id="content")
            yield Static(id="inspector-resize", classes="column-resize-handle")
            with Vertical(id="inspector"):
                yield Static("Inspector", classes="section-title")
                yield Static("Select an item", id="inspection")
        yield Footer()

    def on_mount(self) -> None:
        self._apply_visual_config(self.runtime.config)
        self._observed_config_marker = self._config_marker()
        self.set_interval(0.5, self._reload_visual_config)
        self._bind_configured_keys()
        try:
            self.account_id = self.runtime.account_id(self.explicit_account)
        except AuthenticationRequired:
            self.account_id = None
        self.refresh_workspace()
        self._apply_column_widths()
        if self.account_id is None and not self.runtime.storage.list_accounts():
            self.call_after_refresh(
                lambda: self.push_screen(self._onboarding_screen(), self._onboarding_result)
            )

    def _set_visual_state(self, config: Config) -> None:
        forced_terminal = (
            self.runtime.environ.get("NO_COLOR") is not None
            or self.runtime.environ.get("TERM") == "dumb"
        )
        self.theme_mode = "mono" if forced_terminal else config.theme.profile
        self.density = config.theme.density
        self.border_style = "ascii" if forced_terminal else config.theme.borders
        self.focus_style = "ascii" if forced_terminal else config.theme.focus
        self.mouse_enabled = config.theme.mouse and not forced_terminal

    def _apply_visual_config(self, config: Config) -> None:
        self._set_visual_state(config)
        colors = config.theme.colors
        self._theme_revision += 1
        name = f"hcb-config-{self._theme_revision}"
        self.register_theme(
            TextualTheme(
                name=name,
                primary=colors.focus,
                secondary=colors.accent,
                accent=colors.accent,
                foreground=colors.text,
                background=colors.background,
                surface=colors.surface,
                panel=colors.panel,
                boost=colors.control,
                success=colors.success,
                warning=colors.warning,
                error=colors.danger,
                dark=self.theme_mode != "light",
                variables={
                    "text-muted": colors.muted,
                    "border": colors.border,
                    "border-blurred": colors.border,
                    "footer-background": colors.overlay,
                    "input-selection-background": colors.selection,
                    "screen-selection-background": colors.selection,
                },
            )
        )
        self.theme = name
        self.remove_class(
            "theme-terminal",
            "theme-dark",
            "theme-light",
            "theme-mono",
            "density-compact",
            "density-comfortable",
            "borders-ascii",
            "borders-unicode",
            "focus-ascii",
            "focus-underline",
            "focus-reverse",
            "ascii",
            "no-mouse",
        )
        self.add_class(
            f"theme-{self.theme_mode}",
            f"density-{self.density}",
            f"borders-{self.border_style}",
            f"focus-{self.focus_style}",
        )
        self.set_class(self.border_style == "ascii", "ascii")
        self.set_class(not self.mouse_enabled, "no-mouse")
        self.dark = self.theme_mode != "light"
        for text_area in self.query(TerminalTextArea):
            text_area.apply_terminal_theme()

    def _config_marker(self) -> tuple[int, int] | None:
        try:
            stat = self.runtime.paths.config_file.stat()
        except FileNotFoundError:
            return None
        return (stat.st_mtime_ns, stat.st_size)

    def _reload_visual_config(self) -> None:
        marker = self._config_marker()
        if marker == self._observed_config_marker:
            return
        self._observed_config_marker = marker
        try:
            config = load(self.runtime.paths.config_file)
        except ConfigError as exc:
            self.notify(f"config.json not applied: {exc}", severity="error")
            return
        self.runtime.__dict__["config"] = config
        self._apply_visual_config(config)
        self._render_chrome(refresh_resources=False)
        self._render_surface()
        self._render_inspector()
        self.notify("config.json settings reloaded")

    def _onboarding_result(self, result: dict[str, str] | None) -> None:
        if result is None:
            self.notify("Offline mode; setup can be reopened later")
            return
        reminders = result["reminders"].casefold()
        if reminders not in {"true", "false"}:
            self.notify("Reminders must be true or false", severity="error")
            self.push_screen(self._onboarding_screen(), self._onboarding_result)
            return
        try:
            self.runtime.save_onboarding(
                account_id=result["account_id"],
                email=result["email"],
                time_zone=result["time_zone"],
                reminders_enabled=reminders == "true",
                theme_preset=(
                    None if result["theme_preset"] == "terminal" else result["theme_preset"]
                ),
            )
        except ValueError as exc:
            self.notify(str(exc), severity="error")
            self.push_screen(self._onboarding_screen(), self._onboarding_result)
            return
        self.account_id = result["account_id"]
        if result["env_file"]:
            self.runtime.credential_file_override = Path(result["env_file"]).expanduser()
        self._apply_visual_config(self.runtime.config)
        self.refresh_workspace()
        if result["connect"] == "true":
            self.push_screen(
                ConfirmScreen(
                    "Open the browser and connect this Google account now?",
                    confirm_label="Connect",
                ),
                self._onboarding_connect_confirmed,
            )
        else:
            self.notify("Offline account created; Google remains disconnected")

    def _onboarding_screen(self) -> OnboardingScreen:
        return OnboardingScreen(self._local_environment())

    def _local_environment(self) -> LocalEnvironment:
        if self.local_environment is None:
            self.local_environment = detect_local_environment(self.runtime.environ)
        return self.local_environment

    def _onboarding_connect_confirmed(self, confirmed: bool | None) -> None:
        if not confirmed or self.account_id is None:
            self.notify("Google connection skipped; local cache remains available")
            return
        self.start_loading("Connecting to Google")
        self.connect_google()

    @work(thread=True, exclusive=True, group="auth")
    def connect_google(self) -> None:
        if self.account_id is None:
            return
        failure: Exception | None = None
        try:
            authenticator = self.runtime.authenticator(self.account_id)
            self.call_from_thread(self.update_loading, "Waiting for browser approval")
            authenticator.connect(self.account_id)
        except Exception as exc:
            failure = exc
        else:
            self.call_from_thread(self.notify, "Google connected; sync remains explicit")
        finally:
            self.call_from_thread(self.stop_loading)
        if failure is not None:
            self.call_from_thread(
                self._show_remote_failure,
                "Google connection",
                failure,
                self.account_id,
            )

    def _show_remote_failure(
        self, operation: str, error: Exception, account_id: str | None
    ) -> None:
        if account_id is not None and isinstance(
            error, (AuthenticationRequired, ConfigurationError)
        ):
            account = self.runtime.storage.get_account(account_id)
            email = account.email if account is not None else "YOUR_GOOGLE_EMAIL"
            self.push_screen(
                GoogleSetupScreen(
                    operation=operation,
                    account_id=account_id,
                    email=email,
                    credential_file=self.runtime.credential_file(account_id),
                    reason=error.message,
                )
            )
            return
        if isinstance(error, HcbError):
            message = f"{operation} failed: {error.message}"
            if error.hint:
                message += f" Next: {error.hint}"
        else:
            message = f"{operation} failed: {error}"
        self.notify(message, severity="error", timeout=15)

    def _bind_configured_keys(self) -> None:
        keys = self.runtime.config.keys
        for key, action in (
            (keys.quit, "quit"),
            (keys.search, "palette"),
            (keys.sync, "sync"),
            (keys.create, "create"),
            (keys.edit, "edit"),
            (keys.delete, "delete"),
            (keys.complete, "complete"),
        ):
            self.bind(key, action)

    def on_input_changed(self, event: TextualInput.Changed) -> None:
        if isinstance(event.input, Input):
            self.update_emoji_completion(event.input)

    def on_text_area_changed(self, event: TextArea.Changed) -> None:
        if isinstance(event.text_area, TerminalTextArea):
            self.update_emoji_completion(event.text_area)

    def update_emoji_completion(self, target: EmojiTarget) -> None:
        """Refresh suggestions for the focused editor's active colon token."""
        if self.focused is not target:
            self.dismiss_emoji_completion(target)
            return
        text, cursor = self._emoji_text_and_cursor(target)
        suggestion = emoji_suggestions(text, cursor)
        if suggestion is None:
            self.dismiss_emoji_completion(target)
            return
        token_start, matches = suggestion
        self._emoji_target = target
        self._emoji_token_start = token_start
        self._emoji_matches = matches
        self._emoji_selection = 0
        self._render_emoji_completion()

    def handle_emoji_key(self, target: EmojiTarget, event: events.Key) -> bool:
        """Consume navigation keys only while this editor owns an emoji menu."""
        if target is not self._emoji_target or not self._emoji_matches:
            return False
        if event.key == "up":
            self._emoji_selection = (self._emoji_selection - 1) % len(self._emoji_matches)
        elif event.key == "down":
            self._emoji_selection = (self._emoji_selection + 1) % len(self._emoji_matches)
        elif event.key in {"tab", "enter"}:
            self._accept_emoji_completion(target)
        elif event.key == "escape":
            self.dismiss_emoji_completion(target)
        else:
            return False
        event.stop()
        event.prevent_default()
        if event.key in {"up", "down"}:
            self._render_emoji_completion()
        return True

    def handle_external_editor_key(self, target: EmojiTarget, event: events.Key) -> bool:
        if event.key != self.runtime.config.keys.external_editor:
            return False
        event.stop()
        event.prevent_default()
        self.action_external_editor()
        return True

    def dismiss_emoji_completion(self, target: EmojiTarget | None = None) -> None:
        if target is not None and target is not self._emoji_target:
            return
        self._emoji_target = None
        self._emoji_token_start = None
        self._emoji_matches = ()
        self._emoji_selection = 0
        if self._emoji_popup is not None:
            self._emoji_popup.display = False

    def _render_emoji_completion(self) -> None:
        if not self._emoji_matches:
            return
        screen = self.screen
        if self._emoji_popup_screen is not screen:
            if self._emoji_popup is not None:
                self._emoji_popup.display = False
            self._emoji_popup = EmojiCompletion()
            self._emoji_popup_screen = screen
            screen.mount(self._emoji_popup)
        assert self._emoji_popup is not None
        self._emoji_popup.set_candidates(self._emoji_matches, self._emoji_selection)

    @staticmethod
    def _emoji_text_and_cursor(target: EmojiTarget) -> tuple[str, int]:
        if isinstance(target, Input):
            return target.value, target.cursor_position
        row, column = target.cursor_location
        offset = sum(
            len(target.document[index]) + len(target.document.newline) for index in range(row)
        )
        return target.text, offset + column

    @staticmethod
    def _text_area_location(target: TerminalTextArea, offset: int) -> tuple[int, int]:
        remaining = max(0, min(offset, len(target.text)))
        for row in range(target.document.line_count):
            length = len(target.document[row])
            if remaining <= length:
                return row, remaining
            remaining -= length
            if row < target.document.line_count - 1:
                remaining -= len(target.document.newline)
        return target.document.end

    def _accept_emoji_completion(self, target: EmojiTarget) -> None:
        if self._emoji_token_start is None or not self._emoji_matches:
            return
        token_start = self._emoji_token_start
        emoji = self._emoji_matches[self._emoji_selection][1]
        if isinstance(target, Input):
            target.replace(emoji, token_start, target.cursor_position)
            target.cursor_position = token_start + len(emoji)
        else:
            result = target.replace(
                emoji,
                self._text_area_location(target, token_start),
                target.cursor_location,
                maintain_selection_offset=False,
            )
            target.cursor_location = result.end_location
        self.dismiss_emoji_completion(target)

    def _editor_command(self) -> str:
        return self.runtime.environ.get("HCB_EDITOR") or self.runtime.config.preferences.editor

    def action_external_editor(self) -> None:
        target = self.focused
        if not isinstance(target, (Input, TerminalTextArea)):
            return
        self.dismiss_emoji_completion(target)
        temporary_path: Path | None = None
        try:
            command = shlex.split(self._editor_command())
            if not command:
                raise ValueError("external editor command is empty")
            source = target.value if isinstance(target, Input) else target.text
            with tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                prefix="hcb-",
                suffix=".txt",
                delete=False,
            ) as temporary:
                temporary.write(source)
                temporary_path = Path(temporary.name)
            with self._editor_suspend():
                return_code = self._editor_runner([*command, str(temporary_path)])
            if return_code != 0:
                self.notify(f"External editor exited with status {return_code}", severity="error")
                return
            edited = temporary_path.read_text(encoding="utf-8")
        except SuspendNotSupported:
            self.notify("External editor is unavailable in this environment", severity="error")
            return
        except (OSError, UnicodeError, ValueError) as exc:
            self.notify(f"External editor failed: {exc}", severity="error")
            return
        finally:
            if temporary_path is not None:
                temporary_path.unlink(missing_ok=True)
        if isinstance(target, Input):
            target.value = " ".join(edited.rstrip("\r\n").splitlines())
            target.cursor_position = len(target.value)
        else:
            target.load_text(edited)
            target.cursor_location = target.document.end

    def on_unmount(self) -> None:
        self.runtime.close()

    def on_mouse_down(self, event: events.MouseDown) -> None:
        if not self.mouse_enabled:
            event.stop()
            event.prevent_default()
            return
        if event.button != 1:
            return
        widget = event.widget
        if not isinstance(widget, Static):
            return
        targets: dict[str, Literal["sidebar", "inspector"]] = {
            "sidebar-resize": "sidebar",
            "inspector-resize": "inspector",
        }
        target = targets.get(widget.id or "")
        if target is None or not self._can_resize_columns():
            return
        self._resize_target = target
        self._resize_handle = widget
        self._resize_anchor_x = event.screen_x
        widget.capture_mouse()
        event.stop()
        event.prevent_default()

    def on_click(self, event: events.Click) -> None:
        """Open safe links and allow Ctrl/Cmd-click multi-selection in content rows."""
        url = event.style.link
        if not self.mouse_enabled or event.button != 1:
            return
        if url is not None and is_web_url(url):
            try:
                opened = self._url_opener(url)
            except (OSError, webbrowser.Error) as exc:
                self.notify(f"Could not open link: {exc}", severity="error")
                return
            if not opened:
                self.notify("Could not open link in your default browser", severity="error")
                return
            event.stop()
            event.prevent_default()
            return
        if not (event.ctrl or event.meta):
            return
        row = event.widget if isinstance(event.widget, EntityRow) else None
        if row is None and event.widget is not None and isinstance(event.widget.parent, EntityRow):
            row = event.widget.parent
        if row is None or row.kind not in {"task", "event"}:
            return
        self.selected = (row.kind, row.item_id)
        self.action_mark()
        event.stop()
        event.prevent_default()

    def on_mouse_move(self, event: events.MouseMove) -> None:
        if self._resize_target is None:
            return
        delta = event.screen_x - self._resize_anchor_x
        if delta:
            if self._resize_target == "sidebar":
                self._resize_columns(sidebar_delta=delta)
            else:
                self._resize_columns(inspector_delta=-delta)
            self._resize_anchor_x = event.screen_x
        event.stop()
        event.prevent_default()

    def on_mouse_up(self, event: events.MouseUp) -> None:
        if self._resize_target is None:
            return
        if self._resize_handle is not None:
            self._resize_handle.capture_mouse(False)
        self._resize_target = None
        self._resize_handle = None
        event.stop()
        event.prevent_default()

    def on_resize(self, event: events.Resize) -> None:
        self.set_class(event.size.width < 90, "narrow")
        self.set_class(event.size.width < 62, "very-narrow")
        self._apply_column_widths()

    def _can_resize_columns(self) -> bool:
        return self.size.width >= 90

    def _apply_column_widths(self) -> None:
        """Apply in-session column widths while the three-pane layout is visible."""
        sidebar = self.query_one("#sidebar", Vertical)
        inspector = self.query_one("#inspector", Vertical)
        if not self._can_resize_columns():
            sidebar.styles.clear_rule("width")
            inspector.styles.clear_rule("width")
            return
        available = self.size.width - (2 * SPLITTER_WIDTH)
        self.inspector_width = max(
            MIN_INSPECTOR_WIDTH,
            min(self.inspector_width, available - MIN_SIDEBAR_WIDTH - MIN_CENTER_WIDTH),
        )
        self.sidebar_width = max(
            MIN_SIDEBAR_WIDTH,
            min(self.sidebar_width, available - self.inspector_width - MIN_CENTER_WIDTH),
        )
        sidebar.styles.width = self.sidebar_width
        inspector.styles.width = self.inspector_width

    def _resize_columns(self, *, sidebar_delta: int = 0, inspector_delta: int = 0) -> None:
        if not self._can_resize_columns():
            return
        self.sidebar_width += sidebar_delta
        self.inspector_width += inspector_delta
        self._apply_column_widths()

    def action_resize_sidebar(self, delta: int | str) -> None:
        self._resize_columns(sidebar_delta=int(delta))

    def action_resize_inspector(self, delta: int | str) -> None:
        self._resize_columns(inspector_delta=int(delta))

    def refresh_workspace(self) -> None:
        """Refresh the UI cache through the application controller boundary."""
        if self.account_id is None:
            self.cache = CachedWorkspace()
            self._render_onboarding()
            return
        snapshot = self.runtime.application.workspace(self.account_id)
        notes_enabled = (
            self.runtime.application.notes_projection(self.account_id).value != "disabled"
        )
        self.query_one("#surface-notes", Button).display = notes_enabled
        if not notes_enabled and self.surface == "Notes":
            self.surface = "Tasks"
        self.cache = CachedWorkspace(
            identity=snapshot.account.email,
            tasks=snapshot.tasks,
            events=snapshot.events,
            task_lists=tuple((item.id, item.title) for item in snapshot.task_lists),
            calendars=tuple((item.id, item.summary, item.selected) for item in snapshot.calendars),
            instance_ranges=tuple(self.runtime.storage.list_instance_ranges(self.account_id)),
            pending=snapshot.pending,
        )
        self.marked.intersection_update(task.id for task in self.cache.tasks)
        self.marked_events.intersection_update(event.id for event in self.cache.events)
        self._render_chrome()
        self._render_surface()

    def _render_onboarding(self) -> None:
        self.query_one("#topbar", Static).update("HCB  ·  offline workspace")
        self._render_mini_month()
        self.query_one("#resources", ListView).clear()
        self.query_one("#sync-state", Static).update("Not connected · no network activity")
        self.query_one("#surface-title", Static).update("Welcome")
        content = self.query_one("#content", ListView)
        content.clear()
        content.append(
            EntityRow(
                "No account configured. Run: hcb auth connect ACCOUNT EMAIL",
                kind="onboarding",
                item_id="connect",
            )
        )
        self.query_one("#inspection", Static).update(
            "HCB will not contact Google until you explicitly connect and run sync."
        )

    def _render_chrome(self, *, refresh_resources: bool = True) -> None:
        """Refresh chrome; only rebuild resources when workspace data has changed."""
        self.query_one("#topbar", Static).update(
            f"HCB  ·  {self.cache.identity}  ·  {self.format_date(self._present_date())}"
            "  ·  / command palette"
        )
        self._render_mini_month()
        if refresh_resources:
            resources = self.query_one("#resources", ListView)
            resources.clear()
            resources.append(EntityRow("All resources", kind="resource-all", item_id="all"))
            for item_id, title in self.cache.task_lists:
                resources.append(EntityRow(f"☐ {title}", kind="task-list", item_id=item_id))
            for item_id, title, _ in self.cache.calendars:
                resources.append(EntityRow(f"□ {title}", kind="calendar", item_id=item_id))
        self._update_resource_selection()
        state = self.loading_operation or "offline cache"
        cache_badge = self._instance_cache_badge()
        suffix = f" · {cache_badge}" if cache_badge else ""
        self.query_one("#sync-state", Static).update(
            f"{state} · {self.cache.pending} pending{suffix}"
        )

    def start_loading(self, operation: str, *, cancellable: bool = False) -> None:
        """Show the selected loader while one explicit remote operation is in progress."""
        self.loading_operation = operation
        if self._loading_screen is None:
            self._loading_screen = LoadingScreen(operation, cancellable=cancellable)
            self.push_screen(self._loading_screen)
        else:
            self._loading_screen.set_message(operation)
        self._render_chrome(refresh_resources=False)

    def cancel_sync(self) -> None:
        """Ask the active sync to stop before its next Google request."""
        if not self._sync_lock.locked():
            return
        self._sync_cancel.set()
        self.update_loading("Cancelling sync after the current request")

    def update_loading(self, status: str) -> None:
        """Display the current, concrete stage of the active remote operation."""
        self.loading_operation = status
        if self._loading_screen is not None:
            self._loading_screen.set_message(status)
        self._render_chrome(refresh_resources=False)

    def stop_loading(self) -> None:
        """Remove the active loading surface after its worker has completed."""
        screen = self._loading_screen
        self.loading_operation = None
        self._loading_screen = None
        if screen is not None and self.screen is screen:
            self.pop_screen()
        self._render_chrome(refresh_resources=False)

    def _render_mini_month(self) -> None:
        """Render date controls for the sidebar's current calendar month."""
        cal = calendar.TextCalendar(self.runtime.config.preferences.week_starts_on)
        self.query_one("#mini-month-title", Static).update(f"{self.selected_date:%B %Y}")
        weekdays = cal.formatweekheader(2)
        if self.border_style != "ascii":
            weekdays = weekdays.replace(" ", " ")
        self.query_one("#mini-month-weekdays", Static).update(weekdays)
        weeks = calendar.Calendar(self.runtime.config.preferences.week_starts_on).monthdayscalendar(
            self.selected_date.year, self.selected_date.month
        )
        self._mini_month_days.clear()
        for week_index in range(6):
            days = weeks[week_index] if week_index < len(weeks) else (0,) * 7
            for weekday, day in enumerate(days):
                button = self.query_one(f"#mini-day-{week_index}-{weekday}", Button)
                # A standard Button adds one cell of implicit line padding on each side.
                # Day cells can be two columns wide in the narrow layout, so remove it.
                button.styles.line_pad = 0
                target = (
                    date(self.selected_date.year, self.selected_date.month, day) if day else None
                )
                button.label = str(day) if day else ""
                button.disabled = target is None
                button.set_class(target == self.selected_date, "mini-day-selected")
                if target is not None and button.id is not None:
                    self._mini_month_days[button.id] = target

    def _select_date(self, value: date) -> None:
        """Apply a local date navigation without disturbing the resource list."""
        if value == self.selected_date:
            return
        self.selected_date = value
        self._render_chrome(refresh_resources=False)
        self._render_surface()

    def _present_date(self) -> date:
        """Return today's date in the user's configured timezone."""
        return datetime.now(ZoneInfo(self.runtime.config.preferences.time_zone)).date()

    def format_date(self, value: date) -> str:
        """Render a date using the selected user-facing display style."""
        if self.runtime.config.preferences.date_time_format == "iso":
            return value.isoformat()
        return f"{value.day} {value:%B %Y}"

    def format_time(self, value: datetime) -> str:
        """Render an instant in the configured local timezone."""
        local = self._local_time(value)
        style = self.runtime.config.preferences.date_time_format
        if style == "iso":
            return local.isoformat()
        if style == "friendly_24h":
            return f"{local.hour:02d}:{local.minute:02d}"
        hour = local.hour % 12 or 12
        suffix = "am" if local.hour < 12 else "pm"
        return f"{hour}:{local.minute:02d}{suffix}"

    def format_date_time(self, value: date | datetime) -> str:
        """Render all-day values as dates and timed values with local clock time."""
        if not isinstance(value, datetime):
            return self.format_date(value)
        if self.runtime.config.preferences.date_time_format == "iso":
            return self._local_time(value).isoformat()
        local = self._local_time(value)
        return f"{self.format_date(local.date())}, {self.format_time(local)}"

    def _local_time(self, value: datetime) -> datetime:
        if value.tzinfo is None:
            value = value.replace(tzinfo=UTC)
        return value.astimezone(ZoneInfo(self.runtime.config.preferences.time_zone))

    def _task_rows(self, tasks: tuple[Task, ...]) -> list[tuple[Task, str]]:
        children: dict[str | None, list[Task]] = {}
        for task in tasks:
            children.setdefault(task.parent_id, []).append(task)
        rows: list[tuple[Task, str]] = []
        seen: set[str] = set()

        def visit(task: Task, depth: int) -> None:
            if task.id in seen:
                return
            seen.add(task.id)
            rows.append((task, "  " * depth))
            for child in children.get(task.id, []):
                visit(child, depth + 1)

        for root in children.get(None, []):
            visit(root, 0)
        for task in tasks:
            visit(task, 0)
        return rows

    def _render_surface(self) -> None:
        selection = self._selection_summary()
        self.query_one("#surface-title", Static).update(
            f"{self.surface}  ·  {self.selected_date:%A, %d %B %Y}{selection}"
        )
        content = self.query_one("#content", ListView)
        content.clear()
        if self.surface in {"Tasks", "Notes"}:
            tasks = self.cache.tasks
            if self.resource_filter and self.resource_filter[0] == "task-list":
                tasks = tuple(task for task in tasks if task.list_id == self.resource_filter[1])
            projection = (
                self.runtime.application.notes_projection(self.account_id)
                if self.account_id
                else None
            )
            if self.surface == "Notes":
                tasks = (
                    tuple(task for task in tasks if task.due is None and task.parent_id is None)
                    if projection is not None and projection.value != "disabled"
                    else ()
                )
            elif projection is not None and projection.value == "notes-only":
                tasks = tuple(
                    task for task in tasks if task.due is not None or task.parent_id is not None
                )
            for task, indent in self._task_rows(tasks):
                marked = "*" if task.id in self.marked else " "
                status = "✓" if task.status is TaskStatus.COMPLETED else "·"
                due = f"  {self.format_date(task.due)}" if task.due else ""
                note_lines = (task.notes or "").splitlines()
                notes = f" — {note_lines[0]}" if self.surface == "Notes" and note_lines else ""
                content.append(
                    EntityRow(
                        f"{marked} {indent}{status} {task.title}{due}{notes}",
                        kind="task",
                        item_id=task.id,
                    )
                )
        else:
            events = self._events_for_surface()
            for event in events:
                when = self.format_date_time(event.start.value)
                marked = "*" if event.id in self.marked_events else " "
                content.append(
                    EntityRow(
                        f"{marked} {when}  {event.summary}",
                        kind="event",
                        item_id=event.id,
                    )
                )
            if self.surface == "Month" and not events:
                content.append(EntityRow("No events this month", kind="empty", item_id="month"))
        if not content.children:
            content.append(
                EntityRow(
                    f"No {self.surface.lower()} in the local cache",
                    kind="empty",
                    item_id="empty",
                )
            )
        content.index = 0
        self._update_content_selection()

    def _selection_summary(self) -> str:
        parts: list[str] = []
        if self.marked:
            parts.append(f"{len(self.marked)} task(s)")
        if self.marked_events:
            parts.append(f"{len(self.marked_events)} event(s)")
        return f"  ·  selected: {', '.join(parts)}" if parts else ""

    def _update_content_selection(self) -> None:
        """Keep the row that powers the Inspector visibly selected."""
        content = self.query_one("#content", ListView)
        for row in content.query(EntityRow):
            row.set_class((row.kind, row.item_id) == self.selected, "hcb-selected")

    def _update_resource_selection(self) -> None:
        """Keep the active resource visible after focus moves to another pane."""
        resources = self.query_one("#resources", ListView)
        for row in resources.query(EntityRow):
            selected = (
                row.kind == "resource-all"
                if self.resource_filter is None
                else (row.kind, row.item_id) == self.resource_filter
            )
            row.set_class(selected, "hcb-selected")

    def _event_surface_range(self) -> tuple[date, date]:
        day = self.selected_date
        if self.surface == "Day":
            return day, day + timedelta(days=1)
        if self.surface == "Week":
            offset = (day.weekday() - self.runtime.config.preferences.week_starts_on) % 7
            start = day - timedelta(days=offset)
            return start, start + timedelta(days=7)
        if self.surface == "Month":
            start = day.replace(day=1)
            return start, (start.replace(day=28) + timedelta(days=4)).replace(day=1)
        return day, day + timedelta(days=14)

    def _instance_cache_badge(self) -> str | None:
        """Summarize the local-only occurrence-cache state for the visible range."""
        if self.account_id is None or self.surface in {"Tasks", "Notes"}:
            return None
        start, end = self._event_surface_range()
        calendar_ids = (
            (self.resource_filter[1],)
            if self.resource_filter and self.resource_filter[0] == "calendar"
            else tuple(item_id for item_id, _title, selected in self.cache.calendars if selected)
        )
        if not calendar_ids:
            return "instances: missing"
        statuses = [
            self.runtime.storage.instance_cache_status(self.account_id, item_id, start, end)
            for item_id in calendar_ids
        ]
        states = {item["state"] for item in statuses}
        state = (
            "fresh"
            if states == {"fresh"}
            else "partial"
            if "fresh" in states
            else ("stale" if "stale" in states else "missing")
        )
        ranges = [item for status in statuses for item in status["ranges"]]
        refreshed = max(
            (str(item["refreshed_at"]) for item in ranges if item.get("refreshed_at")),
            default=None,
        )
        stale_reason = next(
            (str(item["stale_reason"]) for item in ranges if item.get("state") == "stale"),
            None,
        )
        details = f"{self.format_date(start)}–{self.format_date(end)}"
        if refreshed:
            details += f", refreshed {self.format_date_time(datetime.fromisoformat(refreshed))}"
        if stale_reason:
            details += f", {stale_reason.replace('-', ' ')}"
        return f"instances: {state} ({details})"

    def _events_for_surface(self) -> tuple[Event, ...]:
        start, end = self._event_surface_range()
        events = tuple(
            event
            for event in self.cache.events
            if self._event_overlaps_range(event, start, end)
            if (
                not self.resource_filter
                or self.resource_filter[0] != "calendar"
                or event.calendar_id == self.resource_filter[1]
            )
        )
        expanded_series = {
            event.canonical_id for event in events if event.derived and event.canonical_id
        }
        return tuple(
            event
            for event in events
            if event.derived or not event.recurrence or event.remote_id not in expanded_series
        )

    def _event_overlaps_range(self, event: Event, start: date, end: date) -> bool:
        """Use instant boundaries for timed events and exclusive ones for all-day dates."""
        event_start = event.start.value
        event_end = event.end.value
        if not isinstance(event_start, datetime) and not isinstance(event_end, datetime):
            return event_end > start and event_start < end
        if not isinstance(event_start, datetime) or not isinstance(event_end, datetime):
            return False
        zone = ZoneInfo(self.runtime.config.preferences.time_zone)
        range_start = datetime.combine(start, datetime.min.time(), tzinfo=zone)
        range_end = datetime.combine(end, datetime.min.time(), tzinfo=zone)
        return (
            self._local_time(event_end) > range_start and self._local_time(event_start) < range_end
        )

    def on_button_pressed(self, event: Button.Pressed) -> None:
        button_id = event.button.id
        if button_id in self._mini_month_days:
            self._select_date(self._mini_month_days[button_id])
        elif button_id and button_id.startswith("surface-"):
            self.action_surface(button_id.removeprefix("surface-").title())

    def on_list_view_highlighted(self, event: ListView.Highlighted) -> None:
        if event.list_view.id != "content" or not isinstance(event.item, EntityRow):
            return
        row = event.item
        self.selected = (row.kind, row.item_id)
        self._update_content_selection()
        self._render_inspector()

    def on_list_view_selected(self, event: ListView.Selected) -> None:
        if event.list_view.id != "resources" or not isinstance(event.item, EntityRow):
            return
        row = event.item
        self.resource_filter = None if row.kind == "resource-all" else (row.kind, row.item_id)
        self._render_chrome(refresh_resources=False)
        self._render_surface()

    @staticmethod
    def _attachment_target(attachment: dict[str, object]) -> tuple[str, str | None]:
        title = attachment.get("title") or attachment.get("fileId") or "Attachment"
        url = next(
            (
                value
                for key in ("fileUrl", "webViewLink", "url")
                if isinstance((value := attachment.get(key)), str) and is_web_url(value)
            ),
            None,
        )
        return str(title), url

    @staticmethod
    def _append_link(text: Text, label: str, url: str) -> None:
        start = len(text)
        text.append(label)
        text.stylize(Style(link=url, underline=True), start, len(text))

    def _event_inspection_text(self, event: Event) -> Text:
        details = (
            f"Type: {event.event_type or 'default'}\n"
            f"Visibility: {event.visibility or 'default'}\n"
            f"Transparency: {event.transparency or 'default'}\n"
            f"Color: {event.color_id or 'default'}\n"
            f"Attendees: {len(event.attendees)}\n"
            f"RSVP: {event.attendee_response or 'none'}\n"
            "Reminders: "
            f"{'default' if event.reminder_use_default else len(event.reminder_overrides)}\n"
            f"Attachments: {len(event.attachments)}\n"
            f"Conference: {'yes' if event.conference else 'no'}\n"
            f"Guest flags: invite={event.guests_can_invite_others}, "
            f"modify={event.guests_can_modify}, see={event.guests_can_see_other_guests}"
        )
        properties = (
            event.focus_time_properties
            or event.out_of_office_properties
            or event.working_location_properties
        )
        text = render_inspector_markup(event.summary)
        text.append(
            f"\n\n{self.format_date_time(event.start.value)} → "
            f"{self.format_date_time(event.end.value)}\n"
        )
        text.append_text(render_inspector_markup(event.location or ""))
        text.append("\n\n")
        text.append_text(render_inspector_markup(event.description or "No description"))
        text.append(f"\n\n{details}" + (f"\nProperties: {properties}" if properties else ""))
        if event.attachments:
            text.append("\n\nAttachments:\n")
            for attachment in event.attachments:
                title, url = self._attachment_target(attachment)
                text.append("• ")
                if url is None:
                    text.append(title)
                else:
                    self._append_link(text, title, url)
                    text.append("  ")
                    self._append_link(text, url, url)
                text.append("\n")
        text.append("\nStructured CLI editing preserves specialist fields.")
        return text

    def _render_inspector(self) -> None:
        target = self._selected_task()
        if target:
            text = render_inspector_markup(target.title)
            text.append(
                f"\n\nStatus: {target.status.value}\n"
                f"Due: {self.format_date(target.due) if target.due else '—'}\n"
                f"Priority: {target.priority.value}\n\n"
            )
            text.append_text(render_inspector_markup(target.notes or "No notes"))
            self.query_one("#inspection", Static).update(text)
            return
        event = self._selected_event()
        if event:
            self.query_one("#inspection", Static).update(self._event_inspection_text(event))
            return
        drive_file = self._selected_drive()
        if drive_file:
            modified = (
                self.format_date_time(drive_file.modified_time) if drive_file.modified_time else "—"
            )
            text = Text()
            if drive_file.web_view_link and is_web_url(drive_file.web_view_link):
                self._append_link(text, drive_file.name, drive_file.web_view_link)
            else:
                text.append(drive_file.name)
            text.append(f"\n\nType: {drive_file.mime_type or 'unknown'}\nModified: {modified}\n\n")
            if drive_file.web_view_link and is_web_url(drive_file.web_view_link):
                self._append_link(text, drive_file.web_view_link, drive_file.web_view_link)
            else:
                text.append("No web link cached")
            self.query_one("#inspection", Static).update(linkify_urls(text))
            return
        self.query_one("#inspection", Static).update("Select an item")

    def _selected_task(self) -> Task | None:
        if not self.selected or self.selected[0] != "task":
            return None
        return next((item for item in self.cache.tasks if item.id == self.selected[1]), None)

    def _selected_event(self) -> Event | None:
        if not self.selected or self.selected[0] != "event":
            return None
        return next((item for item in self.cache.events if item.id == self.selected[1]), None)

    def _selected_drive(self) -> DriveFile | None:
        if not self.selected or self.selected[0] != "drive" or self.account_id is None:
            return None
        return self.runtime.storage.get_drive_file(self.account_id, self.selected[1])

    def search_local(self, query: str) -> tuple[SearchResult, ...]:
        if self.account_id is None:
            return ()
        return self.runtime.application.search(self.account_id, query)

    def action_surface(self, name: str) -> None:
        if name not in SURFACES:
            return
        self.surface = name
        self.selected = None
        self._render_chrome(refresh_resources=False)
        self._render_surface()

    def action_palette(self) -> None:
        self.push_screen(PaletteScreen(self), self._palette_result)

    def _palette_result(self, result: tuple[str, str] | None) -> None:
        if result is None:
            return
        kind, value = result
        if kind == "create":
            self.action_create()
        elif kind == "sync":
            self.action_sync()
        elif kind == "refresh-instances":
            self.action_refresh_instances()
        elif kind == "calendars":
            self.push_screen(CalendarScreen(self))
        elif kind == "doctor":
            diagnostics = self.runtime.application.diagnostics()
            self.notify(
                f"Database {diagnostics['integrity']}; {diagnostics['pending_mutations']} pending"
            )
        elif kind == "settings":
            self.push_screen(SettingsScreen(self), self._settings_result)
        elif kind == "find-time":
            self.push_screen(FindTimeScreen(self))
        elif kind == "bulk":
            self.push_screen(BulkScreen(self))
        elif kind == "schedule":
            task = self._selected_task()
            self.push_screen(ScheduleScreen(self, task.id if task else ""))
        elif kind == "import":
            self.push_screen(ImportScreen(self))
        elif kind == "conflicts":
            self.push_screen(ConflictScreen(self))
        elif kind == "onboarding":
            self.push_screen(self._onboarding_screen(), self._onboarding_result)
        elif kind in {"task", "event"}:
            self.surface = "Tasks" if kind == "task" else "Agenda"
            self.resource_filter = None
            self.selected = (kind, value)
            self._render_chrome(refresh_resources=False)
            self._render_surface()
            self._render_inspector()
        elif kind == "task-list":
            self.surface = "Tasks"
            self.resource_filter = ("task-list", value)
            self.selected = None
            self._render_chrome(refresh_resources=False)
            self._render_surface()
            self._render_inspector()
        elif kind == "calendar":
            self.surface = "Agenda"
            self.resource_filter = ("calendar", value)
            self.selected = None
            self._render_chrome(refresh_resources=False)
            self._render_surface()
            self._render_inspector()
        elif kind == "drive":
            self.selected = (kind, value)
            self._render_inspector()
        elif kind == "saved-search" and self.account_id is not None:
            saved = next(
                (
                    item
                    for item in self.runtime.application.list_saved_searches(self.account_id)
                    if item.id == value
                ),
                None,
            )
            if saved is not None:
                self.push_screen(
                    PaletteScreen(self, initial_query=saved.query), self._palette_result
                )
        elif kind == "conflict":
            self.push_screen(ConflictScreen(self))

    def action_create(self) -> None:
        if self.account_id is None:
            self.notify(
                "Connect an account first: hcb auth connect ACCOUNT EMAIL",
                severity="warning",
            )
            return
        if self.surface not in {"Tasks", "Notes"}:
            if not self.cache.calendars:
                self.notify("Create a calendar first", severity="warning")
                return
            self.push_screen(
                EventEditorScreen(None, self.cache.calendars[0][0]),
                self._event_create_result,
            )
        else:
            if not self.cache.task_lists:
                self.notify(
                    "Create a task list first: hcb task-lists create Inbox",
                    severity="warning",
                )
                return
            self.push_screen(EditorScreen(), self._create_result)

    def _create_result(self, result: dict[str, str] | None) -> None:
        if not result or not result["title"] or self.account_id is None:
            return
        try:
            self.runtime.application.create_task(
                self.account_id,
                self.cache.task_lists[0][0],
                result["title"],
                due=date.fromisoformat(result["due"]) if result["due"] else None,
                notes=result["notes"] or None,
            )
        except ValueError as exc:
            self.notify(str(exc), severity="error")
            return
        self.refresh_workspace()
        self.notify("Task created")

    def action_edit(self) -> None:
        task = self._selected_task()
        event = self._selected_event()
        if event is not None:
            self.push_screen(EventEditorScreen(event, event.calendar_id), self._event_edit_result)
            return
        if task is None:
            self.notify("Select a task or event to edit", severity="warning")
            return
        self.push_screen(
            EditorScreen(
                title=task.title,
                notes=task.notes or "",
                due=task.due.isoformat() if task.due else "",
                deletable=True,
            ),
            self._edit_result,
        )

    def _edit_result(self, result: dict[str, str] | None) -> None:
        task = self._selected_task()
        if not result or task is None or self.account_id is None:
            return
        if result.get("action") == "delete":
            self._confirm_editor_delete("task", task.id)
            return
        if not result["title"]:
            return
        try:
            self.runtime.application.update_task(
                self.account_id,
                task.id,
                title=result["title"],
                notes=result["notes"] or None,
                due=date.fromisoformat(result["due"]) if result["due"] else None,
                clear_due=not result["due"],
            )
        except ValueError as exc:
            self.notify(str(exc), severity="error")
            return
        self.refresh_workspace()
        self.notify("Task updated")

    @staticmethod
    def _parse_event_point(raw: str) -> EventDateTime:
        if "T" not in raw and " " not in raw:
            return EventDateTime(DateTimeKind.DATE, date.fromisoformat(raw))
        value = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if value.tzinfo is None:
            value = value.replace(tzinfo=UTC)
        return EventDateTime(DateTimeKind.DATETIME, value, "UTC")

    def _event_create_result(self, result: dict[str, str] | None) -> None:
        if not result or not result["title"] or self.account_id is None:
            return
        try:
            self.runtime.application.create_event(
                self.account_id,
                result["calendar"],
                result["title"],
                self._parse_event_point(result["start"]),
                self._parse_event_point(result["end"]),
                description=result["description"] or None,
                location=result["location"] or None,
                recurrence=tuple(
                    item.strip() for item in result["recurrence"].split("|") if item.strip()
                ),
            )
        except (ValueError, HcbError) as exc:
            self.notify(str(exc), severity="error")
            return
        self.refresh_workspace()
        self.notify("Event created")

    def _event_edit_result(self, result: dict[str, str] | None) -> None:
        event = self._selected_event()
        if not result or event is None or self.account_id is None:
            return
        if result.get("action") == "delete":
            self._confirm_editor_delete("event", event.id)
            return
        if not result["title"]:
            return
        try:
            if result["calendar"] != event.calendar_id:
                self.runtime.application.move_event(self.account_id, event.id, result["calendar"])
            self.runtime.application.update_event(
                self.account_id,
                event.id,
                summary=result["title"],
                start=self._parse_event_point(result["start"]),
                end=self._parse_event_point(result["end"]),
                description=result["description"] or None,
                location=result["location"] or None,
                recurrence=tuple(
                    item.strip() for item in result["recurrence"].split("|") if item.strip()
                ),
            )
        except (ValueError, HcbError) as exc:
            self.notify(str(exc), severity="error")
            return
        self.refresh_workspace()
        self.notify("Event updated")

    def _confirm_editor_delete(self, kind: Literal["task", "event"], item_id: str) -> None:
        self.push_screen(
            ConfirmScreen(
                f"Delete this {kind}?",
                confirm_label="Delete",
                confirm_variant="error",
            ),
            lambda confirmed: self._delete_editor_item(kind, item_id, confirmed),
        )

    def _delete_editor_item(
        self, kind: Literal["task", "event"], item_id: str, confirmed: bool | None
    ) -> None:
        if not confirmed or self.account_id is None:
            return
        if kind == "task":
            self.runtime.application.delete_tasks(self.account_id, [item_id])
            self.marked.discard(item_id)
        else:
            self.runtime.application.delete_events(self.account_id, [item_id])
            self.marked_events.discard(item_id)
        if self.selected == (kind, item_id):
            self.selected = None
        self.refresh_workspace()
        self.notify(f"{kind.title()} deleted")

    def _batch_ids(
        self, entity_type: Literal["task", "event"], *, include_selected: bool = True
    ) -> list[str]:
        if entity_type == "task":
            ids = [item.id for item in self.cache.tasks if item.id in self.marked]
        else:
            ids = [item.id for item in self.cache.events if item.id in self.marked_events]
        if ids or not include_selected:
            return ids
        if self.selected and self.selected[0] == entity_type:
            return [self.selected[1]]
        return []

    def batch_move_preview_text(self, preview: BatchMovePreview) -> str:
        if preview.entity_type == "task":
            titles = dict(self.cache.task_lists)
            destination = titles.get(preview.destination_id, preview.destination_id)
            lines = [
                f"Move {len(preview.items)} task(s) to {destination!r} as top-level tasks:",
                "",
            ]
            for task in preview.items:
                assert isinstance(task, Task)
                source = titles.get(task.list_id, task.list_id)
                lines.append(f"{task.title}  ·  {source} → {destination}")
            return "\n".join(lines)
        titles = {item_id: title for item_id, title, _selected in self.cache.calendars}
        destination = titles.get(preview.destination_id, preview.destination_id)
        lines = [f"Move {len(preview.items)} event(s) to {destination!r}:", ""]
        for event in preview.items:
            assert isinstance(event, Event)
            source = titles.get(event.calendar_id, event.calendar_id)
            lines.append(f"{event.summary}  ·  {source} → {destination}")
        return "\n".join(lines)

    @staticmethod
    def batch_action_preview_text(preview: BatchActionPreview) -> str:
        if preview.entity_type == "task":
            tasks = tuple(item for item in preview.items if isinstance(item, Task))
            if preview.action == "delete":
                lines = [f"Delete {len(tasks)} task(s):", ""]
                lines.extend(f"{task.title}  ·  active → deleted" for task in tasks)
            else:
                target = "completed" if preview.action == "complete" else "needs action"
                lines = [f"{preview.action.title()} {len(tasks)} task(s):", ""]
                lines.extend(f"{task.title}  ·  {task.status.value} → {target}" for task in tasks)
            return "\n".join(lines)

        events = tuple(item for item in preview.items if isinstance(item, Event))
        if preview.action == "delete":
            lines = [f"Delete {len(events)} event(s):", ""]
            lines.extend(f"{event.summary}  ·  active → deleted" for event in events)
        else:
            target = preview.response_status or "needsAction"
            lines = [f"Queue RSVP {target} for {len(events)} event(s):", ""]
            lines.extend(
                f"{event.summary}  ·  {event.attendee_response or 'needsAction'} → {target}"
                for event in events
            )
        return "\n".join(lines)

    def apply_batch_action(self, preview: BatchActionPreview) -> bool:
        """Apply one previously displayed plan, retaining it on a local failure."""
        if self.account_id is None:
            return False
        item_ids = [item.id for item in preview.items]
        try:
            if preview.entity_type == "task":
                if preview.action in {"complete", "reopen"}:
                    self.runtime.application.complete_tasks(
                        self.account_id,
                        item_ids,
                        completed=preview.action == "complete",
                    )
                elif preview.action == "delete":
                    self.runtime.application.delete_tasks(self.account_id, item_ids)
                    self.marked.difference_update(item_ids)
                else:
                    raise ValueError("unsupported task batch action")
            elif preview.action == "respond":
                response = preview.response_status
                if response is None:
                    raise ValueError("batch RSVP has no response")
                self.runtime.application.respond_events(self.account_id, item_ids, response)
            elif preview.action == "delete":
                self.runtime.application.delete_events(self.account_id, item_ids)
                self.marked_events.difference_update(item_ids)
            else:
                raise ValueError("unsupported event batch action")
        except (ValueError, HcbError) as exc:
            self.notify(str(exc), severity="error")
            return False
        self.refresh_workspace()
        action = "RSVP" if preview.action == "respond" else preview.action
        self.notify(f"Queued {action} for {len(item_ids)} {preview.entity_type}(s)")
        return True

    def _review_batch_action(self, preview: BatchActionPreview) -> None:
        self.push_screen(BatchActionScreen(self, preview))

    def action_move_marked(self, entity_type: Literal["task", "event"]) -> None:
        ids = self._batch_ids(entity_type)
        destinations = self.cache.task_lists if entity_type == "task" else self.cache.calendars
        if not ids:
            self.notify(f"Select {entity_type}s to move", severity="warning")
            return
        if not destinations:
            label = "task list" if entity_type == "task" else "calendar"
            self.notify(f"Create a destination {label} first", severity="warning")
            return
        self.push_screen(BatchMoveScreen(self, entity_type, tuple(ids)))

    def action_rsvp(self) -> None:
        event_ids = self._batch_ids("event")
        if not event_ids:
            self.notify("Select an event to RSVP", severity="warning")
            return
        self.push_screen(RsvpScreen(), self._rsvp_result)

    def _rsvp_result(self, response: str | None) -> None:
        if response is None or self.account_id is None:
            return
        event_ids = self._batch_ids("event")
        if not event_ids:
            return
        try:
            preview = self.runtime.application.preview_event_response(
                self.account_id, event_ids, cast(ResponseStatus, response)
            )
        except (ValueError, HcbError) as exc:
            self.notify(str(exc), severity="error")
            return
        self._review_batch_action(preview)

    def action_complete(self) -> None:
        if self.account_id is None:
            return
        ids = self._batch_ids("task")
        if not ids:
            self.notify("Select a task to complete", severity="warning")
            return
        targets = [item for item in self.cache.tasks if item.id in set(ids)]
        completed = not all(item.status is TaskStatus.COMPLETED for item in targets)
        try:
            preview = self.runtime.application.preview_task_completion(
                self.account_id, [item.id for item in targets], completed=completed
            )
        except (ValueError, HcbError) as exc:
            self.notify(str(exc), severity="error")
            return
        self._review_batch_action(preview)

    def action_mark(self) -> None:
        task = self._selected_task()
        event = self._selected_event()
        if task is not None:
            if task.id in self.marked:
                self.marked.remove(task.id)
            else:
                self.marked.add(task.id)
        elif event is not None:
            if event.id in self.marked_events:
                self.marked_events.remove(event.id)
            else:
                self.marked_events.add(event.id)
        self._render_surface()

    def action_delete(self) -> None:
        ids = self._batch_ids("task")
        event_ids = self._batch_ids("event")
        if not ids and not event_ids:
            self.notify("Select an item to delete", severity="warning")
            return
        if ids and event_ids:
            self.notify(
                "Delete marked tasks or marked events separately so the batch stays unambiguous",
                severity="warning",
            )
            return
        if self.account_id is None:
            return
        try:
            preview = (
                self.runtime.application.preview_task_deletion(self.account_id, ids)
                if ids
                else self.runtime.application.preview_event_deletion(self.account_id, event_ids)
            )
        except (ValueError, HcbError) as exc:
            self.notify(str(exc), severity="error")
            return
        self._review_batch_action(preview)

    def action_undo(self) -> None:
        if self.account_id is not None:
            changed = self.runtime.application.undo(self.account_id)
            self.refresh_workspace()
            self.notify("Nothing to undo" if changed is None else "Undone")

    def action_redo(self) -> None:
        if self.account_id is not None:
            changed = self.runtime.application.redo(self.account_id)
            self.refresh_workspace()
            self.notify("Nothing to redo" if changed is None else "Redone")

    def calendar_rows(self) -> tuple[tuple[str, str, bool], ...]:
        return self.cache.calendars

    def create_calendar(self, name: str) -> bool:
        if self.account_id is None:
            return False
        try:
            self.runtime.application.create_calendar(self.account_id, name)
        except (ValueError, HcbError) as exc:
            self.notify(str(exc), severity="error")
            return False
        self.refresh_workspace()
        self.notify("Calendar created")
        return True

    def toggle_calendar(self, calendar_id: str) -> None:
        if self.account_id is None:
            return
        selected = next(
            (enabled for item_id, _, enabled in self.cache.calendars if item_id == calendar_id),
            True,
        )
        self.runtime.application.update_calendar(
            self.account_id, calendar_id, selected=not selected
        )
        self.refresh_workspace()

    def confirm_calendar_delete(self, calendar_id: str, callback: Callable[[], None]) -> None:
        def apply(confirmed: bool | None) -> None:
            if confirmed and self.account_id is not None:
                self.runtime.application.delete_calendar(self.account_id, calendar_id)
                self.refresh_workspace()
                callback()
                self.notify("Calendar deleted")

        self.push_screen(
            ConfirmScreen(
                "Delete this calendar and its cached events?",
                confirm_label="Delete",
                confirm_variant="error",
            ),
            apply,
        )

    def settings_values(self) -> dict[str, str]:
        config = self.runtime.config
        preset_names = {item.name for item in presets()}
        return {
            "theme_preset": (
                config.theme.preset if config.theme.preset in preset_names else CURRENT_THEME_VALUE
            ),
            "profile": config.theme.profile,
            "density": config.theme.density,
            "borders": config.theme.borders,
            "focus": config.theme.focus,
            "mouse": str(config.theme.mouse).lower(),
            "loader": config.theme.loader,
            "week_starts_on": str(config.preferences.week_starts_on),
            "date_time_format": config.preferences.date_time_format,
            "editor": config.preferences.editor,
            "external_editor": config.keys.external_editor,
            "colors": json.dumps(asdict(config.theme.colors), indent=2, sort_keys=True),
        }

    def settings_theme_options(self) -> tuple[tuple[str, str], ...]:
        """Return theme choices with the matching local palette clearly identified."""
        current = self.runtime.config.theme.preset
        available = presets()
        names = {item.name for item in available}
        detected = self._local_environment().suggested_preset
        options: list[tuple[str, str]] = []
        if current in names and current == detected:
            options.append((f"Use detected {current}", current))
        elif current in names:
            options.append((f"Current: {current}", current))
        else:
            options.append(("Keep current theme", CURRENT_THEME_VALUE))
        if detected and detected != current:
            options.append((f"Use detected {detected}", detected))
        options.extend(
            (item.name, item.name) for item in available if item.name not in {current, detected}
        )
        return tuple(options)

    def _settings_result(self, result: dict[str, str] | None) -> None:
        if result is None:
            return
        try:
            profile = result["profile"]
            density = result["density"]
            borders = result["borders"]
            focus = result["focus"]
            mouse_raw = result["mouse"].casefold()
            if profile not in {"terminal", "dark", "light"}:
                raise ValueError("profile must be terminal, dark, or light")
            if density not in {"compact", "comfortable"}:
                raise ValueError("density must be compact or comfortable")
            if borders not in {"unicode", "ascii"}:
                raise ValueError("borders must be unicode or ascii")
            if focus not in {"ascii", "underline", "reverse"}:
                raise ValueError("focus must be ascii, underline, or reverse")
            if mouse_raw not in {"true", "false"}:
                raise ValueError("mouse must be true or false")
            date_time_format = result["date_time_format"]
            if date_time_format not in {"friendly", "friendly_24h", "iso"}:
                raise ValueError("choose a supported date and time display")
            loader = result["loader"]
            if loader not in LOADER_PRESETS:
                raise ValueError("choose a bundled Rattles loading indicator")
            if not result["editor"]:
                raise ValueError("external editor command must not be empty")
            if not result["external_editor"]:
                raise ValueError("external editor shortcut must not be empty")
            colors_data = json.loads(result["colors"])
            if not isinstance(colors_data, dict):
                raise ValueError("semantic colors must be a JSON object")
            colors = ThemeColors(**colors_data)
            theme_preset: str | None = result["theme_preset"]
            if theme_preset is None or theme_preset == CURRENT_THEME_VALUE:
                theme_preset = None
            else:
                selected = preset(theme_preset)
                if profile != selected.profile or colors != selected.colors:
                    theme_preset = None
            config = self.runtime.update_tui_settings(
                profile=profile,
                density=density,
                borders=borders,
                focus=focus,
                mouse=mouse_raw == "true",
                loader=loader,
                theme_preset=theme_preset,
                week_starts_on=int(result["week_starts_on"]),
                date_time_format=date_time_format,
                editor=result["editor"],
                external_editor=result["external_editor"],
                colors=colors,
            )
        except (TypeError, ValueError, json.JSONDecodeError) as exc:
            self.notify(str(exc), severity="error")
            return
        self._apply_visual_config(config)
        self._observed_config_marker = self._config_marker()
        self._render_chrome(refresh_resources=False)
        self._render_surface()
        self._render_inspector()
        self.notify("Settings saved and applied")

    def find_time_local(
        self, raw_day: str, raw_duration: str, raw_start: str, raw_end: str
    ) -> tuple[TimeSlot, ...]:
        if self.account_id is None:
            return ()
        return self.runtime.application.find_time(
            self.account_id,
            date.fromisoformat(raw_day),
            duration_minutes=int(raw_duration),
            day_start=int(raw_start),
            day_end=int(raw_end),
        )

    def _freebusy_request(
        self, raw_day: str, raw_start: str, raw_end: str
    ) -> tuple[str, dict[str, object]]:
        if self.account_id is None:
            raise ValueError("connect an account before querying Google")
        account_id = self.account_id
        day = date.fromisoformat(raw_day)
        start = datetime.combine(day, datetime.min.time(), UTC) + timedelta(hours=int(raw_start))
        end = datetime.combine(day, datetime.min.time(), UTC) + timedelta(hours=int(raw_end))
        calendars: list[dict[str, str]] = []
        for item_id, _summary, selected in self.cache.calendars:
            calendar_item = self.runtime.storage.get_calendar(account_id, item_id)
            if selected and calendar_item and calendar_item.remote_id:
                calendars.append({"id": calendar_item.remote_id})
        return account_id, {
            "timeMin": start.isoformat().replace("+00:00", "Z"),
            "timeMax": end.isoformat().replace("+00:00", "Z"),
            "items": calendars,
        }

    def remote_freebusy(self, raw_day: str, raw_start: str, raw_end: str) -> dict[str, object]:
        """Run the explicit Google request synchronously for non-TUI callers."""
        account_id, body = self._freebusy_request(raw_day, raw_start, raw_end)
        return self.runtime.sync_engine(account_id).gateway.freebusy(body)

    def request_remote_freebusy(
        self,
        raw_day: str,
        raw_start: str,
        raw_end: str,
        callback: Callable[[dict[str, object]], None],
    ) -> None:
        """Run the explicit Google query without suspending the active modal screen."""
        try:
            account_id, body = self._freebusy_request(raw_day, raw_start, raw_end)
        except (ValueError, HcbError) as exc:
            self.notify(str(exc), severity="error")
            return
        self.start_loading("Querying Google free/busy")
        self.query_remote_freebusy(account_id, body, callback)

    @work(thread=True, exclusive=True, group="freebusy")
    def query_remote_freebusy(
        self,
        account_id: str,
        body: dict[str, object],
        callback: Callable[[dict[str, object]], None],
    ) -> None:
        failure: Exception | None = None
        try:
            self.call_from_thread(self.update_loading, "Waiting for Google availability")
            result = self.runtime.sync_engine(account_id).gateway.freebusy(body)
        except Exception as exc:  # Google failures must not tear down the workspace.
            failure = exc
        else:
            self.call_from_thread(callback, result)
        finally:
            self.call_from_thread(self.stop_loading)
        if failure is not None:
            self.call_from_thread(
                self._show_remote_failure, "Google free/busy", failure, account_id
            )

    def action_jump(self) -> None:
        self.push_screen(
            EditorScreen(due=self.selected_date.isoformat(), jump=True),
            self._jump_result,
        )

    def _jump_result(self, result: dict[str, str] | None) -> None:
        if not result:
            return
        try:
            selected_date = date.fromisoformat(result["date"])
        except ValueError:
            self.notify("Use a date in YYYY-MM-DD format", severity="error")
            return
        self._select_date(selected_date)

    @work(thread=True, exclusive=True, group="sync")
    def action_sync(self) -> None:
        if self.account_id is None:
            self.call_from_thread(
                self.notify,
                "No account is configured. Open / → First-run setup, then connect Google.",
                severity="warning",
            )
            return
        if not self._sync_lock.acquire(blocking=False):
            self.call_from_thread(
                self.notify,
                "A sync is already running. Press Esc to cancel it.",
                severity="warning",
            )
            return
        account_id = self.account_id
        failure: Exception | None = None
        self._sync_cancel.clear()
        self.call_from_thread(lambda: self.start_loading("Preparing Google sync", cancellable=True))
        worker_storage: Storage | None = None
        try:
            engine = self.runtime.sync_engine(account_id)
            worker_storage = Storage(self.runtime.paths.database_file)
            engine.storage = worker_storage
            result = engine.sync(
                account_id,
                progress=lambda status: self.call_from_thread(self.update_loading, status),
                cancelled=self._sync_cancel.is_set,
                cancel_hint="Press Esc to cancel.",
            )
        except Exception as exc:  # provider failures must not tear down the workspace
            failure = exc
        else:
            if result.cancelled:
                self.call_from_thread(
                    self.notify,
                    result.retry_message or "Sync cancelled. Local changes remain queued.",
                    severity="warning",
                )
            elif result.retry_exhausted:
                self.call_from_thread(
                    self.notify,
                    result.retry_message or "Sync paused. Local changes remain queued.",
                    severity="warning",
                )
            elif result.conflicts:
                self.call_from_thread(
                    self.notify,
                    f"Sync completed with {result.conflicts} conflict(s). "
                    "Open Conflicts to review them; your marked items remain selected.",
                    severity="warning",
                )
            else:
                self.call_from_thread(
                    self.notify,
                    f"Sync complete: {result.pulled} pulled, {result.pushed} pushed",
                )
        finally:
            if worker_storage is not None:
                worker_storage.close()
            self.call_from_thread(self.stop_loading)
            self.call_from_thread(self.refresh_workspace)
            self._sync_lock.release()
        if failure is not None:
            self.call_from_thread(self._show_remote_failure, "Sync", failure, account_id)

    @work(thread=True, exclusive=True, group="sync")
    def action_refresh_instances(self) -> None:
        """Explicitly refresh Google-expanded instances for the visible local range."""
        if self.account_id is None:
            self.call_from_thread(self.notify, "Connect an account first", severity="warning")
            return
        selected_event = self._selected_event()
        calendar_id = (
            self.resource_filter[1]
            if self.resource_filter and self.resource_filter[0] == "calendar"
            else (selected_event.calendar_id if selected_event else None)
        )
        if calendar_id is None:
            calendar_id = next(
                (item_id for item_id, _, selected in self.cache.calendars if selected), None
            )
        if calendar_id is None:
            self.call_from_thread(self.notify, "Select a calendar first", severity="warning")
            return
        account_id = self.account_id
        start = datetime.combine(self.selected_date, datetime.min.time(), UTC)
        duration = {"Day": 1, "Week": 7, "Month": 35}.get(self.surface, 14)
        self.call_from_thread(self.start_loading, "Preparing recurring instance refresh")
        worker_storage: Storage | None = None
        failure: Exception | None = None
        try:
            engine = self.runtime.sync_engine(account_id)
            worker_storage = Storage(self.runtime.paths.database_file)
            engine.storage = worker_storage
            self.call_from_thread(self.update_loading, "Fetching recurring events")
            events = engine.refresh_occurrences(
                account_id, calendar_id, start, start + timedelta(days=duration)
            )
        except Exception as exc:
            failure = exc
        else:
            self.call_from_thread(self.notify, f"Refreshed {len(events)} recurring instances")
        finally:
            if worker_storage is not None:
                worker_storage.close()
            self.call_from_thread(self.stop_loading)
            self.call_from_thread(self.refresh_workspace)
        if failure is not None:
            self.call_from_thread(
                self._show_remote_failure, "Instance refresh", failure, account_id
            )


# Components use HcbApp for concrete runtime checks, so import them only after
# the app class is defined. They are re-exported for the public TUI module API.
from .tui_components import (  # noqa: E402
    BatchActionScreen,
    BatchMoveScreen,
    BulkScreen,
    CachedWorkspace,
    CalendarScreen,
    ConfirmScreen,
    ConflictScreen,
    EditorRunner,
    EditorScreen,
    EmojiCompletion,
    EmojiTarget,
    EntityRow,
    EventEditorScreen,
    FindTimeScreen,
    GoogleSetupScreen,
    ImportScreen,
    Input,
    LoadingScreen,
    OnboardingScreen,
    PaletteScreen,
    RsvpScreen,
    ScheduleScreen,
    SettingsScreen,
    SuspendContext,
    TerminalTextArea,
    UrlOpener,
    _open_url,
    _run_editor,
)


def run_tui(runtime: Runtime | None = None, *, account: str | None = None) -> None:
    """Run the interactive product without performing an implicit sync."""
    HcbApp(runtime, account=account).run()
