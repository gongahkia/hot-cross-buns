pragma Singleton

import QtQuick

QtObject {
    readonly property var systemPalette: SystemPalette {
        colorGroup: SystemPalette.Active
    }

    readonly property color background: systemPalette.window
    readonly property color surface: systemPalette.base
    readonly property color textPrimary: systemPalette.windowText
    readonly property color textSecondary: systemPalette.placeholderText
    readonly property color accent: systemPalette.highlight
    readonly property int navigationWidth: 220
    readonly property int spacingSmall: 8
    readonly property int spacingMedium: 12
    readonly property int spacingLarge: 16
    readonly property int titleFontSize: 20
    readonly property int labelFontSize: 16
}
