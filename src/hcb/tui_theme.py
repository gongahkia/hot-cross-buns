"""Bridge HCB's semantic theme contract to Textual's theme API."""

from __future__ import annotations

from textual.theme import Theme as TextualTheme

from .config import ThemeColors


def build_textual_theme(name: str, colors: ThemeColors, *, dark: bool) -> TextualTheme:
    """Map every HCB semantic color to the corresponding Textual token."""
    return TextualTheme(
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
        dark=dark,
        variables={
            # Textual derives a transparent boost whenever a panel is supplied.
            # HCB controls must always use the configured semantic control color.
            "boost": colors.control,
            "text-muted": colors.muted,
            "border": colors.border,
            "border-blurred": colors.border,
            "footer-background": colors.overlay,
            "input-selection-background": colors.selection,
            "screen-selection-background": colors.selection,
        },
    )
