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
    property var appController: null
    property var calendarSourceModel: null
    property var monthGridModel: null
    property var notesModel: null
    property var taskListModel: null
    property var taskModel: null
    property var timelineModel: null
    property var transitionTimings: null
    property alias navigationSidebar: navigationSidebar
    property alias navigationShortcuts: navigationShortcuts
    property alias commandPalette: commandPalette
    property alias commandPaletteQuery: commandPaletteQuery
    property alias commandPaletteResults: commandPaletteResults
    property alias commandPaletteShortcut: commandPaletteShortcut
    property alias calendarVisibility: calendarVisibility
    property alias eventCreateDialog: eventCreateDialog
    property alias eventDeleteDialog: eventDeleteDialog
    property alias eventEditDialog: eventEditDialog
    property alias dayTimeline: dayTimeline
    property alias weekTimeline: weekTimeline
    property alias quickCapture: quickCapture
    property alias quickCaptureShortcut: quickCaptureShortcut
    property alias noteEditor: noteEditor
    property alias notesList: notesList
    property alias taskCreateDialog: taskCreateDialog
    property alias taskDeleteDialog: taskDeleteDialog
    property alias taskEditDialog: taskEditDialog
    property alias taskList: taskList
    property alias taskMoveDialog: taskMoveDialog
    signal quickCaptureRequested(string title)
    signal noteSaveRequested(string noteId, string title, string body)
    signal taskCreateRequested(string taskListId, string parentTaskId, string title)
    signal taskDeleteRequested(string taskId)
    signal taskReparentRequested(string taskId, string parentTaskId)
    signal taskUpdateRequested(string taskId, string title, string notes, string dueAt,
                               string dueTimeZone, int priority)
    signal taskMoveRequested(string taskId, string taskListId)
    signal eventCreateRequested(string calendarId, string title, string startAt, string endAt,
                                bool allDay, string description, string location)
    signal eventUpdateRequested(string eventId, string calendarId, string title, string startAt,
                                string endAt, bool allDay, string description, string location)
    signal eventDeleteRequested(string eventId)
    signal eventMoveRequested(string eventId, string startAt, string endAt, bool allDay)
    signal eventResizeRequested(string eventId, string endAt)

    function controllerCall(method, args) {
        if (appController !== null && typeof appController[method] === "function") {
            appController[method].apply(appController, args)
        }
    }

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
        if (appController !== null && !appController.googleConnected && pageName !== "Settings") {
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

    function openEventCreate() {
        eventCreateDialog.openForCreate(calendarVisibility.preferredCalendarId())
    }

    function openEventEdit(eventId, calendarId, title, startAt, endAt, allDay, description, location) {
        eventEditDialog.openForEdit(eventId, calendarId, title, startAt, endAt, allDay, description, location)
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
        onTaskRequested: function(title) {
            window.quickCaptureRequested(title)
        }
    }

    NoteEditorDialog {
        id: noteEditor
        parent: Overlay.overlay
        anchors.centerIn: parent
        onNoteSaveRequested: function(noteId, title, body) {
            window.noteSaveRequested(noteId, title, body)
        }
    }

    TaskDeleteDialog {
        id: taskDeleteDialog
        parent: Overlay.overlay
        anchors.centerIn: parent
        onTaskDeleteRequested: function(taskId) {
            window.taskDeleteRequested(taskId)
            window.controllerCall("deleteTask", [taskId])
        }
    }

    TaskEditDialog {
        id: taskEditDialog
        parent: Overlay.overlay
        anchors.centerIn: parent
        onTaskUpdateRequested: function(taskId, title, notes, dueAt, dueTimeZone, priority) {
            window.taskUpdateRequested(taskId, title, notes, dueAt, dueTimeZone, priority)
            window.controllerCall("updateTask", [taskId, title, notes, dueAt, dueTimeZone, priority])
        }
    }

    TaskCreateDialog {
        id: taskCreateDialog
        parent: Overlay.overlay
        anchors.centerIn: parent
        taskListModel: window.taskListModel
        onTaskCreateRequested: function(taskListId, parentTaskId, title) {
            window.taskCreateRequested(taskListId, parentTaskId, title)
            window.controllerCall("createTask", [taskListId, parentTaskId, title])
        }
    }

    TaskMoveDialog {
        id: taskMoveDialog
        parent: Overlay.overlay
        anchors.centerIn: parent
        taskListModel: window.taskListModel
        onTaskMoveRequested: function(taskId, taskListId) {
            window.taskMoveRequested(taskId, taskListId)
            window.controllerCall("moveTask", [taskId, taskListId])
        }
    }

    EventCreateDialog {
        id: eventCreateDialog
        parent: Overlay.overlay
        anchors.centerIn: parent
        calendarSourceModel: window.calendarSourceModel
        onEventCreateRequested: function(calendarId, title, startAt, endAt, allDay, description, location) {
            window.eventCreateRequested(calendarId, title, startAt, endAt, allDay, description, location)
            window.controllerCall("createEvent", [calendarId, title, startAt, endAt, allDay, description, location])
        }
    }

    EventEditDialog {
        id: eventEditDialog
        parent: Overlay.overlay
        anchors.centerIn: parent
        calendarSourceModel: window.calendarSourceModel
        onEventUpdateRequested: function(eventId, calendarId, title, startAt, endAt, allDay, description, location) {
            window.eventUpdateRequested(eventId, calendarId, title, startAt, endAt, allDay, description, location)
            window.controllerCall("updateEvent", [eventId, calendarId, title, startAt, endAt, allDay, description, location])
        }
        onEventDeleteRequested: function(eventId, title) {
            eventDeleteDialog.openForDelete(eventId, title)
        }
    }

    EventDeleteDialog {
        id: eventDeleteDialog
        parent: Overlay.overlay
        anchors.centerIn: parent
        onEventDeleteRequested: function(eventId) {
            window.eventDeleteRequested(eventId)
            window.controllerCall("deleteEvent", [eventId])
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
                id: taskList
                anchors.fill: parent
                visible: window.currentPage === "Tasks"
                taskModel: window.taskModel
                onTaskCreateRequested: taskCreateDialog.openForCreate("", "")
                onTaskSubtaskCreateRequested: function(parentTaskId, taskListId) {
                    taskCreateDialog.openForCreate(taskListId, parentTaskId)
                }
                onTaskReparentRequested: function(taskId, parentTaskId) {
                    window.taskReparentRequested(taskId, parentTaskId)
                    window.controllerCall("reparentTask", [taskId, parentTaskId])
                }
                onTaskCompletionRequested: function(taskId, completed) {
                    window.controllerCall("setTaskCompleted", [taskId, completed])
                }
                onTaskEditRequested: function(taskId, title, notes, dueAt, dueTimeZone, priority) {
                    taskEditDialog.openForEdit(taskId, title, notes, dueAt, dueTimeZone, priority)
                }
                onTaskDeleteRequested: function(taskId, taskTitle) {
                    taskDeleteDialog.openForDelete(taskId, taskTitle)
                }
                onTaskMoveRequested: function(taskId, taskListId, taskTitle) {
                    taskMoveDialog.openForMove(taskId, taskTitle, taskListId)
                }
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

                CalendarSourceControls {
                    id: calendarVisibility
                    Layout.fillWidth: true
                    calendarSourceModel: window.calendarSourceModel
                }

                RowLayout {
                    Layout.fillWidth: true
                    Layout.leftMargin: Theme.spacingMedium
                    Layout.rightMargin: Theme.spacingMedium

                    Label {
                        text: "Calendar"
                        font.pixelSize: Theme.titleFontSize
                        Accessible.role: Accessible.Heading
                        Accessible.name: text
                    }

                    Item { Layout.fillWidth: true }

                    Button {
                        id: eventCreateButton
                        text: "New event"
                        enabled: calendarVisibility.calendarIds().length > 0
                        Accessible.name: text
                        onClicked: window.openEventCreate()
                    }
                }

                TabBar {
                    id: calendarViews
                    Layout.fillWidth: true

                    TabButton { text: "Agenda" }
                    TabButton { text: "Day" }
                    TabButton { text: "Week" }
                    TabButton { text: "Month" }
                }

                StackLayout {
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    currentIndex: calendarViews.currentIndex

                    AgendaView {
                        agendaModel: window.agendaModel
                        calendarVisibility: calendarVisibility
                        onEventEditRequested: function(eventId, calendarId, title, startAt, endAt, allDay, description, location) {
                            window.openEventEdit(eventId, calendarId, title, startAt, endAt, allDay, description, location)
                        }
                    }

                    DayTimelineView {
                        id: dayTimeline
                        timelineModel: window.timelineModel
                        calendarVisibility: calendarVisibility
                        onEventMoveRequested: function(eventId, startAt, endAt, allDay) {
                            window.eventMoveRequested(eventId, startAt, endAt, allDay)
                            window.controllerCall("moveEvent", [eventId, startAt, endAt, allDay])
                        }
                        onEventResizeRequested: function(eventId, endAt) {
                            window.eventResizeRequested(eventId, endAt)
                            window.controllerCall("resizeEvent", [eventId, endAt])
                        }
                    }

                    WeekTimelineView {
                        id: weekTimeline
                        timelineModel: window.timelineModel
                        calendarVisibility: calendarVisibility
                        onEventMoveRequested: function(eventId, startAt, endAt, allDay) {
                            window.eventMoveRequested(eventId, startAt, endAt, allDay)
                            window.controllerCall("moveEvent", [eventId, startAt, endAt, allDay])
                        }
                    }

                    MonthGridView {
                        monthGridModel: window.monthGridModel
                        calendarVisibility: calendarVisibility
                    }
                }
            }

            ColumnLayout {
                anchors.fill: parent
                visible: window.currentPage === "Settings"
                spacing: Theme.spacingMedium

                Label {
                    text: "Google setup"
                    font.pixelSize: Theme.titleFontSize
                    Accessible.role: Accessible.Heading
                    Accessible.name: text
                }

                Label {
                    Layout.fillWidth: true
                    text: "Enter the desktop OAuth client ID from your own Google Cloud project. Enable Google Tasks and Calendar APIs. The app opens a local loopback callback while connecting."
                    wrapMode: Text.WordWrap
                    color: Theme.textSecondary
                }

                TextField {
                    id: googleClientIdField
                    Layout.fillWidth: true
                    text: window.appController !== null ? window.appController.clientId : ""
                    placeholderText: "Desktop OAuth client ID"
                    Accessible.name: placeholderText
                }

                Button {
                    text: "Save client ID"
                    enabled: googleClientIdField.text.trim().length > 0 &&
                             (window.appController === null || !window.appController.busy)
                    Accessible.name: text
                    onClicked: window.controllerCall("saveClientId", [googleClientIdField.text])
                }

                Button {
                    text: window.appController !== null && window.appController.googleConnected ? "Reconnect Google" : "Connect Google"
                    enabled: window.appController !== null &&
                             window.appController.clientId.length > 0 &&
                             !window.appController.busy
                    Accessible.name: text
                    onClicked: window.controllerCall("connectGoogle", [])
                }

                Button {
                    text: "Sync Google now"
                    enabled: window.appController !== null && window.appController.googleConnected &&
                             !window.appController.busy
                    Accessible.name: text
                    onClicked: window.controllerCall("syncGoogle", [])
                }

                Label {
                    Layout.fillWidth: true
                    visible: window.appController !== null && window.appController.statusMessage.length > 0
                    text: window.appController !== null ? window.appController.statusMessage : ""
                    wrapMode: Text.WordWrap
                    color: Theme.textSecondary
                }

                Item { Layout.fillHeight: true }
            }

            ColumnLayout {
                anchors.fill: parent
                visible: window.currentPage !== "Tasks" && window.currentPage !== "Notes" &&
                         window.currentPage !== "Calendar" && window.currentPage !== "Settings"
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

    Rectangle {
        anchors.fill: parent
        visible: appController !== null && !appController.googleConnected && currentPage !== "Settings"
        z: 1
        color: Theme.background

        ColumnLayout {
            anchors.centerIn: parent
            width: Math.min(parent.width - Theme.spacingLarge * 2, 440)
            spacing: Theme.spacingMedium

            Label {
                Layout.fillWidth: true
                text: "Connect Google to continue"
                font.pixelSize: Theme.titleFontSize
                horizontalAlignment: Text.AlignHCenter
            }

            Label {
                Layout.fillWidth: true
                text: "This preview requires your Google account before tasks and calendar are available."
                wrapMode: Text.WordWrap
                horizontalAlignment: Text.AlignHCenter
                color: Theme.textSecondary
            }

            Button {
                Layout.alignment: Qt.AlignHCenter
                text: "Open Google setup"
                Accessible.name: text
                onClicked: window.selectPage("Settings")
            }
        }
    }
}
