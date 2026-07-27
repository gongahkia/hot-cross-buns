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
    property var searchResultsModel: null
    property var taskListModel: null
    property var taskModel: null
    property var timelineModel: null
    property bool notesEnabled: appController !== null && appController.notesEnabled === true
    property int notesProjectionMode: appController !== null &&
                                      typeof appController.notesProjectionMode === "number"
                                      ? appController.notesProjectionMode : 0
    property int appearanceMode: appController !== null && typeof appController.appearanceMode === "number"
                                 ? appController.appearanceMode : 0
    property int visualDensity: appController !== null && typeof appController.visualDensity === "number"
                                ? appController.visualDensity : 1
    property int weekStartDay: appController !== null && typeof appController.weekStartDay === "number"
                               ? appController.weekStartDay : 0
    property bool use24HourTime: appController === null || appController.use24HourTime !== false
    property int workdayStartHour: appController !== null && typeof appController.workdayStartHour === "number"
                                   ? appController.workdayStartHour : 9
    property int workdayEndHour: appController !== null && typeof appController.workdayEndHour === "number"
                                 ? appController.workdayEndHour : 17
    property var transitionTimings: null
    property var selectedCalendarEventIds: []
    property string calendarDate: appController !== null &&
                                  typeof appController.calendarDate === "string" &&
                                  appController.calendarDate.length > 0
                                  ? appController.calendarDate : fallbackCalendarDate()
    property alias navigationSidebar: navigationSidebar
    property alias navigationShortcuts: navigationShortcuts
    property alias commandPalette: commandPalette
    property alias commandPaletteQuery: commandPaletteQuery
    property alias commandPaletteResults: commandPaletteResults
    property alias commandPaletteShortcut: commandPaletteShortcut
    property alias calendarVisibility: calendarVisibility
    property alias calendarViews: calendarViews
    property alias calendarBulkControls: calendarBulkControls
    property alias eventCreateDialog: eventCreateDialog
    property alias eventDeleteDialog: eventDeleteDialog
    property alias eventEditDialog: eventEditDialog
    property alias dayTimeline: dayTimeline
    property alias weekTimeline: weekTimeline
    property alias monthGrid: monthGrid
    property alias quickCapture: quickCapture
    property alias quickCaptureShortcut: quickCaptureShortcut
    property alias searchPopup: searchPopup
    property alias searchQuery: searchPopup.queryField
    property alias searchResults: searchPopup.resultRows
    property alias searchShortcut: searchShortcut
    property alias noteEditor: noteEditor
    property alias notesList: notesList
    property alias taskCreateDialog: taskCreateDialog
    property alias taskDeleteDialog: taskDeleteDialog
    property alias taskEditDialog: taskEditDialog
    property alias taskRecurrenceActionDialog: taskRecurrenceActionDialog
    property alias taskList: taskList
    property alias taskListEditorDialog: taskListEditorDialog
    property alias taskListDeleteDialog: taskListDeleteDialog
    property alias taskMoveDialog: taskMoveDialog
    signal quickCaptureRequested(string title)
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
    signal searchResultActivated(string resource, string resultId, string title, string detail)

    Binding {
        target: Theme
        property: "appearanceMode"
        value: window.appearanceMode
    }

    Binding {
        target: Theme
        property: "visualDensity"
        value: window.visualDensity
    }

    function controllerCall(method, args) {
        if (appController !== null && typeof appController[method] === "function") {
            appController[method].apply(appController, args)
        }
    }

    function isCalendarEventSelected(eventId) {
        return selectedCalendarEventIds.indexOf(eventId) >= 0
    }

    function setCalendarEventSelected(eventId, selected) {
        const next = selectedCalendarEventIds.slice()
        const index = next.indexOf(eventId)
        if (selected && index < 0) {
            next.push(eventId)
        } else if (!selected && index >= 0) {
            next.splice(index, 1)
        }
        selectedCalendarEventIds = next
    }

    function clearCalendarEventSelection() {
        selectedCalendarEventIds = []
    }

    function fallbackCalendarDate() {
        return new Date().toISOString().slice(0, 10)
    }

    function shiftCalendarDate(days) {
        const parsed = new Date(calendarDate + "T12:00:00Z")
        if (!Number.isFinite(parsed.getTime())) {
            return calendarDate
        }
        parsed.setUTCDate(parsed.getUTCDate() + days)
        return parsed.toISOString().slice(0, 10)
    }

    function shiftCalendarMonth(months) {
        const parsed = new Date(calendarDate + "T12:00:00Z")
        if (!Number.isFinite(parsed.getTime())) {
            return calendarDate
        }
        parsed.setUTCMonth(parsed.getUTCMonth() + months)
        return parsed.toISOString().slice(0, 10)
    }

    function calendarWeekDayIndex() {
        const parsed = new Date(calendarDate + "T12:00:00Z")
        return Number.isFinite(parsed.getTime()) ? (parsed.getUTCDay() - weekStartDay + 7) % 7 : 0
    }

    function calendarWeekLabels() {
        const start = shiftCalendarDate(-calendarWeekDayIndex())
        const labels = []
        for (let index = 0; index < 7; ++index) {
            const date = new Date(start + "T12:00:00Z")
            date.setUTCDate(date.getUTCDate() + index)
            labels.push(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getUTCDay()] +
                        " " + date.toISOString().slice(5, 10))
        }
        return labels
    }

    function navigateCalendar(direction) {
        let nextDate = calendarDate
        if (calendarViews.currentIndex === 3) {
            nextDate = shiftCalendarMonth(direction)
        } else if (calendarViews.currentIndex === 2 || calendarViews.currentIndex === 0) {
            nextDate = shiftCalendarDate(direction * 7)
        } else {
            nextDate = shiftCalendarDate(direction)
        }
        controllerCall("setCalendarDate", [nextDate])
    }

    function goToToday() {
        controllerCall("setCalendarDate", [fallbackCalendarDate()])
    }

    function hasNavigationPage(pageName) {
        if (pageName === "Notes" && !notesEnabled) {
            return false
        }
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
        let commands = []
        if (typeof navigationCommands.matchingCommands === "function") {
            commands = navigationCommands.matchingCommands(query)
        } else {
            const normalizedQuery = query.trim().toLowerCase()
            for (let row = 0; row < navigationCommands.count; ++row) {
                const command = navigationCommands.get(row)
                if (normalizedQuery === "" ||
                        command.commandId.toLowerCase().indexOf(normalizedQuery) >= 0 ||
                        command.commandLabel.toLowerCase().indexOf(normalizedQuery) >= 0) {
                    commands.push(command)
                }
            }
        }
        const matches = []
        for (let row = 0; row < commands.length; ++row) {
            const command = commands[row]
            if (command.commandLabel !== "Notes" || notesEnabled) {
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

    function openSearch() {
        searchPopup.open()
    }

    function openSearchResult(resource, resultId, title, detail) {
        if (resource === "task" || resource === "taskList") {
            selectPage("Tasks")
        } else if (resource === "note") {
            selectPage("Notes")
        } else if (resource === "calendar" || resource === "event") {
            selectPage("Calendar")
        }
        searchResultActivated(resource, resultId, title, detail)
        searchPopup.close()
    }

    function openNoteEditor(taskId, taskListId, title, body) {
        noteEditor.openForEdit(taskId, taskListId, title, body)
    }

    function openEventCreate(date) {
        eventCreateDialog.openForCreate(calendarVisibility.preferredCalendarId(), date || calendarDate)
    }

    function openEventEdit(eventId, calendarId, title, startAt, endAt, allDay, description, location,
                           startTimeZone, colorId, transparency, visibility, attendeeEmailsJson,
                           remindersJson, remindersUseDefault, recurrenceRule, recurringRemoteId,
                           originalStartAt, eventType, conferenceJson, attachmentsJson,
                           guestPermissionsJson, statusPropertiesJson) {
        eventEditDialog.openForEdit(eventId, calendarId, title, startAt, endAt, allDay, description,
                                    location, startTimeZone, colorId, transparency, visibility,
                                    attendeeEmailsJson, remindersJson, remindersUseDefault,
                                    recurrenceRule, recurringRemoteId, originalStartAt,
                                    eventType || "default", conferenceJson || "",
                                    attachmentsJson || "", guestPermissionsJson || "",
                                    statusPropertiesJson || "")
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

    Shortcut {
        id: searchShortcut
        sequence: "Ctrl+F"
        autoRepeat: false
        onActivated: window.openSearch()
    }

    Shortcut {
        sequence: "Alt+Left"
        autoRepeat: false
        onActivated: {
            if (window.currentPage === "Calendar") window.navigateCalendar(-1)
        }
    }

    Shortcut {
        sequence: "Alt+Right"
        autoRepeat: false
        onActivated: {
            if (window.currentPage === "Calendar") window.navigateCalendar(1)
        }
    }

    Instantiator {
        id: navigationShortcuts
        model: window.navigationCommands

        delegate: Shortcut {
            required property string commandLabel
            required property string commandShortcut
            sequence: commandShortcut
            autoRepeat: false
            enabled: commandLabel !== "Notes" || window.notesEnabled
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

    SearchPopup {
        id: searchPopup
        appController: window.appController
        searchResultsModel: window.searchResultsModel
        onResultActivated: function(resource, resultId, title, detail) {
            window.openSearchResult(resource, resultId, title, detail)
        }
    }

    NoteEditorDialog {
        id: noteEditor
        parent: Overlay.overlay
        anchors.centerIn: parent
        taskListModel: window.taskListModel
        onTaskSaveRequested: function(taskId, taskListId, title, body) {
            window.controllerCall("saveNoteTask", [taskId, taskListId, title, body])
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
        onTaskUpdateRequested: function(taskId, title, notes, dueAt, dueTimeZone, priority,
                                        managedRecurrence, recurrenceFrequency, recurrenceInterval,
                                        recurrenceEndKind, recurrenceEndUntil, recurrenceEndCount) {
            window.taskUpdateRequested(taskId, title, notes, dueAt, dueTimeZone, priority)
            window.controllerCall("updateTaskDetailed", [taskId, title, notes, dueAt, dueTimeZone,
                                                            priority, managedRecurrence,
                                                            recurrenceFrequency, recurrenceInterval,
                                                            recurrenceEndKind, recurrenceEndUntil,
                                                            recurrenceEndCount])
        }
        onTaskRecurrenceActionRequested: function(taskId, title, action) {
            taskRecurrenceActionDialog.openForAction(taskId, title, action)
        }
    }

    TaskCreateDialog {
        id: taskCreateDialog
        parent: Overlay.overlay
        anchors.centerIn: parent
        taskListModel: window.taskListModel
        onTaskCreateRequested: function(taskListId, parentTaskId, title, notes, dueAt, dueTimeZone,
                                        priority, managedRecurrence, recurrenceFrequency,
                                        recurrenceInterval, recurrenceEndKind, recurrenceEndUntil,
                                        recurrenceEndCount, recurrenceRule, exclusionDates, additionDates) {
            window.taskCreateRequested(taskListId, parentTaskId, title)
            window.controllerCall("createTaskDetailed", [taskListId, parentTaskId, title, notes, dueAt,
                                                            dueTimeZone, priority, managedRecurrence,
                                                            recurrenceFrequency, recurrenceInterval,
                                                            recurrenceEndKind, recurrenceEndUntil,
                                                            recurrenceEndCount, recurrenceRule,
                                                            exclusionDates, additionDates])
        }
    }

    TaskRecurrenceActionDialog {
        id: taskRecurrenceActionDialog
        parent: Overlay.overlay
        anchors.centerIn: parent
        onRecurrenceActionRequested: function(taskId, action, scope) {
            if (action === 0) {
                window.controllerCall("stopTaskRecurrence", [taskId, scope])
            } else {
                window.controllerCall("splitTaskRecurrence", [taskId])
            }
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

    TaskListEditorDialog {
        id: taskListEditorDialog
        parent: Overlay.overlay
        anchors.centerIn: parent
        onTaskListSaveRequested: function(taskListId, title) {
            if (taskListId.length === 0) {
                window.controllerCall("createTaskList", [title])
            } else {
                window.controllerCall("renameTaskList", [taskListId, title])
            }
        }
    }

    TaskListDeleteDialog {
        id: taskListDeleteDialog
        parent: Overlay.overlay
        anchors.centerIn: parent
        onTaskListDeleteRequested: function(taskListId) {
            window.controllerCall("deleteTaskList", [taskListId])
        }
    }

    EventCreateDialog {
        id: eventCreateDialog
        parent: Overlay.overlay
        anchors.centerIn: parent
        calendarSourceModel: window.calendarSourceModel
        driveAttachmentCandidates: window.appController ? window.appController.driveAttachmentCandidates : []
        freeBusyIntervals: window.appController ? window.appController.freeBusyIntervals : []
        onEventCreateRequested: function(calendarId, title, startAt, endAt, allDay, description, location,
                                         timeZone, colorId, available, visibility, attendees,
                                         remindersUseDefault, reminders, recurrenceRule) {
            window.eventCreateRequested(calendarId, title, startAt, endAt, allDay, description, location)
        }
        onRichEventCreateRequested: function(calendarId, title, startAt, endAt, allDay, description, location,
                                         timeZone, colorId, available, visibility, attendees,
                                         remindersUseDefault, reminders, recurrenceRule, createGoogleMeet,
                                         attachmentsJson, guestPermissionsJson, eventType,
                                         statusPropertiesJson, sendUpdates) {
            window.controllerCall("createEventDetailed", [calendarId, title, startAt, endAt, allDay,
                                                            description, location, timeZone, colorId,
                                                            available, visibility, attendees,
                                                            remindersUseDefault, reminders, recurrenceRule,
                                                            createGoogleMeet, attachmentsJson,
                                                            guestPermissionsJson, eventType,
                                                            statusPropertiesJson, sendUpdates])
        }
        onDriveSearchRequested: function(query) { window.controllerCall("searchGoogleDriveAttachments", [query]) }
        onAvailabilityRequested: function(calendarIds, startAt, endAt) {
            window.controllerCall("queryGoogleFreeBusy", [calendarIds, startAt, endAt])
        }
    }

    EventEditDialog {
        id: eventEditDialog
        parent: Overlay.overlay
        anchors.centerIn: parent
        calendarSourceModel: window.calendarSourceModel
        driveAttachmentCandidates: window.appController ? window.appController.driveAttachmentCandidates : []
        freeBusyIntervals: window.appController ? window.appController.freeBusyIntervals : []
        onEventUpdateRequested: function(eventId, calendarId, title, startAt, endAt, allDay, description, location,
                                         timeZone, colorId, available, visibility, attendees,
                                         remindersUseDefault, reminders, recurrenceRule, recurrenceScope) {
            window.eventUpdateRequested(eventId, calendarId, title, startAt, endAt, allDay, description, location)
        }
        onRichEventUpdateRequested: function(eventId, calendarId, title, startAt, endAt, allDay, description, location,
                                         timeZone, colorId, available, visibility, attendees,
                                         remindersUseDefault, reminders, recurrenceRule, recurrenceScope,
                                         createGoogleMeet, attachmentsJson, guestPermissionsJson,
                                         statusPropertiesJson, sendUpdates) {
            window.controllerCall("updateEventDetailed", [eventId, calendarId, title, startAt, endAt,
                                                            allDay, description, location, timeZone,
                                                            colorId, available, visibility, attendees,
                                                            remindersUseDefault, reminders, recurrenceRule,
                                                            recurrenceScope, createGoogleMeet,
                                                            attachmentsJson, guestPermissionsJson,
                                                            statusPropertiesJson, sendUpdates])
        }
        onDriveSearchRequested: function(query) { window.controllerCall("searchGoogleDriveAttachments", [query]) }
        onAvailabilityRequested: function(calendarIds, startAt, endAt) {
            window.controllerCall("queryGoogleFreeBusy", [calendarIds, startAt, endAt])
        }
        onRsvpRequested: function(eventId, responseStatus) {
            window.controllerCall("respondToEvent", [eventId, responseStatus])
        }
        onEventDeleteRequested: function(eventId, title, recurrenceRule, recurringRemoteId, originalStartAt) {
            eventDeleteDialog.openForDelete(eventId, title, recurrenceRule, recurringRemoteId, originalStartAt)
        }
    }

    EventDeleteDialog {
        id: eventDeleteDialog
        parent: Overlay.overlay
        anchors.centerIn: parent
        onEventDeleteRequested: function(eventId, recurrenceScope) {
            window.eventDeleteRequested(eventId)
            window.controllerCall("deleteEvent", [eventId, recurrenceScope])
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
            Button {
                text: "Search"
                Accessible.name: text
                onClicked: window.openSearch()
            }
            Item { Layout.fillWidth: true }
            Label {
                text: "Google Calendar & Tasks"
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
            notesEnabled: window.notesEnabled
            onPageSelected: pageName => window.selectPage(pageName)
        }

        Pane {
            SplitView.fillWidth: true
            TaskListView {
                id: taskList
                anchors.fill: parent
                visible: window.currentPage === "Tasks"
                taskListModel: window.taskListModel
                taskModel: window.taskModel
                taskListLoading: window.appController !== null && window.appController.busy === true
                taskListErrorMessage: window.appController !== null &&
                                      typeof window.appController.taskListErrorMessage === "string"
                                      ? window.appController.taskListErrorMessage : ""
                bulkTaskStatusMessage: window.appController !== null &&
                                       typeof window.appController.bulkTaskStatusMessage === "string"
                                       ? window.appController.bulkTaskStatusMessage : ""
                onTaskListCreateRequested: taskListEditorDialog.openForCreate()
                onTaskListRenameRequested: function(taskListId, title) {
                    taskListEditorDialog.openForRename(taskListId, title)
                }
                onTaskListDeleteRequested: function(taskListId, title, taskCount, taskTitles) {
                    taskListDeleteDialog.openForDelete(taskListId, title, taskCount, taskTitles)
                }
                onTaskListSelectionRequested: function(taskListId, selected) {
                    window.controllerCall("setTaskListSelected", [taskListId, selected])
                }
                onTaskCreateRequested: taskCreateDialog.openForCreate("", "")
                onTaskSubtaskCreateRequested: function(parentTaskId, taskListId) {
                    taskCreateDialog.openForCreate(taskListId, parentTaskId)
                }
                onTaskReparentRequested: function(taskId, parentTaskId) {
                    window.taskReparentRequested(taskId, parentTaskId)
                    window.controllerCall("reparentTask", [taskId, parentTaskId])
                }
                onTaskReorderRequested: function(taskId, earlier) {
                    window.controllerCall("reorderTask", [taskId, earlier])
                }
                onTaskCompletionRequested: function(taskId, completed) {
                    window.controllerCall("setTaskCompleted", [taskId, completed])
                }
                onTaskEditRequested: function(taskId, title, notes, dueAt, dueTimeZone, priority,
                                               managedRecurrence, recurrenceSummary,
                                               recurrenceFrequency, recurrenceInterval,
                                               recurrenceEndKind, recurrenceEndUntil,
                                               recurrenceEndCount) {
                    taskEditDialog.openForEdit(taskId, title, notes, dueAt, dueTimeZone, priority,
                                               managedRecurrence, recurrenceSummary,
                                               recurrenceFrequency, recurrenceInterval,
                                               recurrenceEndKind, recurrenceEndUntil,
                                               recurrenceEndCount)
                }
                onTaskDeleteRequested: function(taskId, taskTitle, managedRecurrence) {
                    taskDeleteDialog.openForDelete(taskId, taskTitle, managedRecurrence)
                }
                onTaskMoveRequested: function(taskId, taskListId, taskTitle) {
                    taskMoveDialog.openForMove(taskId, taskTitle, taskListId)
                }
                onBulkTaskCompletionRequested: function(taskIds, completed) {
                    window.controllerCall("bulkSetTaskCompleted", [taskIds, completed])
                }
                onBulkTaskDeleteRequested: function(taskIds) {
                    window.controllerCall("bulkDeleteTasks", [taskIds])
                }
                onBulkTaskMoveRequested: function(taskIds, taskListId) {
                    window.controllerCall("bulkMoveTasks", [taskIds, taskListId])
                }
                onBulkTaskDueRequested: function(taskIds, dueAt) {
                    window.controllerCall("bulkSetTaskDue", [taskIds, dueAt])
                }
                onBulkTaskClearDueRequested: function(taskIds) {
                    window.controllerCall("bulkClearTaskDue", [taskIds])
                }
                onBulkTaskPriorityRequested: function(taskIds, priority) {
                    window.controllerCall("bulkSetTaskPriority", [taskIds, priority])
                }
                onBulkTaskReparentRequested: function(taskIds, parentTaskId) {
                    window.controllerCall("bulkReparentTasks", [taskIds, parentTaskId])
                }
            }

            NotesListView {
                id: notesList
                anchors.fill: parent
                visible: window.currentPage === "Notes"
                notesModel: window.notesModel
                loading: window.appController !== null && window.appController.busy === true
                statusMessage: window.appController !== null &&
                               typeof window.appController.statusMessage === "string"
                               ? window.appController.statusMessage : ""
                onNoteCreateRequested: noteEditor.openForCreate("")
                onNoteEditRequested: function(taskId, taskListId, title, body) {
                    window.openNoteEditor(taskId, taskListId, title, body)
                }
                onNoteCompletionRequested: function(taskId, completed) {
                    window.controllerCall("setTaskCompleted", [taskId, completed])
                }
                onNoteDeleteRequested: function(taskId, title) {
                    taskDeleteDialog.openForDelete(taskId, title)
                }
                onNoteMoveRequested: function(taskId, taskListId, title) {
                    taskMoveDialog.openForMove(taskId, title, taskListId)
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
                    persistedVisibleCalendarIds: window.appController !== null &&
                                                 window.appController.visibleCalendarIds !== undefined
                                                 ? window.appController.visibleCalendarIds : []
                    calendarVisibilityConfigured: window.appController !== null &&
                                                   window.appController.calendarVisibilityConfigured === true
                    onVisibleCalendarIdsChanged: {
                        window.clearCalendarEventSelection()
                        if (visibilityInitialized) {
                            window.controllerCall("saveCalendarVisibility", [visibleCalendarIds])
                        }
                    }
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
                        text: "Previous"
                        Accessible.name: "Previous calendar period"
                        onClicked: window.navigateCalendar(-1)
                    }

                    Button {
                        text: "Today"
                        Accessible.name: "Go to today"
                        onClicked: window.goToToday()
                    }

                    Label {
                        text: window.calendarDate
                        Accessible.name: "Selected calendar date " + text
                    }

                    Button {
                        text: "Next"
                        Accessible.name: "Next calendar period"
                        onClicked: window.navigateCalendar(1)
                    }

                    Button {
                        id: eventCreateButton
                        text: "New event"
                        enabled: calendarVisibility.calendarIds().length > 0
                        Accessible.name: text + " on " + window.calendarDate
                        onClicked: window.openEventCreate(window.calendarDate)
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

                CalendarBulkControls {
                    id: calendarBulkControls
                    Layout.fillWidth: true
                    selectedEventIds: window.selectedCalendarEventIds
                    calendarSourceModel: window.calendarSourceModel
                    statusMessage: window.appController !== null
                                   ? window.appController.bulkEventStatusMessage : ""
                    onClearSelectionRequested: window.clearCalendarEventSelection()
                    onBulkDeleteRequested: function(eventIds) {
                        window.controllerCall("bulkDeleteEvents", [eventIds])
                        window.clearCalendarEventSelection()
                    }
                    onBulkMoveRequested: function(eventIds, calendarId) {
                        window.controllerCall("bulkMoveEvents", [eventIds, calendarId])
                        window.clearCalendarEventSelection()
                    }
                    onBulkColorRequested: function(eventIds, colorId) {
                        window.controllerCall("bulkSetEventColor", [eventIds, colorId])
                        window.clearCalendarEventSelection()
                    }
                    onBulkAvailabilityRequested: function(eventIds, available) {
                        window.controllerCall("bulkSetEventAvailability", [eventIds, available])
                        window.clearCalendarEventSelection()
                    }
                    onBulkVisibilityRequested: function(eventIds, visibility) {
                        window.controllerCall("bulkSetEventVisibility", [eventIds, visibility])
                        window.clearCalendarEventSelection()
                    }
                    onBulkShiftRequested: function(eventIds, shiftMinutes) {
                        window.controllerCall("bulkShiftEventTimes", [eventIds, shiftMinutes])
                        window.clearCalendarEventSelection()
                    }
                }

                StackLayout {
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    currentIndex: calendarViews.currentIndex

                    AgendaView {
                        id: agendaView
                        agendaModel: window.agendaModel
                        calendarVisibility: calendarVisibility
                        selectedEventIds: window.selectedCalendarEventIds
                        onEventSelectionRequested: function(eventId, selected) {
                            window.setCalendarEventSelected(eventId, selected)
                        }
                        onEventEditRequested: function(eventId, calendarId, title, startAt, endAt, allDay, description, location,
                                                       startTimeZone, colorId, transparency, visibility,
                                                       attendeeEmailsJson, remindersJson, remindersUseDefault,
                                                       recurrenceRule, recurringRemoteId, originalStartAt,
                                                       eventType, conferenceJson, attachmentsJson,
                                                       guestPermissionsJson, statusPropertiesJson) {
                            window.openEventEdit(eventId, calendarId, title, startAt, endAt, allDay,
                                                 description, location, startTimeZone, colorId,
                                                 transparency, visibility, attendeeEmailsJson,
                                                 remindersJson, remindersUseDefault, recurrenceRule,
                                                 recurringRemoteId, originalStartAt, eventType, conferenceJson,
                                                 attachmentsJson, guestPermissionsJson, statusPropertiesJson)
                        }
                    }

                    DayTimelineView {
                        id: dayTimeline
                        timelineModel: window.timelineModel
                        calendarVisibility: calendarVisibility
                        selectedEventIds: window.selectedCalendarEventIds
                        dayIndex: window.calendarWeekDayIndex()
                        dateLabel: window.calendarDate
                        use24HourTime: window.use24HourTime
                        workdayStartHour: window.workdayStartHour
                        hourHeight: Theme.timelineHourHeight
                        onEventSelectionRequested: function(eventId, selected) {
                            window.setCalendarEventSelected(eventId, selected)
                        }
                        onEventMoveRequested: function(eventId, startAt, endAt, allDay) {
                            window.eventMoveRequested(eventId, startAt, endAt, allDay)
                            window.controllerCall("moveEvent", [eventId, startAt, endAt, allDay])
                        }
                        onEventResizeRequested: function(eventId, endAt) {
                            window.eventResizeRequested(eventId, endAt)
                            window.controllerCall("resizeEvent", [eventId, endAt])
                        }
                        onEventEditRequested: function(eventId, calendarId, title, startAt, endAt, allDay,
                                                        description, location, startTimeZone, colorId,
                                                        transparency, visibility, attendeeEmailsJson,
                                                        remindersJson, remindersUseDefault, recurrenceRule,
                                                        recurringRemoteId, originalStartAt, eventType,
                                                        conferenceJson, attachmentsJson,
                                                        guestPermissionsJson, statusPropertiesJson) {
                            window.openEventEdit(eventId, calendarId, title, startAt, endAt, allDay,
                                                 description, location, startTimeZone, colorId,
                                                 transparency, visibility, attendeeEmailsJson,
                                                 remindersJson, remindersUseDefault, recurrenceRule,
                                                 recurringRemoteId, originalStartAt, eventType, conferenceJson,
                                                 attachmentsJson, guestPermissionsJson, statusPropertiesJson)
                        }
                    }

                    WeekTimelineView {
                        id: weekTimeline
                        timelineModel: window.timelineModel
                        calendarVisibility: calendarVisibility
                        selectedEventIds: window.selectedCalendarEventIds
                        dayLabels: window.calendarWeekLabels()
                        use24HourTime: window.use24HourTime
                        workdayStartHour: window.workdayStartHour
                        hourHeight: Theme.timelineHourHeight
                        onEventSelectionRequested: function(eventId, selected) {
                            window.setCalendarEventSelected(eventId, selected)
                        }
                        onEventMoveRequested: function(eventId, startAt, endAt, allDay) {
                            window.eventMoveRequested(eventId, startAt, endAt, allDay)
                            window.controllerCall("moveEvent", [eventId, startAt, endAt, allDay])
                        }
                        onEventResizeRequested: function(eventId, endAt) {
                            window.eventResizeRequested(eventId, endAt)
                            window.controllerCall("resizeEvent", [eventId, endAt])
                        }
                        onEventEditRequested: function(eventId, calendarId, title, startAt, endAt, allDay,
                                                        description, location, startTimeZone, colorId,
                                                        transparency, visibility, attendeeEmailsJson,
                                                        remindersJson, remindersUseDefault, recurrenceRule,
                                                        recurringRemoteId, originalStartAt, eventType,
                                                        conferenceJson, attachmentsJson,
                                                        guestPermissionsJson, statusPropertiesJson) {
                            window.openEventEdit(eventId, calendarId, title, startAt, endAt, allDay,
                                                 description, location, startTimeZone, colorId,
                                                 transparency, visibility, attendeeEmailsJson,
                                                 remindersJson, remindersUseDefault, recurrenceRule,
                                                 recurringRemoteId, originalStartAt, eventType, conferenceJson,
                                                 attachmentsJson, guestPermissionsJson, statusPropertiesJson)
                        }
                    }

                    MonthGridView {
                        id: monthGrid
                        monthGridModel: window.monthGridModel
                        calendarVisibility: calendarVisibility
                        selectedEventIds: window.selectedCalendarEventIds
                        weekStartDay: window.weekStartDay
                        onEventSelectionRequested: function(eventId, selected) {
                            window.setCalendarEventSelected(eventId, selected)
                        }
                        onDateSelected: function(date) {
                            window.controllerCall("setCalendarDate", [date])
                            calendarViews.currentIndex = 1
                        }
                        onEventCreateRequested: function(date) {
                            window.openEventCreate(date)
                        }
                        onEventEditRequested: function(event) {
                            window.openEventEdit(event.id, event.calendarId, event.title, event.startAt,
                                                 event.endAt, event.allDay, event.description, event.location,
                                                 event.startTimeZone, event.colorId, event.transparency,
                                                 event.visibility, event.attendeeEmailsJson, event.remindersJson,
                                                 event.remindersUseDefault, event.recurrenceRule,
                                                 event.recurringRemoteId, event.originalStartAt, event.eventType,
                                                 event.conferenceJson, event.attachmentsJson,
                                                 event.guestPermissionsJson, event.statusPropertiesJson)
                        }
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
                    text: "Enter the desktop OAuth client ID from your own Google Cloud project. Enable Google Tasks, Google Calendar, and Google Drive APIs. The app opens a local loopback callback while connecting."
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
                    text: "Google calendars"
                    font.pixelSize: Theme.bodyFontSize
                    Accessible.role: Accessible.Heading
                    Accessible.name: text
                }

                TextField {
                    id: newGoogleCalendarTitle
                    Layout.fillWidth: true
                    placeholderText: "New calendar name"
                    Accessible.name: "New Google Calendar name"
                    selectByMouse: true
                }

                TextField {
                    id: newGoogleCalendarDescription
                    Layout.fillWidth: true
                    placeholderText: "New calendar description (optional)"
                    Accessible.name: "New Google Calendar description"
                    selectByMouse: true
                }

                Button {
                    text: "Create Google Calendar"
                    enabled: window.appController !== null && window.appController.googleConnected &&
                             newGoogleCalendarTitle.text.trim().length > 0 && !window.appController.busy
                    Accessible.name: text
                    onClicked: window.controllerCall("createGoogleCalendar", [newGoogleCalendarTitle.text,
                                                                                newGoogleCalendarDescription.text,
                                                                                window.appController.displayTimeZone])
                }

                TextField {
                    id: subscribeGoogleCalendarId
                    Layout.fillWidth: true
                    placeholderText: "Calendar ID to subscribe to"
                    Accessible.name: "Google Calendar ID to subscribe to"
                    selectByMouse: true
                }

                Button {
                    text: "Subscribe to Google Calendar"
                    enabled: window.appController !== null && window.appController.googleConnected &&
                             subscribeGoogleCalendarId.text.trim().length > 0 && !window.appController.busy
                    Accessible.name: text
                    onClicked: window.controllerCall("subscribeGoogleCalendar", [subscribeGoogleCalendarId.text])
                }

                Label {
                    Layout.fillWidth: true
                    text: "Calendar sharing/ACL administration is intentionally deferred; this release creates calendars and subscribes to calendars you can access."
                    wrapMode: Text.WordWrap
                    color: Theme.textSecondary
                }

                Label {
                    text: "Undated task presentation"
                    font.pixelSize: Theme.bodyFontSize
                    Accessible.role: Accessible.Heading
                    Accessible.name: text
                }

                Switch {
                    id: notesEnabledSwitch
                    text: "Show undated tasks as Notes"
                    checked: window.notesEnabled
                    enabled: window.appController !== null && !window.appController.busy
                    Accessible.name: text
                    Accessible.description: "Changes only local presentation; Google Tasks are unchanged"
                    onToggled: window.controllerCall("saveNotesEnabled", [checked])
                }

                ComboBox {
                    id: notesProjectionSelector
                    Layout.fillWidth: true
                    visible: window.notesEnabled
                    model: ["Notes only", "Mirror in Tasks and Notes"]
                    currentIndex: window.notesProjectionMode
                    enabled: window.appController !== null && !window.appController.busy
                    Accessible.name: "Undated task presentation mode"
                    onActivated: index => window.controllerCall("saveNotesProjectionMode", [index])
                }

                Label {
                    Layout.fillWidth: true
                    text: window.notesEnabled
                          ? "Notes are ordinary undated Google Tasks. This setting only filters local views."
                          : "Notes are disabled. Every Google Task remains in Tasks."
                    wrapMode: Text.WordWrap
                    color: Theme.textSecondary
                }

                Label {
                    text: "Appearance and calendar"
                    font.pixelSize: Theme.bodyFontSize
                    Accessible.role: Accessible.Heading
                    Accessible.name: text
                }

                ComboBox {
                    Layout.fillWidth: true
                    model: ["System appearance", "Light", "Dark"]
                    currentIndex: window.appearanceMode
                    enabled: window.appController !== null && !window.appController.busy
                    Accessible.name: "Appearance"
                    onActivated: index => window.controllerCall("saveAppearanceMode", [index])
                }

                ComboBox {
                    Layout.fillWidth: true
                    model: ["Compact density", "Standard density", "Comfortable density"]
                    currentIndex: window.visualDensity
                    enabled: window.appController !== null && !window.appController.busy
                    Accessible.name: "Visual density"
                    onActivated: index => window.controllerCall("saveVisualDensity", [index])
                }

                ComboBox {
                    Layout.fillWidth: true
                    model: ["Sunday first", "Monday first"]
                    currentIndex: window.weekStartDay
                    enabled: window.appController !== null && !window.appController.busy
                    Accessible.name: "First day of week"
                    onActivated: index => window.controllerCall("saveWeekStartDay", [index])
                }

                Switch {
                    text: "Use 24-hour time"
                    checked: window.use24HourTime
                    enabled: window.appController !== null && !window.appController.busy
                    Accessible.name: text
                    onToggled: window.controllerCall("saveUse24HourTime", [checked])
                }

                TextField {
                    id: displayTimeZoneField
                    Layout.fillWidth: true
                    text: window.appController !== null && typeof window.appController.displayTimeZone === "string"
                          ? window.appController.displayTimeZone : ""
                    placeholderText: "Display time zone (IANA), e.g. Asia/Singapore"
                    Accessible.name: "Display time zone"
                    selectByMouse: true
                    onEditingFinished: window.controllerCall("saveDisplayTimeZone", [text])
                }

                RowLayout {
                    Layout.fillWidth: true

                    SpinBox {
                        id: workdayStart
                        from: 0
                        to: 23
                        value: window.workdayStartHour
                        editable: true
                        enabled: window.appController !== null && !window.appController.busy
                        Accessible.name: "Workday starts at hour"
                    }

                    Label { text: "to" }

                    SpinBox {
                        id: workdayEnd
                        from: 1
                        to: 24
                        value: window.workdayEndHour
                        editable: true
                        enabled: window.appController !== null && !window.appController.busy
                        Accessible.name: "Workday ends at hour"
                    }

                    Button {
                        text: "Save work hours"
                        enabled: window.appController !== null && !window.appController.busy
                        Accessible.name: text
                        onClicked: window.controllerCall("saveWorkdayHours", [workdayStart.value, workdayEnd.value])
                    }
                }

                Label {
                    text: "Conflict handling"
                    font.pixelSize: Theme.bodyFontSize
                    Accessible.role: Accessible.Heading
                    Accessible.name: text
                }

                ComboBox {
                    id: conflictPolicySelector
                    Layout.fillWidth: true
                    model: ["Prefer Google", "Prefer Hot Cross Buns", "Ask each time"]
                    currentIndex: window.appController !== null &&
                                  typeof window.appController.conflictPolicy === "number"
                                  ? window.appController.conflictPolicy : 0
                    enabled: window.appController !== null && !window.appController.busy
                    Accessible.name: "Sync conflict handling"
                    onActivated: index => window.controllerCall("saveConflictPolicy", [index])
                }

                Label {
                    Layout.fillWidth: true
                    text: "Google is the default. ‘Ask each time’ keeps conflicting changes pending until you choose."
                    wrapMode: Text.WordWrap
                    color: Theme.textSecondary
                }

                Repeater {
                    model: window.appController !== null && window.appController.unresolvedConflicts !== undefined
                           ? window.appController.unresolvedConflicts : []
                    delegate: RowLayout {
                        required property var modelData
                        Layout.fillWidth: true
                        spacing: Theme.spacingSmall

                        Label {
                            Layout.fillWidth: true
                            text: modelData.resource + ": " + modelData.message
                            wrapMode: Text.WordWrap
                            color: Theme.textSecondary
                        }

                        Button {
                            text: "Keep Google"
                            enabled: !window.appController.busy
                            Accessible.name: text
                            onClicked: window.controllerCall("resolveSyncConflict", [modelData.id, false])
                        }

                        Button {
                            text: "Keep HCB"
                            enabled: modelData.canKeepLocal && !window.appController.busy
                            Accessible.name: text
                            onClicked: window.controllerCall("resolveSyncConflict", [modelData.id, true])
                        }
                    }
                }

                Label {
                    visible: window.appController !== null && window.appController.resolvedConflicts !== undefined &&
                             window.appController.resolvedConflicts.length > 0
                    text: "Recent conflict resolutions"
                    font.pixelSize: Theme.bodyFontSize
                    Accessible.role: Accessible.Heading
                    Accessible.name: text
                }

                Repeater {
                    model: window.appController !== null && window.appController.resolvedConflicts !== undefined
                           ? window.appController.resolvedConflicts : []
                    delegate: Label {
                        required property var modelData
                        Layout.fillWidth: true
                        text: modelData.resource + ": " + modelData.resolution + " — " + modelData.message
                        wrapMode: Text.WordWrap
                        color: Theme.textSecondary
                        Accessible.name: text
                    }
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

    onSearchResultActivated: function(resource, resultId, title, detail) {
        if (resource === "task") {
            taskList.selectTask(resultId)
        } else if (resource === "note") {
            notesList.selectNote(resultId)
        } else if (resource === "event") {
            calendarViews.currentIndex = 0
            agendaView.selectEvent(resultId)
        }
    }

    onNotesEnabledChanged: {
        if (!notesEnabled && currentPage === "Notes") {
            currentPage = "Tasks"
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
