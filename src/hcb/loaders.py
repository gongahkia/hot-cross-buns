"""Rattles-compatible loading-indicator presets."""

# Frame data is ported from https://github.com/vyfor/rattles at
# 6eabf671ee86ddd773f458b9c25ef9d3f00ae53b (2026-06-11).
#
# MIT License
#
# Copyright (c) 2026 vyfor
#
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in all
# copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
# SOFTWARE.

from __future__ import annotations

import json
from dataclasses import dataclass

RATTLES_SOURCE_REVISION = "6eabf671ee86ddd773f458b9c25ef9d3f00ae53b"
DEFAULT_LOADER = "braille.dots"


@dataclass(frozen=True, slots=True)
class LoaderPreset:
    """One animated Rattles loader with its upstream timing."""

    name: str
    interval_ms: int
    frames: tuple[str, ...]

    def frame_at(self, elapsed_seconds: float) -> str:
        """Return the upstream frame for a monotonic elapsed duration."""
        frame_index = int(max(0.0, elapsed_seconds) * 1_000 // self.interval_ms)
        return self.frames[frame_index % len(self.frames)]


_RAW_PRESETS = r'''
[
  [
    "arrows.arrow",
    100,
    [
      "←",
      "↖",
      "↑",
      "↗",
      "→",
      "↘",
      "↓",
      "↙"
    ]
  ],
  [
    "arrows.double_arrow",
    100,
    [
      "⇐",
      "⇖",
      "⇑",
      "⇗",
      "⇒",
      "⇘",
      "⇓",
      "⇙"
    ]
  ],
  [
    "ascii.dqpb",
    100,
    [
      "d",
      "q",
      "p",
      "b"
    ]
  ],
  [
    "ascii.rolling_line",
    80,
    [
      "/",
      "-",
      "\\",
      "|",
      "\\",
      "-"
    ]
  ],
  [
    "ascii.simple_dots",
    400,
    [
      ".  ",
      ".. ",
      "...",
      "   "
    ]
  ],
  [
    "ascii.simple_dots_scrolling",
    200,
    [
      ".  ",
      ".. ",
      "...",
      " ..",
      "  .",
      "   "
    ]
  ],
  [
    "ascii.arc",
    100,
    [
      "◜",
      "◠",
      "◝",
      "◞",
      "◡",
      "◟"
    ]
  ],
  [
    "ascii.balloon",
    120,
    [
      ".",
      "o",
      "O",
      "o",
      "."
    ]
  ],
  [
    "ascii.circle_halves",
    50,
    [
      "◐",
      "◓",
      "◑",
      "◒"
    ]
  ],
  [
    "ascii.circle_quarters",
    120,
    [
      "◴",
      "◷",
      "◶",
      "◵"
    ]
  ],
  [
    "ascii.point",
    200,
    [
      "···",
      "•··",
      "·•·",
      "··•",
      "···"
    ]
  ],
  [
    "ascii.square_corners",
    180,
    [
      "◰",
      "◳",
      "◲",
      "◱"
    ]
  ],
  [
    "ascii.toggle",
    250,
    [
      "⊶",
      "⊷"
    ]
  ],
  [
    "ascii.triangle",
    50,
    [
      "◢",
      "◣",
      "◤",
      "◥"
    ]
  ],
  [
    "ascii.grow_horizontal",
    120,
    [
      "▏",
      "▎",
      "▍",
      "▌",
      "▋",
      "▊",
      "▉",
      "▊",
      "▋",
      "▌",
      "▍",
      "▎"
    ]
  ],
  [
    "ascii.grow_vertical",
    120,
    [
      "▁",
      "▃",
      "▄",
      "▅",
      "▆",
      "▇",
      "▆",
      "▅",
      "▄",
      "▃"
    ]
  ],
  [
    "ascii.noise",
    100,
    [
      "▓",
      "▒",
      "░",
      " ",
      "░",
      "▒"
    ]
  ],
  [
    "braille.dots",
    80,
    [
      "⠋",
      "⠙",
      "⠹",
      "⠸",
      "⠼",
      "⠴",
      "⠦",
      "⠧",
      "⠇",
      "⠏"
    ]
  ],
  [
    "braille.dots2",
    80,
    [
      "⣾",
      "⣽",
      "⣻",
      "⢿",
      "⡿",
      "⣟",
      "⣯",
      "⣷"
    ]
  ],
  [
    "braille.dots3",
    80,
    [
      "⠋",
      "⠙",
      "⠚",
      "⠞",
      "⠖",
      "⠦",
      "⠴",
      "⠲",
      "⠳",
      "⠓"
    ]
  ],
  [
    "braille.dots4",
    80,
    [
      "⠄",
      "⠆",
      "⠇",
      "⠋",
      "⠙",
      "⠸",
      "⠰",
      "⠠",
      "⠰",
      "⠸",
      "⠙",
      "⠋",
      "⠇",
      "⠆"
    ]
  ],
  [
    "braille.dots5",
    80,
    [
      "⠋",
      "⠙",
      "⠚",
      "⠒",
      "⠂",
      "⠂",
      "⠒",
      "⠲",
      "⠴",
      "⠦",
      "⠖",
      "⠒",
      "⠐",
      "⠐",
      "⠒",
      "⠓",
      "⠋"
    ]
  ],
  [
    "braille.dots6",
    80,
    [
      "⠁",
      "⠉",
      "⠙",
      "⠚",
      "⠒",
      "⠂",
      "⠂",
      "⠒",
      "⠲",
      "⠴",
      "⠤",
      "⠄",
      "⠄",
      "⠤",
      "⠴",
      "⠲",
      "⠒",
      "⠂",
      "⠂",
      "⠒",
      "⠚",
      "⠙",
      "⠉",
      "⠁"
    ]
  ],
  [
    "braille.dots7",
    80,
    [
      "⠈",
      "⠉",
      "⠋",
      "⠓",
      "⠒",
      "⠐",
      "⠐",
      "⠒",
      "⠖",
      "⠦",
      "⠤",
      "⠠",
      "⠠",
      "⠤",
      "⠦",
      "⠖",
      "⠒",
      "⠐",
      "⠐",
      "⠒",
      "⠓",
      "⠋",
      "⠉",
      "⠈"
    ]
  ],
  [
    "braille.dots8",
    80,
    [
      "⠁",
      "⠁",
      "⠉",
      "⠙",
      "⠚",
      "⠒",
      "⠂",
      "⠂",
      "⠒",
      "⠲",
      "⠴",
      "⠤",
      "⠄",
      "⠄",
      "⠤",
      "⠠",
      "⠠",
      "⠤",
      "⠦",
      "⠖",
      "⠒",
      "⠐",
      "⠐",
      "⠒",
      "⠓",
      "⠋",
      "⠉",
      "⠈",
      "⠈"
    ]
  ],
  [
    "braille.dots9",
    80,
    [
      "⢹",
      "⢺",
      "⢼",
      "⣸",
      "⣇",
      "⡧",
      "⡗",
      "⡏"
    ]
  ],
  [
    "braille.dots10",
    80,
    [
      "⢄",
      "⢂",
      "⢁",
      "⡁",
      "⡈",
      "⡐",
      "⡠"
    ]
  ],
  [
    "braille.dots11",
    100,
    [
      "⠁",
      "⠂",
      "⠄",
      "⡀",
      "⢀",
      "⠠",
      "⠐",
      "⠈"
    ]
  ],
  [
    "braille.dots12",
    80,
    [
      "⢀⠀",
      "⡀⠀",
      "⠄⠀",
      "⢂⠀",
      "⡂⠀",
      "⠅⠀",
      "⢃⠀",
      "⡃⠀",
      "⠍⠀",
      "⢋⠀",
      "⡋⠀",
      "⠍⠁",
      "⢋⠁",
      "⡋⠁",
      "⠍⠉",
      "⠋⠉",
      "⠋⠉",
      "⠉⠙",
      "⠉⠙",
      "⠉⠩",
      "⠈⢙",
      "⠈⡙",
      "⢈⠩",
      "⡀⢙",
      "⠄⡙",
      "⢂⠩",
      "⡂⢘",
      "⠅⡘",
      "⢃⠨",
      "⡃⢐",
      "⠍⡐",
      "⢋⠠",
      "⡋⢀",
      "⠍⡁",
      "⢋⠁",
      "⡋⠁",
      "⠍⠉",
      "⠋⠉",
      "⠋⠉",
      "⠉⠙",
      "⠉⠙",
      "⠉⠩",
      "⠈⢙",
      "⠈⡙",
      "⠈⠩",
      "⠀⢙",
      "⠀⡙",
      "⠀⠩",
      "⠀⢘",
      "⠀⡘",
      "⠀⠨",
      "⠀⢐",
      "⠀⡐",
      "⠀⠠",
      "⠀⢀",
      "⠀⡀"
    ]
  ],
  [
    "braille.dots13",
    80,
    [
      "⣼",
      "⣹",
      "⢻",
      "⠿",
      "⡟",
      "⣏",
      "⣧",
      "⣶"
    ]
  ],
  [
    "braille.dots14",
    80,
    [
      "⠉⠉",
      "⠈⠙",
      "⠀⠹",
      "⠀⢸",
      "⠀⣰",
      "⢀⣠",
      "⣀⣀",
      "⣄⡀",
      "⣆⠀",
      "⡇⠀",
      "⠏⠀",
      "⠋⠁"
    ]
  ],
  [
    "braille.sand",
    80,
    [
      "⠁",
      "⠂",
      "⠄",
      "⡀",
      "⡈",
      "⡐",
      "⡠",
      "⣀",
      "⣁",
      "⣂",
      "⣄",
      "⣌",
      "⣔",
      "⣤",
      "⣥",
      "⣦",
      "⣮",
      "⣶",
      "⣷",
      "⣿",
      "⡿",
      "⠿",
      "⢟",
      "⠟",
      "⡛",
      "⠛",
      "⠫",
      "⢋",
      "⠋",
      "⠍",
      "⡉",
      "⠉",
      "⠑",
      "⠡",
      "⢁"
    ]
  ],
  [
    "braille.bounce",
    120,
    [
      "⠁",
      "⠂",
      "⠄",
      "⡀",
      "⠄",
      "⠂"
    ]
  ],
  [
    "braille.dots_circle",
    80,
    [
      "⢎ ",
      "⠎⠁",
      "⠊⠑",
      "⠈⠱",
      " ⡱",
      "⢀⡰",
      "⢄⡠",
      "⢆⡀"
    ]
  ],
  [
    "braille.wave",
    100,
    [
      "⠁⠂⠄⡀",
      "⠂⠄⡀⢀",
      "⠄⡀⢀⠠",
      "⡀⢀⠠⠐",
      "⢀⠠⠐⠈",
      "⠠⠐⠈⠁",
      "⠐⠈⠁⠂",
      "⠈⠁⠂⠄"
    ]
  ],
  [
    "braille.scan",
    70,
    [
      "⠀⠀⠀⠀",
      "⡇⠀⠀⠀",
      "⣿⠀⠀⠀",
      "⢸⡇⠀⠀",
      "⠀⣿⠀⠀",
      "⠀⢸⡇⠀",
      "⠀⠀⣿⠀",
      "⠀⠀⢸⡇",
      "⠀⠀⠀⣿",
      "⠀⠀⠀⢸"
    ]
  ],
  [
    "braille.rain",
    100,
    [
      "⢁⠂⠔⠈",
      "⠂⠌⡠⠐",
      "⠄⡐⢀⠡",
      "⡈⠠⠀⢂",
      "⠐⢀⠁⠄",
      "⠠⠁⠊⡀",
      "⢁⠂⠔⠈",
      "⠂⠌⡠⠐",
      "⠄⡐⢀⠡",
      "⡈⠠⠀⢂",
      "⠐⢀⠁⠄",
      "⠠⠁⠊⡀"
    ]
  ],
  [
    "braille.pulse",
    180,
    [
      "⠀⠶⠀",
      "⠰⣿⠆",
      "⢾⣉⡷",
      "⣏⠀⣹",
      "⡁⠀⢈"
    ]
  ],
  [
    "braille.snake",
    80,
    [
      "⣁⡀",
      "⣉⠀",
      "⡉⠁",
      "⠉⠉",
      "⠈⠙",
      "⠀⠛",
      "⠐⠚",
      "⠒⠒",
      "⠖⠂",
      "⠶⠀",
      "⠦⠄",
      "⠤⠤",
      "⠠⢤",
      "⠀⣤",
      "⢀⣠",
      "⣀⣀"
    ]
  ],
  [
    "braille.sparkle",
    150,
    [
      "⡡⠊⢔⠡",
      "⠊⡰⡡⡘",
      "⢔⢅⠈⢢",
      "⡁⢂⠆⡍",
      "⢔⠨⢑⢐",
      "⠨⡑⡠⠊"
    ]
  ],
  [
    "braille.cascade",
    60,
    [
      "⠀⠀⠀⠀",
      "⠀⠀⠀⠀",
      "⠁⠀⠀⠀",
      "⠋⠀⠀⠀",
      "⠞⠁⠀⠀",
      "⡴⠋⠀⠀",
      "⣠⠞⠁⠀",
      "⢀⡴⠋⠀",
      "⠀⣠⠞⠁",
      "⠀⢀⡴⠋",
      "⠀⠀⣠⠞",
      "⠀⠀⢀⡴",
      "⠀⠀⠀⣠",
      "⠀⠀⠀⢀"
    ]
  ],
  [
    "braille.columns",
    60,
    [
      "⡀⠀⠀",
      "⡄⠀⠀",
      "⡆⠀⠀",
      "⡇⠀⠀",
      "⣇⠀⠀",
      "⣧⠀⠀",
      "⣷⠀⠀",
      "⣿⠀⠀",
      "⣿⡀⠀",
      "⣿⡄⠀",
      "⣿⡆⠀",
      "⣿⡇⠀",
      "⣿⣇⠀",
      "⣿⣧⠀",
      "⣿⣷⠀",
      "⣿⣿⠀",
      "⣿⣿⡀",
      "⣿⣿⡄",
      "⣿⣿⡆",
      "⣿⣿⡇",
      "⣿⣿⣇",
      "⣿⣿⣧",
      "⣿⣿⣷",
      "⣿⣿⣿",
      "⣿⣿⣿",
      "⠀⠀⠀"
    ]
  ],
  [
    "braille.orbit",
    100,
    [
      "⠃",
      "⠉",
      "⠘",
      "⠰",
      "⢠",
      "⣀",
      "⡄",
      "⠆"
    ]
  ],
  [
    "braille.breathe",
    100,
    [
      "⠀",
      "⠂",
      "⠌",
      "⡑",
      "⢕",
      "⢝",
      "⣫",
      "⣟",
      "⣿",
      "⣟",
      "⣫",
      "⢝",
      "⢕",
      "⡑",
      "⠌",
      "⠂",
      "⠀"
    ]
  ],
  [
    "braille.waverows",
    90,
    [
      "⠖⠉⠉⠑",
      "⡠⠖⠉⠉",
      "⣠⡠⠖⠉",
      "⣄⣠⡠⠖",
      "⠢⣄⣠⡠",
      "⠙⠢⣄⣠",
      "⠉⠙⠢⣄",
      "⠊⠉⠙⠢",
      "⠜⠊⠉⠙",
      "⡤⠜⠊⠉",
      "⣀⡤⠜⠊",
      "⢤⣀⡤⠜",
      "⠣⢤⣀⡤",
      "⠑⠣⢤⣀",
      "⠉⠑⠣⢤",
      "⠋⠉⠑⠣"
    ]
  ],
  [
    "braille.checkerboard",
    250,
    [
      "⢕⢕⢕",
      "⡪⡪⡪",
      "⢊⠔⡡",
      "⡡⢊⠔"
    ]
  ],
  [
    "braille.helix",
    80,
    [
      "⢌⣉⢎⣉",
      "⣉⡱⣉⡱",
      "⣉⢎⣉⢎",
      "⡱⣉⡱⣉",
      "⢎⣉⢎⣉",
      "⣉⡱⣉⡱",
      "⣉⢎⣉⢎",
      "⡱⣉⡱⣉",
      "⢎⣉⢎⣉",
      "⣉⡱⣉⡱",
      "⣉⢎⣉⢎",
      "⡱⣉⡱⣉",
      "⢎⣉⢎⣉",
      "⣉⡱⣉⡱",
      "⣉⢎⣉⢎",
      "⡱⣉⡱⣉"
    ]
  ],
  [
    "braille.fillsweep",
    100,
    [
      "⣀⣀",
      "⣤⣤",
      "⣶⣶",
      "⣿⣿",
      "⣿⣿",
      "⣿⣿",
      "⣶⣶",
      "⣤⣤",
      "⣀⣀",
      "⠀⠀",
      "⠀⠀"
    ]
  ],
  [
    "braille.diagswipe",
    60,
    [
      "⠁⠀",
      "⠋⠀",
      "⠟⠁",
      "⡿⠋",
      "⣿⠟",
      "⣿⡿",
      "⣿⣿",
      "⣿⣿",
      "⣾⣿",
      "⣴⣿",
      "⣠⣾",
      "⢀⣴",
      "⠀⣠",
      "⠀⢀",
      "⠀⠀",
      "⠀⠀"
    ]
  ],
  [
    "braille.infinity",
    60,
    [
      "⢎⡱⣉⠆",
      "⢎⡱⣈⠆",
      "⢎⡱⣀⠆",
      "⢎⡱⣀⠄",
      "⢎⡱⣀ ",
      "⢎⡱⡀ ",
      "⢎⡱  ",
      "⢎⡱  ",
      "⢎⡡  ",
      "⢎⡠  ",
      "⢆⡠  ",
      "⢄⡠  ",
      "⢀⡠  ",
      " ⡠  ",
      " ⠠  ",
      " ⠰  ",
      " ⠐  ",
      " ⠐⠁ ",
      " ⠐⠉ ",
      " ⠐⠉⠂",
      " ⠐⠉⠆",
      " ⠐⢉⠆",
      " ⠐⣉⠆",
      " ⠰⣉⠆",
      " ⠰⣉⠆",
      " ⠱⣉⠆",
      "⠈⠱⣉⠆",
      "⠊⠱⣉⠆",
      "⠎⠱⣉⠆",
      "⢎⠱⣉⠆",
      "⢎⡱⣉⠆",
      "⢎⡱⣉⠆"
    ]
  ],
  [
    "emoji.hearts",
    120,
    [
      "🩷",
      "🧡",
      "💛",
      "💚",
      "💙",
      "🩵",
      "💜",
      "🤎",
      "🖤",
      "🩶",
      "🤍"
    ]
  ],
  [
    "emoji.clock",
    100,
    [
      "🕛",
      "🕐",
      "🕑",
      "🕒",
      "🕓",
      "🕔",
      "🕕",
      "🕖",
      "🕗",
      "🕘",
      "🕙",
      "🕚"
    ]
  ],
  [
    "emoji.earth",
    180,
    [
      "🌍",
      "🌎",
      "🌏"
    ]
  ],
  [
    "emoji.moon",
    80,
    [
      "🌑",
      "🌒",
      "🌓",
      "🌔",
      "🌕",
      "🌖",
      "🌗",
      "🌘"
    ]
  ],
  [
    "emoji.speaker",
    160,
    [
      "🔈",
      "🔉",
      "🔊",
      "🔉"
    ]
  ],
  [
    "emoji.weather",
    100,
    [
      "☀️",
      "🌤",
      "⛅️",
      "🌥",
      "☁️",
      "🌧",
      "🌨",
      "⛈"
    ]
  ]
]
'''


def _presets() -> dict[str, LoaderPreset]:
    raw_presets = json.loads(_RAW_PRESETS)
    if not isinstance(raw_presets, list):  # pragma: no cover - module constant
        raise RuntimeError("Rattles preset data must be a list")
    result: dict[str, LoaderPreset] = {}
    for item in raw_presets:
        if not isinstance(item, list) or len(item) != 3:  # pragma: no cover - module constant
            raise RuntimeError("Rattles preset data is malformed")
        name, interval_ms, frames = item
        if (
            not isinstance(name, str)
            or type(interval_ms) is not int
            or not isinstance(frames, list)
            or not frames
            or not all(isinstance(frame, str) for frame in frames)
        ):  # pragma: no cover - module constant
            raise RuntimeError("Rattles preset data is malformed")
        result[name] = LoaderPreset(name, interval_ms, tuple(frames))
    if DEFAULT_LOADER not in result:  # pragma: no cover - module constant
        raise RuntimeError("Rattles default loader is missing")
    return result


LOADER_PRESETS = _presets()
LOADER_NAMES = tuple(LOADER_PRESETS)


def loader_preset(name: str) -> LoaderPreset:
    """Look up a configured Rattles loader."""
    return LOADER_PRESETS[name]
