import type { AppColorThemeId } from "./ipc/themeCatalog";

export const googleCalendarEventColorIds = [
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "11"
] as const;

export type GoogleCalendarEventColorId = (typeof googleCalendarEventColorIds)[number];

export interface GoogleCalendarEventColor {
  id: GoogleCalendarEventColorId;
  label: string;
  background: string;
  foreground: string;
}

export interface CalendarEventColorPair {
  background: string;
  foreground: string;
}

export type CalendarEventColorOverrides = Partial<Record<GoogleCalendarEventColorId, CalendarEventColorPair>>;

export const googleCalendarEventColors: readonly GoogleCalendarEventColor[] = [
  { id: "1", label: "Lavender", background: "#a4bdfc", foreground: "#1d1d1d" },
  { id: "2", label: "Sage", background: "#7ae7bf", foreground: "#1d1d1d" },
  { id: "3", label: "Grape", background: "#dbadff", foreground: "#1d1d1d" },
  { id: "4", label: "Flamingo", background: "#ff887c", foreground: "#1d1d1d" },
  { id: "5", label: "Banana", background: "#fbd75b", foreground: "#1d1d1d" },
  { id: "6", label: "Tangerine", background: "#ffb878", foreground: "#1d1d1d" },
  { id: "7", label: "Peacock", background: "#46d6db", foreground: "#1d1d1d" },
  { id: "8", label: "Graphite", background: "#e1e1e1", foreground: "#1d1d1d" },
  { id: "9", label: "Blueberry", background: "#5484ed", foreground: "#ffffff" },
  { id: "10", label: "Basil", background: "#51b749", foreground: "#ffffff" },
  { id: "11", label: "Tomato", background: "#dc2127", foreground: "#ffffff" }
];

export const googleCalendarEventColorById = Object.fromEntries(
  googleCalendarEventColors.map((color) => [color.id, color])
) as Record<GoogleCalendarEventColorId, GoogleCalendarEventColor>;

export function googleCalendarEventColor(colorId: string | null | undefined): GoogleCalendarEventColor | null {
  if (!colorId || !isGoogleCalendarEventColorId(colorId)) {
    return null;
  }

  return googleCalendarEventColorById[colorId];
}

export function isGoogleCalendarEventColorId(colorId: string): colorId is GoogleCalendarEventColorId {
  return googleCalendarEventColorIds.includes(colorId as GoogleCalendarEventColorId);
}

type CalendarEventColorTuple = readonly [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string
];

export type ThemeCalendarEventColorMap = Record<GoogleCalendarEventColorId, CalendarEventColorPair>;

export const themeCalendarEventColorMaps = {
  notion: eventColorMap(["#9B8AFB", "#6B8F71", "#9F6B8F", "#D97373", "#D6A100", "#C76E3D", "#4B9AB0", "#787774", "#2F80ED", "#448361", "#D44C47"]),
  oneDarkPro: eventColorMap(["#A78BFA", "#98C379", "#C678DD", "#E06C75", "#E5C07B", "#D19A66", "#56B6C2", "#7F848E", "#61AFEF", "#98C379", "#E06C75"]),
  githubDark: eventColorMap(["#A371F7", "#3FB950", "#BC8CFF", "#F85149", "#D29922", "#DB6D28", "#39C5CF", "#8B949E", "#58A6FF", "#3FB950", "#F85149"]),
  githubLight: eventColorMap(["#8250DF", "#1A7F37", "#A475F9", "#CF222E", "#BF8700", "#BC4C00", "#3192AA", "#6E7781", "#0969DA", "#1A7F37", "#CF222E"]),
  dracula: eventColorMap(["#BD93F9", "#50FA7B", "#FF79C6", "#FF5555", "#F1FA8C", "#FFB86C", "#8BE9FD", "#6272A4", "#8BE9FD", "#50FA7B", "#FF5555"]),
  solarizedDark: eventColorMap(["#6C71C4", "#859900", "#D33682", "#DC322F", "#B58900", "#CB4B16", "#2AA198", "#586E75", "#268BD2", "#859900", "#DC322F"]),
  solarizedLight: eventColorMap(["#6C71C4", "#859900", "#D33682", "#DC322F", "#B58900", "#CB4B16", "#2AA198", "#586E75", "#268BD2", "#859900", "#DC322F"]),
  monokai: eventColorMap(["#AE81FF", "#A6E22E", "#C678DD", "#F92672", "#E6DB74", "#FD971F", "#66D9EF", "#75715E", "#66D9EF", "#A6E22E", "#F92672"]),
  tokyoNight: eventColorMap(["#BB9AF7", "#9ECE6A", "#BB9AF7", "#F7768E", "#E0AF68", "#FF9E64", "#73DACA", "#565F89", "#7AA2F7", "#9ECE6A", "#F7768E"]),
  materialPalenight: eventColorMap(["#C792EA", "#C3E88D", "#C792EA", "#F07178", "#FFCB6B", "#F78C6C", "#89DDFF", "#676E95", "#82AAFF", "#C3E88D", "#F07178"]),
  nord: eventColorMap(["#B48EAD", "#A3BE8C", "#B48EAD", "#BF616A", "#EBCB8B", "#D08770", "#88C0D0", "#4C566A", "#5E81AC", "#A3BE8C", "#BF616A"]),
  gruvboxDark: eventColorMap(["#D3869B", "#B8BB26", "#B16286", "#FB4934", "#FABD2F", "#FE8019", "#8EC07C", "#928374", "#83A598", "#B8BB26", "#FB4934"]),
  gruvboxLight: eventColorMap(["#B16286", "#79740E", "#8F3F71", "#CC241D", "#B57614", "#AF3A03", "#427B58", "#7C6F64", "#076678", "#79740E", "#9D0006"]),
  catppuccinMocha: eventColorMap(["#B4BEFE", "#A6E3A1", "#CBA6F7", "#F38BA8", "#F9E2AF", "#FAB387", "#94E2D5", "#6C7086", "#89B4FA", "#A6E3A1", "#F38BA8"]),
  catppuccinLatte: eventColorMap(["#7287FD", "#40A02B", "#8839EF", "#D20F39", "#DF8E1D", "#FE640B", "#179299", "#7C7F93", "#1E66F5", "#40A02B", "#D20F39"]),
  ayuDark: eventColorMap(["#D2A6FF", "#AAD94C", "#C792EA", "#F07178", "#FFCC66", "#FFB454", "#95E6CB", "#626A73", "#59C2FF", "#AAD94C", "#F07178"]),
  ayuLight: eventColorMap(["#A37ACC", "#86B300", "#A37ACC", "#F07171", "#F2AE49", "#FF6A00", "#4CBF99", "#ABB0B6", "#36A3D9", "#86B300", "#F07171"]),
  ayuMirage: eventColorMap(["#DFBFFF", "#87D96C", "#C792EA", "#F28779", "#FFD173", "#FFAD66", "#95E6CB", "#707A8C", "#73D0FF", "#87D96C", "#F28779"]),
  nightOwl: eventColorMap(["#C792EA", "#ADDB67", "#C792EA", "#EF5350", "#FFEB95", "#F78C6C", "#7FDBCA", "#637777", "#82AAFF", "#ADDB67", "#EF5350"]),
  oneLight: eventColorMap(["#A626A4", "#50A14F", "#A626A4", "#E45649", "#C18401", "#D75F00", "#0184BC", "#696C77", "#4078F2", "#50A14F", "#E45649"]),
  rosePine: eventColorMap(["#C4A7E7", "#9CCFD8", "#C4A7E7", "#EB6F92", "#F6C177", "#EA9D34", "#31748F", "#6E6A86", "#9CCFD8", "#95B1AC", "#EB6F92"]),
  rosePineMoon: eventColorMap(["#C4A7E7", "#9CCFD8", "#C4A7E7", "#EA9A97", "#F6C177", "#EA9D34", "#9CCFD8", "#6E6A86", "#3E8FB0", "#9CCFD8", "#EB6F92"]),
  rosePineDawn: eventColorMap(["#907AA9", "#56949F", "#907AA9", "#B4637A", "#EA9D34", "#D7827E", "#56949F", "#9893A5", "#286983", "#56949F", "#B4637A"]),
  kanagawa: eventColorMap(["#938AA9", "#98BB6C", "#957FB8", "#E82424", "#E6C384", "#FFA066", "#7AA89F", "#727169", "#7E9CD8", "#98BB6C", "#E82424"]),
  everforestDark: eventColorMap(["#D699B6", "#A7C080", "#D699B6", "#E67E80", "#DBBC7F", "#E69875", "#83C092", "#859289", "#7FBBB3", "#A7C080", "#E67E80"]),
  everforestLight: eventColorMap(["#8F5E99", "#8DA101", "#8F5E99", "#F85552", "#DFA000", "#F57D26", "#35A77C", "#939F91", "#3A94C5", "#8DA101", "#F85552"]),
  moonlight: eventColorMap(["#C099FF", "#C3E88D", "#C099FF", "#FF757F", "#FFC777", "#FF966C", "#86E1FC", "#828BB8", "#82AAFF", "#C3E88D", "#FF757F"]),
  cobalt2: eventColorMap(["#C792EA", "#3AD900", "#C792EA", "#FF628C", "#FFC600", "#FF9D00", "#80FCFF", "#55718B", "#9EFFFF", "#3AD900", "#FF628C"]),
  synthwave84: eventColorMap(["#B893CE", "#72F1B8", "#FF7EDB", "#FE4450", "#FDE74C", "#FEDE5D", "#36F9F6", "#848BB3", "#36F9F6", "#72F1B8", "#FE4450"]),
  shadesOfPurple: eventColorMap(["#B362FF", "#3AD900", "#B362FF", "#FF628C", "#FAD000", "#FF9D00", "#9EFFFF", "#8080A0", "#9EFFFF", "#3AD900", "#FF628C"]),
  oceanicNext: eventColorMap(["#C594C5", "#99C794", "#C594C5", "#EC5F67", "#FAC863", "#F99157", "#5FB3B3", "#65737E", "#6699CC", "#99C794", "#EC5F67"]),
  tomorrowNight: eventColorMap(["#B294BB", "#B5BD68", "#B294BB", "#CC6666", "#F0C674", "#DE935F", "#8ABEB7", "#969896", "#81A2BE", "#B5BD68", "#CC6666"]),
  zenburn: eventColorMap(["#DC8CC3", "#7F9F7F", "#DC8CC3", "#CC9393", "#F0DFAF", "#DFAF8F", "#8CD0D3", "#7F7F7F", "#8CD0D3", "#7F9F7F", "#CC9393"]),
  horizon: eventColorMap(["#B877DB", "#29D398", "#B877DB", "#E95678", "#FAB795", "#F09383", "#26BBD9", "#6C6F93", "#59C2FF", "#29D398", "#E95678"]),
  iceberg: eventColorMap(["#A093C7", "#B5BF77", "#A093C7", "#E27878", "#E2A478", "#E9B189", "#89B8C2", "#6B7089", "#84A0C6", "#B5BF77", "#E27878"]),
  pandaSyntax: eventColorMap(["#B084EB", "#19F9D8", "#FF75B5", "#FF2C6D", "#FFB86C", "#FF9AC1", "#45A9F9", "#676B79", "#45A9F9", "#19F9D8", "#FF2C6D"]),
  poimandres: eventColorMap(["#A48CF2", "#5DE4C7", "#A48CF2", "#D0679D", "#FFFAC2", "#F7C67F", "#89DDFF", "#767C9D", "#91B4D5", "#5DE4C7", "#D0679D"]),
  vitesseDark: eventColorMap(["#BDABFF", "#4D9375", "#A587BE", "#CB7676", "#E6CC77", "#C99076", "#5EAAB5", "#758575", "#6394BF", "#4D9375", "#CB7676"]),
  vitesseLight: eventColorMap(["#6B60BF", "#1E754F", "#8E5E99", "#B54A4A", "#A06A00", "#B85C00", "#2993A3", "#77736A", "#2B7BB9", "#1E754F", "#B54A4A"]),
  hotcrossbuns: eventColorMap(["#9B5DE5", "#3C7255", "#9B5DE5", "#D9485B", "#E8B83E", "#F66B3B", "#00A6A6", "#7A7167", "#1677FF", "#3C7255", "#D9485B"])
} satisfies Record<AppColorThemeId, ThemeCalendarEventColorMap>;

export function themeCalendarEventColor(
  themeId: AppColorThemeId | null | undefined,
  colorId: string | null | undefined
): CalendarEventColorPair | null {
  if (!themeId || !colorId || !isGoogleCalendarEventColorId(colorId)) {
    return null;
  }

  return themeCalendarEventColorMaps[themeId]?.[colorId] ?? null;
}

export function resolveCalendarEventDisplayColor({
  calendarBackgroundColor,
  calendarForegroundColor,
  colorId,
  colorThemeId,
  overrides
}: {
  calendarBackgroundColor?: string | null;
  calendarForegroundColor?: string | null;
  colorId: string | null | undefined;
  colorThemeId?: AppColorThemeId | null;
  overrides: CalendarEventColorOverrides;
}): CalendarEventColorPair {
  const googleColor = googleCalendarEventColor(colorId);
  const override = googleColor ? overrides[googleColor.id] : undefined;
  const themeColor = themeCalendarEventColor(colorThemeId, colorId);

  if (override) {
    return override;
  }

  if (themeColor) {
    return themeColor;
  }

  if (googleColor) {
    return {
      background: googleColor.background,
      foreground: googleColor.foreground
    };
  }

  return {
    background: calendarBackgroundColor ?? "",
    foreground: calendarForegroundColor ?? ""
  };
}

function eventColorMap(colors: CalendarEventColorTuple): ThemeCalendarEventColorMap {
  return Object.fromEntries(
    googleCalendarEventColorIds.map((id, index) => {
      const background = normalizeCalendarEventHex(colors[index]);

      return [
        id,
        {
          background,
          foreground: readableCalendarEventTextColor(background)
        }
      ];
    })
  ) as ThemeCalendarEventColorMap;
}

function normalizeCalendarEventHex(value: string): string {
  const raw = value.trim().replace(/^#/, "");

  if (!/^[\da-f]{6}$/i.test(raw)) {
    return "#000000";
  }

  return `#${raw.toUpperCase()}`;
}

function readableCalendarEventTextColor(background: string): string {
  return contrastRatio(background, "#000000") >= contrastRatio(background, "#FFFFFF")
    ? "#000000"
    : "#FFFFFF";
}

function contrastRatio(left: string, right: string): number {
  const leftLuminance = relativeLuminance(left);
  const rightLuminance = relativeLuminance(right);
  const light = Math.max(leftLuminance, rightLuminance);
  const dark = Math.min(leftLuminance, rightLuminance);

  return (light + 0.05) / (dark + 0.05);
}

function relativeLuminance(color: string): number {
  const channels = [color.slice(1, 3), color.slice(3, 5), color.slice(5, 7)].map((channel) => {
    const normalized = Number.parseInt(channel, 16) / 255;

    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
