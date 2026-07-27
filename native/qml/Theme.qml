pragma Singleton

import QtQuick

QtObject {
    property int appearanceMode: 0 // 0 system, 1 light, 2 dark
    property int visualDensity: 1 // 0 compact, 1 standard, 2 comfortable
    readonly property var systemPalette: SystemPalette {
        colorGroup: SystemPalette.Active
    }

    readonly property bool forceDark: appearanceMode === 2
    readonly property bool forceLight: appearanceMode === 1
    readonly property color background: forceDark ? "#1d1b20" : forceLight ? "#fffbfe" : systemPalette.window
    readonly property color surface: forceDark ? "#242126" : forceLight ? "#ffffff" : systemPalette.base
    readonly property color textPrimary: forceDark ? "#e6e1e5" : forceLight ? "#1d1b20" : systemPalette.windowText
    readonly property color textSecondary: forceDark ? "#cac4d0" : forceLight ? "#625b71" : systemPalette.placeholderText
    readonly property color accent: forceDark ? "#d0bcff" : forceLight ? "#6750a4" : systemPalette.highlight
    readonly property color destructive: "#b3261e"
    readonly property int navigationWidth: 220
    readonly property real densityScale: visualDensity === 0 ? 0.82 : visualDensity === 2 ? 1.18 : 1
    readonly property int spacingSmall: Math.round(8 * densityScale)
    readonly property int spacingMedium: Math.round(12 * densityScale)
    readonly property int spacingLarge: Math.round(16 * densityScale)
    readonly property int titleFontSize: Math.round(20 * densityScale)
    readonly property int labelFontSize: Math.round(16 * densityScale)
    readonly property int bodyFontSize: Math.round(14 * densityScale)
    readonly property int timelineHourHeight: Math.round(48 * densityScale)
}
