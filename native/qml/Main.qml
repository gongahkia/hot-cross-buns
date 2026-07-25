import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import QtQml.Models

ApplicationWindow {
    id: window
    width: 1200
    height: 760
    minimumWidth: 900
    minimumHeight: 600
    visible: true
    title: "Hot Cross Buns"
    property string currentPage: "Tasks"
    required property var navigationCommands
    property var agendaModel: null
    property var notesModel: null
    property var taskModel: null
    property var timelineModel: null
    property var transitionTimings: null
    property alias navigationSidebar: navigationSidebar
    property alias navigationShortcuts: navigationShortcuts
    property alias commandPalette: commandPalette
    property alias commandPaletteQuery: commandPaletteQuery
    property alias commandPaletteResults: commandPaletteResults
    property alias commandPaletteShortcut: commandPaletteShortcut
    property alias quickCapture: quickCapture
    property alias quickCaptureShortcut: quickCaptureShortcut
    property alias noteEditor: noteEditor
    property alias notesList: notesList
    signal quickCaptureRequested(string title)
    signal noteSaveRequested(string noteId, string title, string body)

    function hasNavigationPage(pageName) {
        if (typeof navigationCommands.containsLabel === "function") {
            return navigationCommands.containsLabel(pageName)
        }
        for (let row = 0; row < navigationCommands.count; ++row) {
            if (navigationCommands.get(row).commandLabel === pageName) {
                return true
            }
        }
        return false
    }

    function selectPage(pageName) {
        if (!hasNavigationPage(pageName) || pageName === currentPage) {
            return
        }
        const spanName = "navigation." + pageName.toLowerCase()
        const tracked = transitionTimings !== null && transitionTimings.begin(spanName)
        currentPage = pageName
        if (tracked) {
            Qt.callLater(function() {
                transitionTimings.complete(spanName)
            })
        }
    }

    function matchingNavigationCommands(query) {
        if (typeof navigationCommands.matchingCommands === "function") {
            return navigationCommands.matchingCommands(query)
        }
        const normalizedQuery = query.trim().toLowerCase()
        const matches = []
        for (let row = 0; row < navigationCommands.count; ++row) {
            const command = navigationCommands.get(row)
            if (normalizedQuery === "" ||
                    command.commandId.toLowerCase().indexOf(normalizedQuery) >= 0 ||
                    command.commandLabel.toLowerCase().indexOf(normalizedQuery) >= 0) {
                matches.push(command)
            }
        }
        return matches
    }

    function openCommandPalette() {
        if (!commandPalette.opened) {
            commandPalette.previousFocusItem = window.activeFocusItem
            commandPalette.open()
        }
        commandPaletteQuery.forceActiveFocus()
    }

    function openQuickCapture() {
        quickCapture.open()
    }

    function openNoteEditor(noteId, title, body) {
        noteEditor.noteId = noteId
        noteEditor.noteTitle = title
        noteEditor.noteBody = body
        noteEditor.open()
    }

    color: Theme.background
    palette.window: Theme.background
    palette.windowText: Theme.textPrimary
    palette.base: Theme.surface
    palette.text: Theme.textPrimary
    palette.highlight: Theme.accent

    Shortcut {
        id: commandPaletteShortcut
        sequence: "Ctrl+P"
        autoRepeat: false
        onActivated: window.openCommandPalette()
    }

    Shortcut {
        id: quickCaptureShortcut
        sequence: "Ctrl+Shift+N"
        autoRepeat: false
        onActivated: window.openQuickCapture()
    }

    Instantiator {
        id: navigationShortcuts
        model: window.navigationCommands

        delegate: Shortcut {
            required property string commandLabel
            required property string commandShortcut
            sequence: commandShortcut
            autoRepeat: false
            onActivated: window.selectPage(commandLabel)
        }
    }

    Popup {
        id: commandPalette
        parent: Overlay.overlay
        anchors.centerIn: parent
        width: Math.min(560, parent.width - Theme.spacingLarge * 2)
        height: Math.min(420, parent.height - Theme.spacingLarge * 2)
        modal: true
        focus: true
        padding: Theme.spacingLarge
        closePolicy: Popup.CloseOnEscape | Popup.CloseOnPressOutsideParent
        property var matchingCommands: window.matchingNavigationCommands(commandPaletteQuery.text)
        property var previousFocusItem: null

        function activateCurrentCommand() {
            const command = matchingCommands[commandPaletteResults.currentIndex]
            if (command === undefined) {
                return
            }
            window.selectPage(command.commandLabel)
            close()
        }

        onOpened: {
            commandPaletteQuery.text = ""
            commandPaletteResults.currentIndex = 0
            commandPaletteQuery.forceActiveFocus()
        }

        onClosed: {
            if (previousFocusItem !== null) {
                previousFocusItem.forceActiveFocus()
            }
            previousFocusItem = null
        }

        background: Rectangle {
            color: Theme.surface
            border.color: Theme.accent
            border.width: 1
            radius: Theme.spacingSmall
        }

        ColumnLayout {
            anchors.fill: parent
            spacing: Theme.spacingMedium
            Accessible.role: Accessible.Dialog
            Accessible.name: "Command palette"

            Label {
                text: "Command Palette"
                font.bold: true
                font.pixelSize: Theme.labelFontSize
            }

            TextField {
                id: commandPaletteQuery
                objectName: "commandPaletteQuery"
                Layout.fillWidth: true
                focus: true
                placeholderText: "Search commands"
                Accessible.name: "Search commands"
                onTextChanged: commandPaletteResults.currentIndex = commandPalette.matchingCommands.length > 0 ? 0 : -1
                Keys.onPressed: function(event) {
                    if (event.key === Qt.Key_Down && commandPaletteResults.count > 0) {
                        commandPaletteResults.currentIndex = Math.min(commandPaletteResults.count - 1,
                                                                     commandPaletteResults.currentIndex + 1)
                        event.accepted = true
                    } else if (event.key === Qt.Key_Up && commandPaletteResults.count > 0) {
                        commandPaletteResults.currentIndex = Math.max(0,
                                                                     commandPaletteResults.currentIndex - 1)
                        event.accepted = true
                    } else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
                        commandPalette.activateCurrentCommand()
                        event.accepted = true
                    }
                }
            }

            ListView {
                id: commandPaletteResults
                Layout.fillWidth: true
                Layout.fillHeight: true
                clip: true
                model: commandPalette.matchingCommands
                currentIndex: 0
                visible: count > 0

                delegate: AccessibleButton {
                    required property var modelData
                    width: ListView.view.width
                    text: modelData.commandLabel + "    " + modelData.commandShortcut
                    accessibleName: modelData.commandLabel
                    accessibleDescription: "Navigate to " + modelData.commandLabel + " using " + modelData.commandShortcut
                    highlighted: ListView.isCurrentItem
                    onClicked: {
                        window.selectPage(modelData.commandLabel)
                        commandPalette.close()
                    }
                }
            }

            Label {
                Layout.fillWidth: true
                visible: commandPaletteResults.count === 0
                text: "No matching commands"
                color: Theme.textSecondary
                horizontalAlignment: Text.AlignHCenter
            }
        }
    }

    QuickCaptureDialog {
        id: quickCapture
        parent: Overlay.overlay
        anchors.centerIn: parent
        onTaskRequested: title => window.quickCaptureRequested(title)
    }

    NoteEditorDialog {
        id: noteEditor
        parent: Overlay.overlay
        anchors.centerIn: parent
        onNoteSaveRequested: function(noteId, title, body) {
            window.noteSaveRequested(noteId, title, body)
        }
    }

    header: ToolBar {
        RowLayout {
            anchors.fill: parent
            anchors.leftMargin: Theme.spacingLarge
            anchors.rightMargin: Theme.spacingLarge

            Label {
                text: "Hot Cross Buns"
                font.bold: true
                font.pixelSize: Theme.labelFontSize
            }
            Item { Layout.fillWidth: true }
            Label {
                text: "Native rewrite foundation"
                opacity: 0.7
            }
        }
    }

    SplitView {
        anchors.fill: parent

        NavigationSidebar {
            id: navigationSidebar
            commandRegistry: window.navigationCommands
            currentPage: window.currentPage
            onPageSelected: pageName => window.selectPage(pageName)
        }

        Pane {
            SplitView.fillWidth: true
            TaskListView {
                anchors.fill: parent
                visible: window.currentPage === "Tasks"
                taskModel: window.taskModel
            }

            NotesListView {
                id: notesList
                anchors.fill: parent
                visible: window.currentPage === "Notes"
                notesModel: window.notesModel
                onNoteSelected: function(noteId, title, body) {
                    window.openNoteEditor(noteId, title, body)
                }
            }

            ColumnLayout {
                anchors.fill: parent
                visible: window.currentPage === "Calendar"
                spacing: 0

                TabBar {
                    id: calendarViews
                    Layout.fillWidth: true

                    TabButton { text: "Agenda" }
                    TabButton { text: "Day" }
                    TabButton { text: "Week" }
                }

                StackLayout {
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    currentIndex: calendarViews.currentIndex

                    AgendaView {
                        agendaModel: window.agendaModel
                    }

                    DayTimelineView {
                        timelineModel: window.timelineModel
                    }

                    WeekTimelineView {
                        timelineModel: window.timelineModel
                    }
                }
            }

            ColumnLayout {
                anchors.fill: parent
                visible: window.currentPage !== "Tasks" && window.currentPage !== "Notes" &&
                         window.currentPage !== "Calendar"
                spacing: Theme.spacingMedium
                Label {
                    text: window.currentPage
                    font.pixelSize: Theme.titleFontSize
                }
                Label {
                    text: "Qt Quick presents small C++ model diffs; sync, search, recurrence, and SQLite stay off the UI thread."
                    wrapMode: Text.WordWrap
                    Layout.fillWidth: true
                    color: Theme.textSecondary
                }
                Item { Layout.fillHeight: true }
            }
        }
    }
}
