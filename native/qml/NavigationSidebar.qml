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
    property var sidebarTabIds: ["tasks", "calendar"]
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

    function tabIdForLabel(label) {
        return label.toLowerCase()
    }

    function navigationCommands() {
        const commands = Array.isArray(commandRegistry) ? commandRegistry : []
        const result = []
        sidebarTabIds.forEach(function(tabId) {
            commands.forEach(function(command) {
                if (command.commandId.startsWith("navigation.") &&
                        tabIdForLabel(command.commandLabel) === tabId &&
                        (command.commandLabel !== "Notes" || root.notesEnabled)) {
                    result.push(command)
                }
            })
        })
        commands.forEach(function(command) {
            if (command.commandId === "navigation.settings") result.push(command)
        })
        return result
    }

    ColumnLayout {
        anchors.fill: parent
        spacing: Theme.spacingSmall

        Repeater {
            id: pageButtons
            model: root.navigationCommands()

            delegate: AccessibleNavigationButton {
                required property string commandId
                required property string commandLabel
                Layout.fillWidth: true
                pageName: commandLabel
                badgeText: commandLabel === "Invitations" && root.pendingInvitationCount > 0
                           ? String(root.pendingInvitationCount) : ""
                currentPage: root.currentPage === commandLabel
                enabled: root.googleConnected || commandLabel === "Settings"
                visible: commandId.startsWith("navigation.")
                onPageSelected: pageName => root.selectPage(pageName)
            }
        }

        Item { Layout.fillHeight: true }
    }
}
