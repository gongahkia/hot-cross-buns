import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Pane {
    id: root
    required property var commandRegistry
    required property string currentPage
    signal pageSelected(string pageName)

    SplitView.preferredWidth: Theme.navigationWidth

    function hasNavigationPage(pageName) {
        if (typeof commandRegistry.containsLabel === "function") {
            return commandRegistry.containsLabel(pageName)
        }
        for (let row = 0; row < commandRegistry.count; ++row) {
            if (commandRegistry.get(row).commandLabel === pageName) {
                return true
            }
        }
        return false
    }

    function selectPage(pageName) {
        if (hasNavigationPage(pageName)) {
            pageSelected(pageName)
        }
    }

    ColumnLayout {
        anchors.fill: parent
        spacing: Theme.spacingSmall

        Repeater {
            model: root.commandRegistry

            delegate: AccessibleNavigationButton {
                required property string commandLabel
                Layout.fillWidth: true
                pageName: commandLabel
                currentPage: root.currentPage === commandLabel
                onPageSelected: pageName => root.selectPage(pageName)
            }
        }

        Item { Layout.fillHeight: true }
    }
}
