"""Textual workspace for the local-first HCB application."""

from __future__ import annotations

import calendar
import re
from datetime import date
from html.parser import HTMLParser
from pathlib import Path, PurePath
from threading import Event as ThreadEvent
from threading import Lock
from typing import ClassVar, Literal
from urllib.parse import quote_plus, urlparse
from zoneinfo import available_timezones

from rich._emoji_codes import EMOJI as RICH_EMOJI
from rich.style import Style
from rich.text import Text
from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, Vertical
from textual.css.stylesheet import Stylesheet
from textual.widgets import (
    Button,
    Footer,
    ListView,
    Static,
)

from .config import RoleStyle
from .environment import LocalEnvironment
from .runtime import Runtime

SURFACES = ("Tasks", "Notes", "Agenda", "Day", "Week", "Month")
MIN_SIDEBAR_WIDTH = 22
MIN_CENTER_WIDTH = 28
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
RECURRENCE_FREQUENCY_OPTIONS = (
    ("Does not repeat", "none"),
    ("Daily", "daily"),
    ("Weekly", "weekly"),
    ("Monthly", "monthly"),
    ("Yearly", "yearly"),
    ("Custom rule", "custom"),
)
LOCATION_MAP_ICON = "󰖟"

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


def google_maps_url(location: str) -> str | None:
    """Return a Google Maps search target for a non-empty event location."""
    query = location.strip()
    if not query:
        return None
    return f"https://www.google.com/maps/search/?api=1&query={quote_plus(query)}"


def _rrule_fields(rule: str) -> dict[str, str]:
    fields: dict[str, str] = {}
    for field in rule.split(";"):
        key, equals, value = field.partition("=")
        if equals:
            fields[key.upper()] = value
    return fields


def recurrence_frequency(recurrence: tuple[str, ...]) -> str:
    """Classify the first supported RRULE frequency for the event editor."""
    for line in recurrence:
        prefix, separator, rule = line.strip().partition(":")
        if prefix.upper() != "RRULE" or not separator:
            continue
        fields = _rrule_fields(rule)
        frequency = fields.get("FREQ", "").casefold()
        if frequency in {"daily", "weekly", "monthly", "yearly"}:
            return frequency
        return "custom"
    return "custom" if recurrence else "none"


def recurrence_with_frequency(recurrence: tuple[str, ...], frequency: str) -> tuple[str, ...]:
    """Apply a simple frequency while retaining any existing RRULE constraints."""
    if frequency == "none":
        return ()
    if frequency not in {"daily", "weekly", "monthly", "yearly"}:
        return recurrence
    replacement = f"FREQ={frequency.upper()}"
    for index, line in enumerate(recurrence):
        prefix, separator, rule = line.strip().partition(":")
        if prefix.upper() != "RRULE" or not separator:
            continue
        clauses = rule.split(";")
        replaced = False
        updated: list[str] = []
        for clause in clauses:
            key, equals, _value = clause.partition("=")
            if equals and key.upper() == "FREQ":
                updated.append(replacement)
                replaced = True
            else:
                updated.append(clause)
        if not replaced:
            updated.insert(0, replacement)
        return (*recurrence[:index], f"RRULE:{';'.join(updated)}", *recurrence[index + 1 :])
    return (*recurrence, f"RRULE:{replacement}")


def recurrence_summary(recurrence: tuple[str, ...]) -> str:
    """Turn common Google RRULEs into a concise, readable recurrence summary."""
    frequency = recurrence_frequency(recurrence)
    if frequency == "none":
        return "Does not repeat"
    if frequency == "custom":
        return "Custom recurrence"
    fields: dict[str, str] = {}
    for line in recurrence:
        prefix, separator, rule = line.strip().partition(":")
        if prefix.upper() == "RRULE" and separator:
            fields = _rrule_fields(rule)
            break
    interval = fields.get("INTERVAL", "1")
    unit = {
        "daily": "day",
        "weekly": "week",
        "monthly": "month",
        "yearly": "year",
    }[frequency]
    summary = f"Every {unit}" if interval == "1" else f"Every {interval} {unit}s"
    day_names = {
        "MO": "Monday",
        "TU": "Tuesday",
        "WE": "Wednesday",
        "TH": "Thursday",
        "FR": "Friday",
        "SA": "Saturday",
        "SU": "Sunday",
    }
    if by_day := fields.get("BYDAY"):
        summary += " on " + ", ".join(day_names.get(day[-2:], day) for day in by_day.split(","))
    if count := fields.get("COUNT"):
        summary += f" · {count} times"
    elif until := fields.get("UNTIL"):
        try:
            summary += f" · until {date.fromisoformat(until[:8]).strftime('%d %B %Y')}"
        except ValueError:
            summary += f" · until {until}"
    return summary


def linkify_urls(value: str | Text, *, link_style: Style | None = None) -> Text:
    """Underline and attach click targets to every safe web URL in displayed text."""
    text = value.copy() if isinstance(value, Text) else Text(value)
    for match in _URL_PATTERN.finditer(text.plain):
        url = match.group().rstrip(".,;:!?")
        while url.endswith(")") and url.count("(") < url.count(")"):
            url = url[:-1]
        if url and is_web_url(url):
            text.stylize(
                Style.combine((Style(link=url, underline=True), link_style or Style())),
                match.start(),
                match.start() + len(url),
            )
    return text


def role_rich_style(role: RoleStyle, *, link: str | None = None) -> Style:
    """Translate a serializable semantic role into a safe Rich display style."""
    color = role.color if role.color not in {None, "ansi_default", "transparent"} else None
    background = (
        role.background if role.background not in {None, "ansi_default", "transparent"} else None
    )
    parts = [Style(color=color, bgcolor=background), Style.parse(role.text_style)]
    if link is not None:
        parts.append(Style(link=link, underline=True))
    return Style.combine(parts)


class _HtmlToMarkdownParser(HTMLParser):
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
    parser = _HtmlToMarkdownParser()
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


def render_readonly_markup(value: str, *, link_style: Style | None = None) -> Text:
    """Render the supported Markdown and HTML subset used by read-only item views."""
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
    return linkify_urls(rendered, link_style=link_style)


# Re-export the supported widgets and modal workflows from the stable TUI module.
from .tui_actions import ActionMixin  # noqa: E402
from .tui_components import (  # noqa: E402, F401
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
    ItemViewScreen,
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
from .tui_lifecycle import LifecycleMixin  # noqa: E402
from .tui_workspace import WorkspaceMixin  # noqa: E402


class HcbApp(LifecycleMixin, WorkspaceMixin, ActionMixin, App[None]):
    """Configurable, cached terminal workspace."""

    CSS_PATH = "tui.tcss"
    TITLE = "Hot Cross Buns"
    SUB_TITLE = "local-first tasks and calendar"
    BINDINGS: ClassVar[list[Binding | tuple[str, str] | tuple[str, str, str]]] = [
        Binding("q", "quit", "Quit", id="quit"),
        Binding("?", "help", "Help", id="help"),
        Binding("/,ctrl+p", "palette", "Command", id="search"),
        Binding("n", "create", "New", id="create"),
        Binding("e", "edit", "Edit", id="edit"),
        Binding("space", "complete", "Complete", id="complete"),
        Binding("d", "delete", "Delete", id="delete"),
        Binding("r", "sync", "Sync", id="sync"),
        Binding("g", "jump", "Date", id="jump"),
        Binding("x", "mark", "Mark", id="mark"),
        Binding("v", "rsvp", "RSVP", id="rsvp"),
        Binding("u", "undo", "Undo", id="undo"),
        Binding("ctrl+r", "redo", "Redo", id="redo"),
        Binding("1", "surface('Tasks')", "Tasks", show=False, id="tasks"),
        Binding("2", "surface('Notes')", "Notes", show=False, id="notes"),
        Binding("3", "surface('Agenda')", "Agenda", show=False, id="agenda"),
        Binding("4", "surface('Day')", "Day", show=False, id="day"),
        Binding("5", "surface('Week')", "Week", show=False, id="week"),
        Binding("6", "surface('Month')", "Month", show=False, id="month"),
        Binding(
            "ctrl+alt+left",
            "resize_sidebar(-2)",
            "Narrow sidebar",
            show=False,
            id="resize_sidebar_narrower",
        ),
        Binding(
            "ctrl+alt+right",
            "resize_sidebar(2)",
            "Widen sidebar",
            show=False,
            id="resize_sidebar_wider",
        ),
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
        self.runtime = runtime or Runtime()
        stylesheet_error: str | None = None
        css_paths: list[str | PurePath] = [Path(__file__).with_name("tui.tcss")]
        stylesheet = self.runtime.config.theme.stylesheet
        if stylesheet is not None:
            stylesheet_path = Path(stylesheet).expanduser()
            if not stylesheet_path.is_absolute():
                stylesheet_path = self.runtime.paths.config_dir / stylesheet_path
            try:
                probe = Stylesheet()
                probe.read(stylesheet_path)
                probe.parse()
            except Exception as exc:
                stylesheet_error = f"Custom stylesheet not applied: {exc}"
            else:
                css_paths.append(stylesheet_path)
        super().__init__(css_path=css_paths)
        self._stylesheet_error = stylesheet_error
        self.explicit_account = account
        self.account_id: str | None = None
        self.selected_date = selected_date or self._present_date()
        self.surface = self.runtime.config.tui.initial_surface
        self.cache = CachedWorkspace()
        self.selected: tuple[str, str] | None = None
        self.resource_filter: tuple[str, str] | None = None
        self.marked: set[str] = set()
        self.marked_events: set[str] = set()
        self._mini_month_days: dict[str, date] = {}
        self.sidebar_width = self.runtime.config.tui.sidebar_width
        self._resize_target: Literal["sidebar"] | None = None
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
        yield Footer()


def run_tui(runtime: Runtime | None = None, *, account: str | None = None) -> None:
    """Run the interactive product without performing an implicit sync."""
    HcbApp(runtime, account=account).run()
