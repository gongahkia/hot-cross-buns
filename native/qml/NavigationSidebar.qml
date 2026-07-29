import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Pane {
    id: root
    required property var commandRegistry
    required property string currentPage
    property bool googleConnected: true
    property bool notesEnabled: false
    property int pendingInvitationCount: 0
    property alias pageButtons: pageButtons
    signal pageSelected(string pageName)

    SplitView.preferredWidth: Theme.navigationWidth

    function hasNavigationPage(pageName) {
        if (Array.isArray(commandRegistry)) {
            return commandRegistry.some(function(command) {
                return command.commandId.startsWith("navigation.") && command.commandLabel === pageName
            })
        }
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
        if (hasNavigationPage(pageName) && (googleConnected || pageName === "Settings")) {
            pageSelected(pageName)
        }
    }

    ColumnLayout {
        anchors.fill: parent
        spacing: Theme.spacingSmall

        Repeater {
            id: pageButtons
            model: root.commandRegistry

            delegate: AccessibleNavigationButton {
                required property string commandId
                required property string commandLabel
                Layout.fillWidth: true
                pageName: commandLabel
                badgeText: commandLabel === "Invitations" && root.pendingInvitationCount > 0
                           ? String(root.pendingInvitationCount) : ""
                currentPage: root.currentPage === commandLabel
                enabled: root.googleConnected || commandLabel === "Settings"
                visible: commandId.startsWith("navigation.") &&
                         (commandLabel !== "Notes" || root.notesEnabled)
                onPageSelected: pageName => root.selectPage(pageName)
            }
        }

        Item { Layout.fillHeight: true }
    }
}
