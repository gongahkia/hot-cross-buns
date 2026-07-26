import QtQuick
import QtQuick.Controls
import QtTest

TestCase {
    id: testCase
    name: "Main"
    when: windowShown

    property var startedTransitions: []
    property var completedTransitions: []

    ListModel {
        id: navigationCommands
        ListElement { commandId: "navigation.tasks"; commandLabel: "Tasks"; commandShortcut: "Ctrl+1" }
        ListElement { commandId: "navigation.calendar"; commandLabel: "Calendar"; commandShortcut: "Ctrl+2" }
        ListElement { commandId: "navigation.notes"; commandLabel: "Notes"; commandShortcut: "Ctrl+3" }
        ListElement { commandId: "navigation.settings"; commandLabel: "Settings"; commandShortcut: "Ctrl+," }
    }

    SystemPalette {
        id: systemPalette
        colorGroup: SystemPalette.Active
    }

    function begin(name) {
        startedTransitions.push(name)
        return true
    }

    function complete(name) {
        completedTransitions.push(name)
        return true
    }

    function test_loadsApplicationWindow() {
        const component = Qt.createComponent("../../qml/Main.qml")
        compare(component.status, Component.Ready, component.errorString())

        const mainWindow = component.createObject(null, { navigationCommands: navigationCommands })
        verify(mainWindow !== null)
        compare(mainWindow.title, "Hot Cross Buns")
        compare(mainWindow.width, 1200)
        compare(mainWindow.height, 760)
        compare(mainWindow.minimumWidth, 900)
        compare(mainWindow.minimumHeight, 600)
        mainWindow.destroy()
    }

    function test_recordsSidebarTransition() {
        startedTransitions = []
        completedTransitions = []
        const component = Qt.createComponent("../../qml/Main.qml")
        compare(component.status, Component.Ready, component.errorString())

        const mainWindow = component.createObject(null, {
            navigationCommands: navigationCommands,
            transitionTimings: testCase
        })
        verify(mainWindow !== null)
        mainWindow.selectPage("Calendar")
        compare(mainWindow.currentPage, "Calendar")
        compare(startedTransitions, ["navigation.calendar"])
        tryVerify(function() {
            return completedTransitions.length === 1
        })
        compare(completedTransitions, ["navigation.calendar"])
        mainWindow.destroy()
    }

    function test_unconnectedGoogleRestrictsNavigationToSettings() {
        const component = Qt.createComponent("../../qml/Main.qml")
        compare(component.status, Component.Ready, component.errorString())

        const mainWindow = component.createObject(null, {
            navigationCommands: navigationCommands,
            appController: { googleConnected: false }
        })
        verify(mainWindow !== null)
        mainWindow.selectPage("Calendar")
        compare(mainWindow.currentPage, "Tasks")
        mainWindow.selectPage("Settings")
        compare(mainWindow.currentPage, "Settings")
        mainWindow.destroy()
    }

    function test_sidebarRoutesSelectionThroughWindow() {
        startedTransitions = []
        completedTransitions = []
        const component = Qt.createComponent("../../qml/Main.qml")
        compare(component.status, Component.Ready, component.errorString())

        const mainWindow = component.createObject(null, {
            navigationCommands: navigationCommands,
            transitionTimings: testCase
        })
        verify(mainWindow !== null)
        compare(mainWindow.navigationSidebar.currentPage, "Tasks")
        compare(navigationCommands.count, 4)
        mainWindow.navigationSidebar.selectPage("Unsupported")
        compare(mainWindow.currentPage, "Tasks")
        compare(startedTransitions, [])
        mainWindow.navigationSidebar.selectPage("Notes")
        compare(mainWindow.currentPage, "Notes")
        compare(mainWindow.navigationSidebar.currentPage, "Notes")
        compare(startedTransitions, ["navigation.notes"])
        tryVerify(function() {
            return completedTransitions.length === 1
        })
        compare(completedTransitions, ["navigation.notes"])
        mainWindow.destroy()
    }

    function test_navigationShortcutRoutesSelection() {
        const component = Qt.createComponent("../../qml/Main.qml")
        compare(component.status, Component.Ready, component.errorString())

        const mainWindow = component.createObject(null, { navigationCommands: navigationCommands })
        verify(mainWindow !== null)
        compare(mainWindow.navigationShortcuts.count, 4)
        const notesShortcut = mainWindow.navigationShortcuts.objectAt(2)
        verify(notesShortcut !== null)
        compare(notesShortcut.portableText, "Ctrl+3")
        notesShortcut.activated()
        compare(mainWindow.currentPage, "Notes")
        mainWindow.destroy()
    }

    function test_commandPaletteFiltersAndActivatesCommands() {
        const component = Qt.createComponent("../../qml/Main.qml")
        compare(component.status, Component.Ready, component.errorString())

        const mainWindow = component.createObject(null, { navigationCommands: navigationCommands })
        verify(mainWindow !== null)
        mainWindow.commandPaletteShortcut.activated()
        tryVerify(function() {
            return mainWindow.commandPalette.opened
        })
        tryVerify(function() {
            return mainWindow.commandPaletteQuery.activeFocus
        })
        compare(mainWindow.commandPaletteResults.count, 4)
        mainWindow.commandPaletteQuery.text = "notes"
        tryCompare(mainWindow.commandPaletteResults, "count", 1)
        mainWindow.commandPalette.activateCurrentCommand()
        compare(mainWindow.currentPage, "Notes")
        tryVerify(function() {
            return !mainWindow.commandPalette.opened
        })
        mainWindow.destroy()
    }

    function test_commandPaletteRestoresPriorFocus() {
        const component = Qt.createComponent("../../qml/Main.qml")
        compare(component.status, Component.Ready, component.errorString())

        const mainWindow = component.createObject(null, { navigationCommands: navigationCommands })
        verify(mainWindow !== null)
        mainWindow.navigationSidebar.forceActiveFocus()
        tryVerify(function() {
            return mainWindow.navigationSidebar.activeFocus
        })
        mainWindow.openCommandPalette()
        tryVerify(function() {
            return mainWindow.commandPaletteQuery.activeFocus
        })
        mainWindow.commandPalette.close()
        tryVerify(function() {
            return mainWindow.navigationSidebar.activeFocus
        })
        mainWindow.destroy()
    }

    function test_searchUsesLocalResultsAndRoutesDeepLinks() {
        const component = Qt.createComponent("../../qml/Main.qml")
        compare(component.status, Component.Ready, component.errorString())
        const results = Qt.createQmlObject('import QtQml.Models; ListModel {}', testCase)
        results.append({ id: "task-1", resource: "task", title: "Release search", detail: "Verify cache", score: 100 })
        const calls = []
        const controller = {
            googleConnected: true,
            clientId: "",
            conflictPolicy: 0,
            unresolvedConflicts: [],
            resolvedConflicts: [],
            statusMessage: "",
            searchQuery: "",
            searchErrorMessage: "",
            searchFilterChips: [],
            searchLoading: false,
            savedSearches: [{ id: "saved-1", name: "Release", query: "release" }],
            busy: false,
            setSearchQuery: function(query) { calls.push({ method: "setSearchQuery", args: [query] }) },
            applySavedSearch: function(id) { calls.push({ method: "applySavedSearch", args: [id] }) },
            saveSearch: function(name, query) { calls.push({ method: "saveSearch", args: [name, query] }) },
            renameSavedSearch: function(id, name) { calls.push({ method: "renameSavedSearch", args: [id, name] }) },
            deleteSavedSearch: function(id) { calls.push({ method: "deleteSavedSearch", args: [id] }) }
        }
        const mainWindow = component.createObject(null, {
            navigationCommands: navigationCommands,
            appController: controller,
            searchResultsModel: results
        })
        verify(mainWindow !== null)
        let activated = null
        mainWindow.searchResultActivated.connect(function(resource, resultId, title, detail) {
            activated = { resource, resultId, title, detail }
        })
        mainWindow.searchShortcut.activated()
        tryVerify(function() { return mainWindow.searchPopup.opened && mainWindow.searchQuery.activeFocus })
        keyClick(Qt.Key_R)
        keyClick(Qt.Key_E)
        keyClick(Qt.Key_L)
        keyClick(Qt.Key_E)
        keyClick(Qt.Key_A)
        keyClick(Qt.Key_S)
        keyClick(Qt.Key_E)
        const searchCalls = calls.filter(function(call) { return call.method === "setSearchQuery" })
        verify(searchCalls.length > 0)
        verify(searchCalls[searchCalls.length - 1].args[0].length > 0)
        tryCompare(mainWindow.searchResults, "count", 1)
        mainWindow.searchResults.currentItem.click()
        compare(mainWindow.currentPage, "Tasks")
        compare(activated.resource, "task")
        compare(activated.resultId, "task-1")
        tryVerify(function() { return !mainWindow.searchPopup.opened })

        mainWindow.openSearch()
        mainWindow.searchPopup.queryField.text = "release"
        mainWindow.searchPopup.savedSearchNameField.text = "Current"
        mainWindow.searchPopup.saveSearchButton.click()
        compare(calls[calls.length - 1].method, "saveSearch")
        compare(calls[calls.length - 1].args[0], "Current")
        mainWindow.searchPopup.controllerCall("applySavedSearch", ["saved-1"])
        mainWindow.searchPopup.controllerCall("renameSavedSearch", ["saved-1", "Renamed"])
        mainWindow.searchPopup.controllerCall("deleteSavedSearch", ["saved-1"])
        compare(calls[calls.length - 3].method, "applySavedSearch")
        compare(calls[calls.length - 2].method, "renameSavedSearch")
        compare(calls[calls.length - 1].method, "deleteSavedSearch")
        mainWindow.destroy()
        results.destroy()
    }

    function test_quickCaptureEmitsTaskRequest() {
        const component = Qt.createComponent("../../qml/Main.qml")
        compare(component.status, Component.Ready, component.errorString())

        const mainWindow = component.createObject(null, { navigationCommands: navigationCommands })
        verify(mainWindow !== null)
        let capturedTitle = ""
        mainWindow.quickCaptureRequested.connect(function(title) { capturedTitle = title })
        mainWindow.quickCaptureShortcut.activated()
        tryVerify(function() {
            return mainWindow.quickCapture.opened && mainWindow.quickCapture.taskTitleField.activeFocus
        })
        mainWindow.quickCapture.taskTitle = "Ship native quick capture"
        verify(mainWindow.quickCapture.primaryEnabled)
        mainWindow.quickCapture.primaryButton.click()
        compare(capturedTitle, "Ship native quick capture")
        tryVerify(function() {
            return !mainWindow.quickCapture.opened
        })
        mainWindow.destroy()
    }

    function test_keyboardQuickCaptureSubmitsTaskRequest() {
        const component = Qt.createComponent("../../qml/Main.qml")
        compare(component.status, Component.Ready, component.errorString())

        const mainWindow = component.createObject(null, { navigationCommands: navigationCommands })
        verify(mainWindow !== null)
        let capturedTitle = ""
        mainWindow.quickCaptureRequested.connect(function(title) { capturedTitle = title })
        mainWindow.requestActivate()
        tryCompare(mainWindow, "active", true)
        keyClick(Qt.Key_N, Qt.ControlModifier | Qt.ShiftModifier)
        tryVerify(function() {
            return mainWindow.quickCapture.opened && mainWindow.quickCapture.taskTitleField.activeFocus
        })
        mainWindow.quickCapture.taskTitle = "Ship native quick capture"
        keyClick(Qt.Key_Return)
        compare(capturedTitle, "Ship native quick capture")
        tryVerify(function() {
            return !mainWindow.quickCapture.opened
        })
        mainWindow.destroy()
    }

    function test_taskListPresentsAndSelectsTasks() {
        const component = Qt.createComponent("../../qml/TaskListView.qml")
        compare(component.status, Component.Ready, component.errorString())

        const taskModel = Qt.createQmlObject('import QtQml.Models; ListModel {}', testCase)
        taskModel.append({ id: "inbox-1", taskListId: "list-active", title: "Plan release", notes: "Prepare checklist", dueAt: "2026-07-26", dueTimeZone: "Asia/Singapore", priority: 2, completed: false })
        taskModel.append({ id: "inbox-2", taskListId: "list-active", title: "Review sync", notes: "", dueAt: "", dueTimeZone: "", priority: 0, completed: true })
        const taskList = component.createObject(null, {
            taskModel: taskModel,
            width: 480,
            height: 320,
            visible: true
        })
        verify(taskList !== null)
        tryCompare(taskList.taskRows, "rows", 2)
        let selectedId = ""
        taskList.taskSelected.connect(function(taskId) { selectedId = taskId })
        taskList.selectTask("inbox-1")
        compare(selectedId, "inbox-1")
        let createRequested = false
        taskList.taskCreateRequested.connect(function() { createRequested = true })
        taskList.taskCreateButton.click()
        verify(createRequested)
        let subtaskCreate = null
        taskList.taskSubtaskCreateRequested.connect(function(parentTaskId, taskListId) {
            subtaskCreate = { parentTaskId, taskListId }
        })
        let edit = null
        taskList.taskEditRequested.connect(function(taskId, title, notes, dueAt, dueTimeZone, priority) {
            edit = { taskId, title, notes, dueAt, dueTimeZone, priority }
        })
        taskList.taskRows.itemAtIndex(taskList.taskRows.index(0, 0)).editButton.click()
        compare(edit.taskId, "inbox-1")
        compare(edit.title, "Plan release")
        compare(edit.notes, "Prepare checklist")
        compare(edit.dueAt, "2026-07-26")
        compare(edit.dueTimeZone, "Asia/Singapore")
        compare(edit.priority, 2)
        taskList.taskRows.itemAtIndex(taskList.taskRows.index(0, 0)).subtaskButton.click()
        compare(subtaskCreate.parentTaskId, "inbox-1")
        compare(subtaskCreate.taskListId, "list-active")
        let completion = null
        taskList.taskCompletionRequested.connect(function(taskId, completed) {
            completion = { taskId, completed }
        })
        tryVerify(function() {
            return taskList.taskRows.itemAtIndex(taskList.taskRows.index(0, 0)) !== null
        })
        taskList.taskRows.itemAtIndex(taskList.taskRows.index(0, 0)).completionButton.click()
        compare(completion.taskId, "inbox-1")
        compare(completion.completed, true)
        taskList.taskRows.itemAtIndex(taskList.taskRows.index(1, 0)).completionButton.click()
        compare(completion.taskId, "inbox-2")
        compare(completion.completed, false)
        let deletion = null
        taskList.taskDeleteRequested.connect(function(taskId, taskTitle) {
            deletion = { taskId, taskTitle }
        })
        taskList.taskRows.itemAtIndex(taskList.taskRows.index(0, 0)).deleteButton.click()
        compare(deletion.taskId, "inbox-1")
        compare(deletion.taskTitle, "Plan release")
        let move = null
        taskList.taskMoveRequested.connect(function(taskId, taskListId, taskTitle) {
            move = { taskId, taskListId, taskTitle }
        })
        taskList.taskRows.itemAtIndex(taskList.taskRows.index(0, 0)).moveButton.click()
        compare(move.taskId, "inbox-1")
        compare(move.taskListId, "list-active")
        compare(move.taskTitle, "Plan release")
        let reorder = null
        taskList.taskReorderRequested.connect(function(taskId, earlier) {
            reorder = { taskId, earlier }
        })
        taskList.taskRows.itemAtIndex(taskList.taskRows.index(0, 0)).moveEarlierButton.click()
        compare(reorder.taskId, "inbox-1")
        compare(reorder.earlier, true)
        taskList.taskRows.itemAtIndex(taskList.taskRows.index(1, 0)).moveLaterButton.click()
        compare(reorder.taskId, "inbox-2")
        compare(reorder.earlier, false)
        taskList.destroy()
        taskModel.destroy()
    }

    function test_agendaPresentsAndSelectsEvents() {
        const component = Qt.createComponent("../../qml/AgendaView.qml")
        compare(component.status, Component.Ready, component.errorString())

        const agendaModel = Qt.createQmlObject('import QtQml.Models; ListModel {}', testCase)
        agendaModel.append({
            id: "event-1",
            calendarId: "calendar-1",
            title: "Release review",
            startAt: "2026-07-26T10:00:00.000Z",
            endAt: "2026-07-26T11:00:00.000Z",
            description: "Verify the native package",
            location: "Studio",
            allDay: false
        })
        agendaModel.append({
            id: "event-2",
            calendarId: "calendar-1",
            title: "Team offsite",
            startAt: "2026-07-27",
            endAt: "2026-07-28",
            description: "",
            location: "",
            allDay: true
        })
        const agenda = component.createObject(null, {
            agendaModel: agendaModel,
            width: 480,
            height: 320,
            visible: true
        })
        verify(agenda !== null)
        tryCompare(agenda.eventRows, "count", 2)
        compare(agenda.scheduleLabel("2026-07-26T10:00:00.000Z", false),
                "2026-07-26T10:00:00.000Z")
        compare(agenda.scheduleLabel("2026-07-27", true), "All day")
        let selectedId = ""
        agenda.eventSelected.connect(function(eventId) { selectedId = eventId })
        agenda.selectEvent("event-1")
        compare(selectedId, "event-1")
        let edit = null
        agenda.eventEditRequested.connect(function(eventId, calendarId, title, startAt, endAt, allDay, description, location) {
            edit = { eventId, calendarId, title, startAt, endAt, allDay, description, location }
        })
        agenda.requestEdit("event-1", "calendar-1", "Release review",
                           "2026-07-26T10:00:00.000Z", "2026-07-26T11:00:00.000Z", false,
                           "Verify the native package", "Studio")
        compare(edit.eventId, "event-1")
        compare(edit.calendarId, "calendar-1")
        compare(edit.title, "Release review")
        agenda.destroy()
        agendaModel.destroy()
    }

    function test_calendarSourceControlsFilterVisibleCalendars() {
        const component = Qt.createComponent("../../qml/CalendarSourceControls.qml")
        compare(component.status, Component.Ready, component.errorString())

        const sourceModel = Qt.createQmlObject('import QtQml.Models; ListModel {}', testCase)
        sourceModel.append({ id: "calendar-product", title: "Product", selected: true })
        sourceModel.append({ id: "calendar-engineering", title: "Engineering", selected: false })
        const controls = component.createObject(null, {
            calendarSourceModel: sourceModel,
            width: 480,
            visible: true
        })
        verify(controls !== null)
        tryCompare(controls.sourceRows, "count", 2)
        verify(controls.implicitHeight > 0)
        verify(controls.isVisible("calendar-product"))
        verify(!controls.isVisible("calendar-engineering"))
        const agenda = Qt.createComponent("../../qml/AgendaView.qml").createObject(null, {
            calendarVisibility: controls
        })
        const dayTimeline = Qt.createComponent("../../qml/DayTimelineView.qml").createObject(null, {
            calendarVisibility: controls
        })
        const weekTimeline = Qt.createComponent("../../qml/WeekTimelineView.qml").createObject(null, {
            calendarVisibility: controls
        })
        const monthGrid = Qt.createComponent("../../qml/MonthGridView.qml").createObject(null, {
            calendarVisibility: controls
        })
        verify(agenda !== null)
        verify(dayTimeline !== null)
        verify(weekTimeline !== null)
        verify(monthGrid !== null)
        verify(agenda.isCalendarVisible("calendar-product"))
        verify(!agenda.isCalendarVisible("calendar-engineering"))
        verify(dayTimeline.isCalendarVisible("calendar-product"))
        verify(!dayTimeline.isCalendarVisible("calendar-engineering"))
        verify(weekTimeline.isCalendarVisible("calendar-product"))
        verify(!weekTimeline.isCalendarVisible("calendar-engineering"))
        compare(monthGrid.eventSummary([{ calendarId: "calendar-engineering", title: "Hidden" },
                                        { calendarId: "calendar-product", title: "Visible" }]),
                "Visible")
        controls.setCalendarVisible("calendar-product", false)
        verify(!controls.isVisible("calendar-product"))
        controls.setCalendarVisible("calendar-engineering", true)
        verify(controls.isVisible("calendar-engineering"))
        verify(!agenda.isCalendarVisible("calendar-product"))
        verify(dayTimeline.isCalendarVisible("calendar-engineering"))
        verify(weekTimeline.isCalendarVisible("calendar-engineering"))
        controls.showAll()
        verify(controls.isVisible("calendar-product"))
        verify(controls.isVisible("calendar-engineering"))
        monthGrid.destroy()
        weekTimeline.destroy()
        dayTimeline.destroy()
        agenda.destroy()
        controls.destroy()
        sourceModel.destroy()
    }

    function test_eventCreateDialogEmitsCreateRequest() {
        const component = Qt.createComponent("../../qml/EventCreateDialog.qml")
        compare(component.status, Component.Ready, component.errorString())

        const sourceModel = Qt.createQmlObject('import QtQml.Models; ListModel {}', testCase)
        sourceModel.append({ id: "calendar-primary", title: "Primary" })
        const dialog = component.createObject(null, {
            calendarSourceModel: sourceModel,
            width: 480,
            visible: true
        })
        verify(dialog !== null)
        dialog.openForCreate("calendar-primary")
        compare(dialog.eventCalendarId, "calendar-primary")
        dialog.eventTitle = "Release review"
        dialog.eventStartAt = "2026-07-26T10:00:00.000Z"
        dialog.eventEndAt = "2026-07-26T10:00:00.000Z"
        verify(!dialog.primaryEnabled)
        dialog.eventEndAt = "2026-07-26T11:00:00.000Z"
        dialog.eventAllDay = false
        dialog.eventDescription = "Verify the native package"
        dialog.eventLocation = "Studio"
        verify(dialog.primaryEnabled)
        let request = null
        dialog.eventCreateRequested.connect(function(calendarId, title, startAt, endAt, allDay, description, location) {
            request = { calendarId, title, startAt, endAt, allDay, description, location }
        })
        dialog.primaryButton.click()
        compare(request.calendarId, "calendar-primary")
        compare(request.title, "Release review")
        compare(request.startAt, "2026-07-26T10:00:00.000Z")
        compare(request.endAt, "2026-07-26T11:00:00.000Z")
        compare(request.allDay, false)
        compare(request.description, "Verify the native package")
        compare(request.location, "Studio")
        dialog.destroy()
        sourceModel.destroy()
    }

    function test_eventEditDialogEmitsUpdateRequest() {
        const component = Qt.createComponent("../../qml/EventEditDialog.qml")
        compare(component.status, Component.Ready, component.errorString())

        const sourceModel = Qt.createQmlObject('import QtQml.Models; ListModel {}', testCase)
        sourceModel.append({ id: "calendar-primary", title: "Primary" })
        const dialog = component.createObject(null, { calendarSourceModel: sourceModel })
        verify(dialog !== null)
        dialog.openForEdit("event-1", "calendar-primary", "Release review",
                           "2026-07-26T10:00:00.000Z", "2026-07-26T11:00:00.000Z", false,
                           "Verify the native package", "Studio")
        verify(dialog.primaryEnabled)
        let request = null
        dialog.eventUpdateRequested.connect(function(eventId, calendarId, title, startAt, endAt, allDay, description, location) {
            request = { eventId, calendarId, title, startAt, endAt, allDay, description, location }
        })
        dialog.eventTitle = "Revised release review"
        dialog.primaryButton.click()
        compare(request.eventId, "event-1")
        compare(request.calendarId, "calendar-primary")
        compare(request.title, "Revised release review")
        compare(request.startAt, "2026-07-26T10:00:00.000Z")
        compare(request.endAt, "2026-07-26T11:00:00.000Z")
        compare(request.allDay, false)
        compare(request.description, "Verify the native package")
        compare(request.location, "Studio")
        dialog.destroy()
        sourceModel.destroy()
    }

    function test_eventDeleteDialogEmitsDeleteRequest() {
        const component = Qt.createComponent("../../qml/EventDeleteDialog.qml")
        compare(component.status, Component.Ready, component.errorString())

        const dialog = component.createObject(null)
        verify(dialog !== null)
        dialog.openForDelete("event-1", "Release review")
        verify(dialog.primaryEnabled)
        let deletedId = ""
        dialog.eventDeleteRequested.connect(function(eventId) { deletedId = eventId })
        dialog.primaryButton.click()
        compare(deletedId, "event-1")
        dialog.destroy()
    }

    function test_taskDeleteDialogEmitsDeleteRequest() {
        const component = Qt.createComponent("../../qml/TaskDeleteDialog.qml")
        compare(component.status, Component.Ready, component.errorString())

        const dialog = component.createObject(null)
        verify(dialog !== null)
        dialog.openForDelete("task-1", "Plan release")
        verify(dialog.primaryEnabled)
        let deletedId = ""
        dialog.taskDeleteRequested.connect(function(taskId) { deletedId = taskId })
        dialog.primaryButton.click()
        compare(deletedId, "task-1")
        dialog.destroy()
    }

    function test_taskListControlsExposeListActionsAndStates() {
        const component = Qt.createComponent("../../qml/Main.qml")
        compare(component.status, Component.Ready, component.errorString())

        const taskLists = Qt.createQmlObject('import QtQml.Models; ListModel {}', testCase)
        taskLists.append({ id: "list-inbox", title: "Inbox", selected: true, taskCount: 2,
                           taskTitles: ["Plan release", "Review sync"] })
        taskLists.append({ id: "list-archive", title: "Archive", selected: false, taskCount: 0,
                           taskTitles: [] })
        const mainWindow = component.createObject(null, {
            navigationCommands: navigationCommands,
            taskListModel: taskLists
        })
        verify(mainWindow !== null)
        const controls = mainWindow.taskList.taskListControls
        verify(controls !== null)
        tryCompare(controls.taskListRows, "count", 2)
        let created = 0
        let renamed = null
        let deleted = null
        let selection = null
        mainWindow.taskList.taskListCreateRequested.connect(function() { created += 1 })
        mainWindow.taskList.taskListRenameRequested.connect(function(taskListId, title) {
            renamed = { taskListId, title }
        })
        mainWindow.taskList.taskListDeleteRequested.connect(function(taskListId, title, taskCount, taskTitles) {
            deleted = { taskListId, title, taskCount, taskTitles }
        })
        mainWindow.taskList.taskListSelectionRequested.connect(function(taskListId, selected) {
            selection = { taskListId, selected }
        })
        controls.newTaskListButton.click()
        compare(created, 1)
        tryVerify(function() {
            return controls.taskListRows.itemAtIndex(0) !== null
        })
        const inbox = controls.taskListRows.itemAtIndex(0)
        inbox.selectionCheck.click()
        compare(selection.taskListId, "list-inbox")
        compare(selection.selected, false)
        inbox.renameButton.click()
        compare(renamed.taskListId, "list-inbox")
        compare(renamed.title, "Inbox")
        inbox.deleteButton.click()
        compare(deleted.taskListId, "list-inbox")
        compare(deleted.taskCount, 2)
        compare(deleted.taskTitles.count, 2)
        mainWindow.destroy()
        taskLists.destroy()

        const controlsComponent = Qt.createComponent("../../qml/TaskListControls.qml")
        compare(controlsComponent.status, Component.Ready, controlsComponent.errorString())
        const loading = controlsComponent.createObject(null, { loading: true, visible: true })
        verify(loading !== null)
        verify(loading.loadingLabel.visible)
        loading.destroy()
        const errored = controlsComponent.createObject(null, {
            errorMessage: "Could not load Google Task lists", visible: true
        })
        verify(errored !== null)
        verify(errored.errorLabel.visible)
        errored.destroy()
    }

    function test_keyboardTaskListCreationOpensEditor() {
        const component = Qt.createComponent("../../qml/Main.qml")
        compare(component.status, Component.Ready, component.errorString())
        const taskLists = Qt.createQmlObject('import QtQml.Models; ListModel {}', testCase)
        taskLists.append({ id: "list-inbox", title: "Inbox", selected: true, taskCount: 0,
                           taskTitles: [] })
        const mainWindow = component.createObject(null, {
            navigationCommands: navigationCommands,
            taskListModel: taskLists
        })
        verify(mainWindow !== null)
        mainWindow.requestActivate()
        tryCompare(mainWindow, "active", true)
        mainWindow.taskList.taskListControls.newTaskListButton.forceActiveFocus()
        tryVerify(function() {
            return mainWindow.taskList.taskListControls.newTaskListButton.activeFocus
        })
        keyClick(Qt.Key_Space)
        tryVerify(function() {
            return mainWindow.taskListEditorDialog.opened &&
                    mainWindow.taskListEditorDialog.taskListTitleField.activeFocus
        })
        mainWindow.destroy()
        taskLists.destroy()
    }

    function test_bulkTaskSelectionKeyboardAndActions() {
        const component = Qt.createComponent("../../qml/Main.qml")
        compare(component.status, Component.Ready, component.errorString())
        const taskModel = Qt.createQmlObject(
            'import QtQml; QtObject { function taskIds() { return ["task-a", "task-b"] } '
            + 'function topLevelTasks() { return [{ id: "task-parent", title: "Parent" }] } }', testCase)
        const calls = []
        const controller = {
            googleConnected: true,
            busy: false,
            bulkSetTaskCompleted: function(taskIds, completed) {
                calls.push({ action: "complete", taskIds: taskIds, completed: completed })
            },
            bulkDeleteTasks: function(taskIds) {
                calls.push({ action: "delete", taskIds: taskIds })
            },
            bulkSetTaskDue: function(taskIds, dueAt) {
                calls.push({ action: "due", taskIds: taskIds, dueAt: dueAt })
            }
        }
        const mainWindow = component.createObject(null, {
            navigationCommands: navigationCommands,
            taskModel: taskModel,
            appController: controller
        })
        verify(mainWindow !== null)
        mainWindow.requestActivate()
        tryCompare(mainWindow, "active", true)
        mainWindow.taskList.bulkSelectAllButton.forceActiveFocus()
        keyClick(Qt.Key_A, Qt.ControlModifier)
        tryCompare(mainWindow.taskList.selectedTaskIds, "length", 2)
        compare(mainWindow.taskList.bulkSelectionStatus.text, "2 selected · eligibility checked before queueing")
        compare(mainWindow.taskList.bulkCompleteButton.Accessible.name, "Complete 2 tasks")
        mainWindow.taskList.bulkCompleteButton.click()
        compare(calls.length, 1)
        compare(calls[0].action, "complete")
        compare(calls[0].taskIds.length, 2)
        compare(calls[0].completed, true)
        mainWindow.taskList.bulkDeleteButton.click()
        verify(mainWindow.taskList.bulkDeleteDialog.opened)
        verify(mainWindow.taskList.bulkDeleteDialog.primaryEnabled)
        mainWindow.taskList.bulkDeleteDialog.primaryButton.click()
        compare(calls.length, 2)
        compare(calls[1].action, "delete")
        mainWindow.taskList.bulkEditDialog.openForDue(mainWindow.taskList.selectedTaskIds)
        mainWindow.taskList.bulkEditDialog.dueField.text = "2026-08-01"
        mainWindow.taskList.bulkEditDialog.primaryButton.click()
        compare(calls.length, 3)
        compare(calls[2].action, "due")
        compare(calls[2].dueAt, "2026-08-01")
        mainWindow.destroy()
        taskModel.destroy()
    }

    function test_taskListDialogsNameAffectedTasksAndEmitRequests() {
        const editorComponent = Qt.createComponent("../../qml/TaskListEditorDialog.qml")
        compare(editorComponent.status, Component.Ready, editorComponent.errorString())
        const editor = editorComponent.createObject(null)
        verify(editor !== null)
        let saved = null
        editor.taskListSaveRequested.connect(function(taskListId, title) {
            saved = { taskListId, title }
        })
        editor.openForCreate()
        editor.taskListTitleField.text = "Work"
        editor.primaryButton.click()
        compare(saved.taskListId, "")
        compare(saved.title, "Work")
        editor.openForRename("list-work", "Work")
        editor.taskListTitleField.text = "Projects"
        editor.primaryButton.click()
        compare(saved.taskListId, "list-work")
        compare(saved.title, "Projects")
        editor.destroy()

        const deleteComponent = Qt.createComponent("../../qml/TaskListDeleteDialog.qml")
        compare(deleteComponent.status, Component.Ready, deleteComponent.errorString())
        const deleteDialog = deleteComponent.createObject(null)
        verify(deleteDialog !== null)
        deleteDialog.openForDelete("list-work", "Projects", 3,
                                    ["Plan release", "Review sync"])
        tryCompare(deleteDialog.taskRows, "count", 2)
        compare(deleteDialog.taskTitles[0], "Plan release")
        compare(deleteDialog.taskTitles[1], "Review sync")
        let deletedId = ""
        deleteDialog.taskListDeleteRequested.connect(function(taskListId) { deletedId = taskListId })
        deleteDialog.primaryButton.click()
        compare(deletedId, "list-work")
        deleteDialog.destroy()
    }

    function test_taskCreateDialogEmitsCreateRequest() {
        const component = Qt.createComponent("../../qml/TaskCreateDialog.qml")
        compare(component.status, Component.Ready, component.errorString())

        const taskLists = Qt.createQmlObject('import QtQml.Models; ListModel {}', testCase)
        taskLists.append({ id: "list-active", title: "Inbox" })
        taskLists.append({ id: "list-other", title: "Archive" })
        const dialog = component.createObject(null, { taskListModel: taskLists })
        verify(dialog !== null)
        dialog.openForCreate("list-other")
        compare(dialog.taskListId, "list-other")
        dialog.taskTitle = "Plan release"
        verify(dialog.primaryEnabled)
        let request = null
        dialog.taskCreateRequested.connect(function(taskListId, parentTaskId, title) {
            request = { taskListId, parentTaskId, title }
        })
        dialog.primaryButton.click()
        compare(request.taskListId, "list-other")
        compare(request.parentTaskId, "")
        compare(request.title, "Plan release")
        dialog.destroy()
        taskLists.destroy()
    }

    function test_taskEditDialogEmitsUpdateRequest() {
        const component = Qt.createComponent("../../qml/TaskEditDialog.qml")
        compare(component.status, Component.Ready, component.errorString())

        const dialog = component.createObject(null)
        verify(dialog !== null)
        dialog.openForEdit("task-1", "Plan release", "Prepare checklist", "2026-07-26",
                           "Asia/Singapore", 2)
        compare(dialog.taskPriority, 2)
        dialog.taskTitle = "Revised release plan"
        dialog.taskNotes = "Confirm rollout"
        dialog.taskDueAt = "2026-07-27"
        dialog.taskPriorityPicker.currentIndex = 3
        verify(dialog.primaryEnabled)
        let request = null
        dialog.taskUpdateRequested.connect(function(taskId, title, notes, dueAt, dueTimeZone, priority) {
            request = { taskId, title, notes, dueAt, dueTimeZone, priority }
        })
        dialog.primaryButton.click()
        compare(request.taskId, "task-1")
        compare(request.title, "Revised release plan")
        compare(request.notes, "Confirm rollout")
        compare(request.dueAt, "2026-07-27")
        compare(request.dueTimeZone, "Asia/Singapore")
        compare(request.priority, 3)
        dialog.openForEdit("task-1", "Plan release", "", "2026-07-26", "Asia/Singapore", 0)
        dialog.taskDueAt = ""
        let clearedDueRequest = null
        dialog.taskUpdateRequested.connect(function(taskId, title, notes, dueAt, dueTimeZone, priority) {
            clearedDueRequest = { taskId, title, notes, dueAt, dueTimeZone, priority }
        })
        dialog.primaryButton.click()
        compare(clearedDueRequest.dueAt, "")
        compare(clearedDueRequest.dueTimeZone, "")
        dialog.destroy()
    }

    function test_taskMoveDialogShowsAllActiveListsAndEmitsMoveRequest() {
        const component = Qt.createComponent("../../qml/Main.qml")
        compare(component.status, Component.Ready, component.errorString())

        const taskLists = Qt.createQmlObject('import QtQml.Models; ListModel {}', testCase)
        taskLists.append({ id: "list-active", title: "Inbox", selected: true, taskCount: 0,
                           taskTitles: [] })
        taskLists.append({ id: "list-other", title: "Archive", selected: false, taskCount: 0,
                           taskTitles: [] })
        const mainWindow = component.createObject(null, {
            navigationCommands: navigationCommands,
            taskListModel: taskLists,
        })
        verify(mainWindow !== null)
        const dialog = mainWindow.taskMoveDialog
        dialog.openForMove("task-1", "Plan release", "list-active")
        tryCompare(dialog.taskListRows, "count", 2)
        tryVerify(function() {
            return dialog.taskListRows.itemAtIndex(0) !== null &&
                    dialog.taskListRows.itemAtIndex(1) !== null
        })
        verify(!dialog.taskListRows.itemAtIndex(0).enabled)
        verify(dialog.taskListRows.itemAtIndex(1).enabled)
        dialog.taskListRows.itemAtIndex(1).click()
        verify(dialog.primaryEnabled)
        let move = null
        dialog.taskMoveRequested.connect(function(taskId, taskListId) {
            move = { taskId, taskListId }
        })
        dialog.primaryButton.click()
        compare(move.taskId, "task-1")
        compare(move.taskListId, "list-other")
        mainWindow.destroy()
        taskLists.destroy()
    }

    function test_dayTimelinePresentsAndSelectsEvents() {
        const component = Qt.createComponent("../../qml/DayTimelineView.qml")
        compare(component.status, Component.Ready, component.errorString())

        const timelineModel = Qt.createQmlObject('import QtQml.Models; ListModel {}', testCase)
        timelineModel.append({
            id: "event-1",
            calendarId: "calendar-1",
            title: "Release review",
            allDay: false,
            dayIndex: 0,
            startMinute: 540,
            durationMinutes: 60,
            laneIndex: 0,
            laneCount: 2
        })
        timelineModel.append({
            id: "event-2",
            calendarId: "calendar-1",
            title: "Team offsite",
            allDay: true,
            dayIndex: 0,
            startMinute: 0,
            durationMinutes: 0,
            laneIndex: 0,
            laneCount: 1
        })
        const timeline = component.createObject(null, {
            timelineModel: timelineModel,
            width: 480,
            height: 640,
            visible: true
        })
        verify(timeline !== null)
        tryCompare(timeline.eventRows, "count", 2)
        compare(timeline.timePosition(540), 576)
        compare(timeline.eventHeight(60), 64)
        compare(timeline.eventHeight(1), 24)
        let selectedId = ""
        timeline.eventSelected.connect(function(eventId) { selectedId = eventId })
        timeline.selectEvent("event-1")
        compare(selectedId, "event-1")
        timeline.destroy()
        timelineModel.destroy()
    }

    function test_dayTimelineRequestsMoves() {
        const component = Qt.createComponent("../../qml/DayTimelineView.qml")
        compare(component.status, Component.Ready, component.errorString())

        const timelineModel = Qt.createQmlObject('import QtQml.Models; ListModel { function moveInput(eventId, dayIndex, minute) { return { id: eventId, startAt: "2026-07-26T10:00:00.000Z", endAt: "2026-07-26T11:00:00.000Z", allDay: false } } }', testCase)
        const timeline = component.createObject(null, { timelineModel: timelineModel })
        verify(timeline !== null)
        let request = null
        timeline.eventMoveRequested.connect(function(eventId, startAt, endAt, allDay) {
            request = { eventId, startAt, endAt, allDay }
        })
        timeline.requestMove("event-1", 0, 600)
        compare(request.eventId, "event-1")
        compare(request.startAt, "2026-07-26T10:00:00.000Z")
        compare(request.endAt, "2026-07-26T11:00:00.000Z")
        compare(request.allDay, false)
        compare(timeline.dropMinute(-1), 0)
        compare(timeline.dropMinute(99999), 1439)
        timeline.destroy()
        timelineModel.destroy()
    }

    function test_dayTimelineRequestsResizes() {
        const component = Qt.createComponent("../../qml/DayTimelineView.qml")
        compare(component.status, Component.Ready, component.errorString())

        const timelineModel = Qt.createQmlObject('import QtQml.Models; ListModel { function resizeInput(eventId, dayIndex, minute) { return { id: eventId, endAt: "2026-07-26T12:00:00.000Z" } } }', testCase)
        const timeline = component.createObject(null, { timelineModel: timelineModel })
        verify(timeline !== null)
        let request = null
        timeline.eventResizeRequested.connect(function(eventId, endAt) {
            request = { eventId, endAt }
        })
        timeline.requestResize("event-1", 0, 720)
        compare(request.eventId, "event-1")
        compare(request.endAt, "2026-07-26T12:00:00.000Z")
        compare(timeline.dropEndMinute(-1), 0)
        compare(timeline.dropEndMinute(99999), 1440)
        timeline.destroy()
        timelineModel.destroy()
    }

    function test_weekTimelinePresentsAndSelectsEvents() {
        const component = Qt.createComponent("../../qml/WeekTimelineView.qml")
        compare(component.status, Component.Ready, component.errorString())

        const timelineModel = Qt.createQmlObject('import QtQml.Models; ListModel {}', testCase)
        timelineModel.append({
            id: "event-1",
            calendarId: "calendar-1",
            title: "Release review",
            allDay: false,
            dayIndex: 3,
            startMinute: 540,
            durationMinutes: 60,
            laneIndex: 0,
            laneCount: 2,
            daySpan: 1
        })
        timelineModel.append({
            id: "event-2",
            calendarId: "calendar-1",
            title: "Team offsite",
            allDay: true,
            dayIndex: 1,
            startMinute: 0,
            durationMinutes: 0,
            laneIndex: 0,
            laneCount: 1,
            daySpan: 2
        })
        const timeline = component.createObject(null, {
            timelineModel: timelineModel,
            width: 764,
            height: 640,
            visible: true
        })
        verify(timeline !== null)
        tryCompare(timeline.eventRows, "count", 2)
        compare(timeline.dayColumnWidth(764), 100)
        compare(timeline.dayPosition(3, 764), 364)
        compare(timeline.timePosition(540), 432)
        let selectedId = ""
        timeline.eventSelected.connect(function(eventId) { selectedId = eventId })
        timeline.selectEvent("event-1")
        compare(selectedId, "event-1")
        timeline.destroy()
        timelineModel.destroy()
    }

    function test_weekTimelineRequestsMoves() {
        const component = Qt.createComponent("../../qml/WeekTimelineView.qml")
        compare(component.status, Component.Ready, component.errorString())

        const timelineModel = Qt.createQmlObject('import QtQml.Models; ListModel { function moveInput(eventId, dayIndex, minute) { return { id: eventId, startAt: "2026-07-27T10:00:00.000Z", endAt: "2026-07-27T11:00:00.000Z", allDay: false } } }', testCase)
        const timeline = component.createObject(null, { timelineModel: timelineModel, width: 764 })
        verify(timeline !== null)
        let request = null
        timeline.eventMoveRequested.connect(function(eventId, startAt, endAt, allDay) {
            request = { eventId, startAt, endAt, allDay }
        })
        timeline.requestMove("event-1", 1, 600)
        compare(request.eventId, "event-1")
        compare(request.startAt, "2026-07-27T10:00:00.000Z")
        compare(request.endAt, "2026-07-27T11:00:00.000Z")
        compare(request.allDay, false)
        compare(timeline.dropDayIndex(-1, 764), 0)
        compare(timeline.dropDayIndex(99999, 764), 6)
        compare(timeline.dropMinute(99999), 1439)
        timeline.destroy()
        timelineModel.destroy()
    }

    function test_monthGridFormatsCellsAndSelection() {
        const component = Qt.createComponent("../../qml/MonthGridView.qml")
        compare(component.status, Component.Ready, component.errorString())

        const monthGrid = component.createObject(null, {
            width: 700,
            height: 480,
            visible: true
        })
        verify(monthGrid !== null)
        compare(monthGrid.eventSummary([]), "")
        compare(monthGrid.eventSummary([{ title: "Release review" }]), "Release review")
        compare(monthGrid.eventSummary([{ title: "Release review" }, { title: "Offsite" }]),
                "Release review +1")
        let selectedDate = ""
        monthGrid.dateSelected.connect(function(date) { selectedDate = date })
        monthGrid.selectDate("2026-07-26")
        compare(selectedDate, "2026-07-26")
        monthGrid.destroy()
    }

    function test_taskListVirtualizesRows() {
        const component = Qt.createComponent("../../qml/TaskListView.qml")
        compare(component.status, Component.Ready, component.errorString())

        const taskModel = Qt.createQmlObject('import QtQml.Models; ListModel {}', testCase)
        for (let index = 0; index < 1000; ++index) {
            taskModel.append({
                id: "task-" + index,
                taskListId: "list-active",
                title: "Task " + index,
                notes: "",
                dueAt: "",
                dueTimeZone: "",
                priority: 0,
                completed: false
            })
        }
        const taskList = component.createObject(testCase, {
            taskModel: taskModel,
            width: 480,
            height: 320
        })
        verify(taskList !== null)
        tryCompare(taskList.taskRows, "rows", 1000)
        verify(taskList.taskRows.reuseItems)
        tryVerify(function() {
            return taskList.taskRows.itemAtIndex(taskList.taskRows.index(0, 0)) !== null
        })
        verify(taskList.taskRows.contentItem.children.length < taskList.taskRows.rows)
        taskList.taskRows.contentY = taskList.taskRows.contentHeight - taskList.taskRows.height
        tryVerify(function() {
            return taskList.taskRows.itemAtIndex(taskList.taskRows.index(999, 0)) !== null
        })
        verify(taskList.taskRows.contentItem.children.length < taskList.taskRows.rows)
        taskList.destroy()
        taskModel.destroy()
    }

    function test_notesListPresentsAndSelectsNotes() {
        const component = Qt.createComponent("../../qml/NotesListView.qml")
        compare(component.status, Component.Ready, component.errorString())

        const notesModel = Qt.createQmlObject('import QtQml.Models; ListModel {}', testCase)
        notesModel.append({
            id: "note-1",
            taskListTitle: "Inbox",
            title: "Release notes",
            body: "Verify the package artifacts"
        })
        notesModel.append({
            id: "note-2",
            taskListTitle: "Work",
            title: "Sprint plan",
            body: "Review the current priorities"
        })
        const notesList = component.createObject(null, {
            notesModel: notesModel,
            width: 480,
            height: 320,
            visible: true
        })
        verify(notesList !== null)
        tryCompare(notesList.noteRows, "count", 2)
        let selectedId = ""
        let selectedTitle = ""
        let selectedBody = ""
        notesList.noteSelected.connect(function(noteId, title, body) {
            selectedId = noteId
            selectedTitle = title
            selectedBody = body
        })
        notesList.selectNote("note-1", "Release notes", "Verify the package artifacts")
        compare(selectedId, "note-1")
        compare(selectedTitle, "Release notes")
        compare(selectedBody, "Verify the package artifacts")
        notesList.destroy()
        notesModel.destroy()
    }

    function test_noteEditorEmitsSaveRequest() {
        const component = Qt.createComponent("../../qml/NoteEditorDialog.qml")
        compare(component.status, Component.Ready, component.errorString())

        const editor = component.createObject(null, {
            noteId: "note-1",
            noteTitle: "Release notes",
            noteBody: "Verify the package artifacts"
        })
        verify(editor !== null)
        verify(editor.primaryEnabled)
        let saved = null
        editor.noteSaveRequested.connect(function(noteId, title, body) {
            saved = { noteId: noteId, title: title, body: body }
        })
        editor.noteTitle = " Revised release notes "
        editor.noteBody = "Update the package checklist"
        editor.primaryButton.click()
        compare(saved.noteId, "note-1")
        compare(saved.title, "Revised release notes")
        compare(saved.body, "Update the package checklist")
        editor.destroy()
    }

    function test_mainForwardsNoteSaveRequest() {
        const component = Qt.createComponent("../../qml/Main.qml")
        compare(component.status, Component.Ready, component.errorString())

        const mainWindow = component.createObject(null, { navigationCommands: navigationCommands })
        verify(mainWindow !== null)
        let saved = null
        mainWindow.noteSaveRequested.connect(function(noteId, title, body) {
            saved = { noteId: noteId, title: title, body: body }
        })
        mainWindow.openNoteEditor("note-1", "Release notes", "Verify the package artifacts")
        tryVerify(function() {
            return mainWindow.noteEditor.opened && mainWindow.noteEditor.noteTitleField.activeFocus
        })
        mainWindow.noteEditor.noteTitle = "Revised release notes"
        mainWindow.noteEditor.noteBody = "Update the package checklist"
        mainWindow.noteEditor.primaryButton.click()
        compare(saved.noteId, "note-1")
        compare(saved.title, "Revised release notes")
        compare(saved.body, "Update the package checklist")
        mainWindow.destroy()
    }

    function test_mainForwardsEventCreateRequest() {
        const component = Qt.createComponent("../../qml/Main.qml")
        compare(component.status, Component.Ready, component.errorString())

        const mainWindow = component.createObject(null, { navigationCommands: navigationCommands })
        verify(mainWindow !== null)
        let request = null
        mainWindow.eventCreateRequested.connect(function(calendarId, title, startAt, endAt, allDay, description, location) {
            request = { calendarId, title, startAt, endAt, allDay, description, location }
        })
        mainWindow.eventCreateDialog.eventCreateRequested("calendar-primary", "Release review",
                                                          "2026-07-26T10:00:00.000Z",
                                                          "2026-07-26T11:00:00.000Z", false,
                                                          "Verify the native package", "Studio")
        compare(request.calendarId, "calendar-primary")
        compare(request.title, "Release review")
        compare(request.startAt, "2026-07-26T10:00:00.000Z")
        compare(request.endAt, "2026-07-26T11:00:00.000Z")
        compare(request.allDay, false)
        compare(request.description, "Verify the native package")
        compare(request.location, "Studio")
        mainWindow.destroy()
    }

    function test_mainForwardsEventUpdateRequest() {
        const component = Qt.createComponent("../../qml/Main.qml")
        compare(component.status, Component.Ready, component.errorString())

        const mainWindow = component.createObject(null, { navigationCommands: navigationCommands })
        verify(mainWindow !== null)
        let request = null
        mainWindow.eventUpdateRequested.connect(function(eventId, calendarId, title, startAt, endAt, allDay, description, location) {
            request = { eventId, calendarId, title, startAt, endAt, allDay, description, location }
        })
        mainWindow.eventEditDialog.eventUpdateRequested("event-1", "calendar-primary", "Release review",
                                                        "2026-07-26T10:00:00.000Z",
                                                        "2026-07-26T11:00:00.000Z", false,
                                                        "Verify the native package", "Studio")
        compare(request.eventId, "event-1")
        compare(request.calendarId, "calendar-primary")
        compare(request.title, "Release review")
        compare(request.startAt, "2026-07-26T10:00:00.000Z")
        compare(request.endAt, "2026-07-26T11:00:00.000Z")
        compare(request.allDay, false)
        compare(request.description, "Verify the native package")
        compare(request.location, "Studio")
        mainWindow.destroy()
    }

    function test_mainForwardsEventDeleteRequest() {
        const component = Qt.createComponent("../../qml/Main.qml")
        compare(component.status, Component.Ready, component.errorString())

        const mainWindow = component.createObject(null, { navigationCommands: navigationCommands })
        verify(mainWindow !== null)
        let deletedId = ""
        mainWindow.eventDeleteRequested.connect(function(eventId) { deletedId = eventId })
        mainWindow.eventDeleteDialog.eventDeleteRequested("event-1")
        compare(deletedId, "event-1")
        mainWindow.destroy()
    }

    function test_mainForwardsTaskDeleteRequest() {
        const component = Qt.createComponent("../../qml/Main.qml")
        compare(component.status, Component.Ready, component.errorString())

        const mainWindow = component.createObject(null, { navigationCommands: navigationCommands })
        verify(mainWindow !== null)
        let deletedId = ""
        mainWindow.taskDeleteRequested.connect(function(taskId) { deletedId = taskId })
        mainWindow.taskDeleteDialog.taskDeleteRequested("task-1")
        compare(deletedId, "task-1")
        mainWindow.destroy()
    }

    function test_mainForwardsTaskCreateRequest() {
        const component = Qt.createComponent("../../qml/Main.qml")
        compare(component.status, Component.Ready, component.errorString())

        const mainWindow = component.createObject(null, { navigationCommands: navigationCommands })
        verify(mainWindow !== null)
        let request = null
        mainWindow.taskCreateRequested.connect(function(taskListId, parentTaskId, title) {
            request = { taskListId, parentTaskId, title }
        })
        mainWindow.taskCreateDialog.taskCreateRequested("list-active", "", "Plan release")
        compare(request.taskListId, "list-active")
        compare(request.parentTaskId, "")
        compare(request.title, "Plan release")
        mainWindow.destroy()
    }

    function test_mainForwardsTaskReparentRequest() {
        const component = Qt.createComponent("../../qml/Main.qml")
        compare(component.status, Component.Ready, component.errorString())

        const mainWindow = component.createObject(null, { navigationCommands: navigationCommands })
        verify(mainWindow !== null)
        let request = null
        mainWindow.taskReparentRequested.connect(function(taskId, parentTaskId) {
            request = { taskId, parentTaskId }
        })
        mainWindow.taskList.taskReparentRequested("task-1", "")
        compare(request.taskId, "task-1")
        compare(request.parentTaskId, "")
        mainWindow.destroy()
    }

    function test_mainForwardsTaskUpdateRequest() {
        const component = Qt.createComponent("../../qml/Main.qml")
        compare(component.status, Component.Ready, component.errorString())

        const mainWindow = component.createObject(null, { navigationCommands: navigationCommands })
        verify(mainWindow !== null)
        let request = null
        mainWindow.taskUpdateRequested.connect(function(taskId, title, notes, dueAt, dueTimeZone, priority) {
            request = { taskId, title, notes, dueAt, dueTimeZone, priority }
        })
        mainWindow.taskEditDialog.taskUpdateRequested("task-1", "Plan release", "Prepare checklist",
                                                      "2026-07-26", "Asia/Singapore", 2)
        compare(request.taskId, "task-1")
        compare(request.title, "Plan release")
        compare(request.notes, "Prepare checklist")
        compare(request.dueAt, "2026-07-26")
        compare(request.dueTimeZone, "Asia/Singapore")
        compare(request.priority, 2)
        mainWindow.destroy()
    }

    function test_mainForwardsTaskMoveRequest() {
        const component = Qt.createComponent("../../qml/Main.qml")
        compare(component.status, Component.Ready, component.errorString())

        const mainWindow = component.createObject(null, { navigationCommands: navigationCommands })
        verify(mainWindow !== null)
        let move = null
        mainWindow.taskMoveRequested.connect(function(taskId, taskListId) {
            move = { taskId, taskListId }
        })
        mainWindow.taskMoveDialog.taskMoveRequested("task-1", "list-other")
        compare(move.taskId, "task-1")
        compare(move.taskListId, "list-other")
        mainWindow.destroy()
    }

    function test_mainForwardsEventMoveRequest() {
        const component = Qt.createComponent("../../qml/Main.qml")
        compare(component.status, Component.Ready, component.errorString())

        const mainWindow = component.createObject(null, { navigationCommands: navigationCommands })
        verify(mainWindow !== null)
        let request = null
        mainWindow.eventMoveRequested.connect(function(eventId, startAt, endAt, allDay) {
            request = { eventId, startAt, endAt, allDay }
        })
        mainWindow.dayTimeline.eventMoveRequested("event-1", "2026-07-26T10:00:00.000Z",
                                                  "2026-07-26T11:00:00.000Z", false)
        compare(request.eventId, "event-1")
        compare(request.startAt, "2026-07-26T10:00:00.000Z")
        compare(request.endAt, "2026-07-26T11:00:00.000Z")
        compare(request.allDay, false)
        mainWindow.destroy()
    }

    function test_mainForwardsEventResizeRequest() {
        const component = Qt.createComponent("../../qml/Main.qml")
        compare(component.status, Component.Ready, component.errorString())

        const mainWindow = component.createObject(null, { navigationCommands: navigationCommands })
        verify(mainWindow !== null)
        let request = null
        mainWindow.eventResizeRequested.connect(function(eventId, endAt) {
            request = { eventId, endAt }
        })
        mainWindow.dayTimeline.eventResizeRequested("event-1", "2026-07-26T12:00:00.000Z")
        compare(request.eventId, "event-1")
        compare(request.endAt, "2026-07-26T12:00:00.000Z")
        mainWindow.destroy()
    }

    function test_keyboardNoteEditSubmitsSaveRequest() {
        const component = Qt.createComponent("../../qml/Main.qml")
        compare(component.status, Component.Ready, component.errorString())

        const notesModel = Qt.createQmlObject('import QtQml.Models; ListModel {}', testCase)
        notesModel.append({
            id: "note-1",
            taskListTitle: "Inbox",
            title: "Release notes",
            body: "Verify the package artifacts"
        })
        const mainWindow = component.createObject(null, {
            navigationCommands: navigationCommands,
            notesModel: notesModel
        })
        verify(mainWindow !== null)
        let saved = null
        mainWindow.noteSaveRequested.connect(function(noteId, title, body) {
            saved = { noteId: noteId, title: title, body: body }
        })
        mainWindow.requestActivate()
        tryCompare(mainWindow, "active", true)
        keyClick(Qt.Key_3, Qt.ControlModifier)
        tryCompare(mainWindow, "currentPage", "Notes")
        tryVerify(function() {
            return mainWindow.notesList.noteRows.itemAtIndex(0) !== null
        })
        const noteRow = mainWindow.notesList.noteRows.itemAtIndex(0)
        noteRow.forceActiveFocus()
        tryVerify(function() { return noteRow.activeFocus })
        keyClick(Qt.Key_Space)
        tryVerify(function() {
            return mainWindow.noteEditor.opened && mainWindow.noteEditor.noteTitleField.activeFocus
        })
        mainWindow.noteEditor.noteTitle = "Revised release notes"
        keyClick(Qt.Key_Return)
        compare(saved.noteId, "note-1")
        compare(saved.title, "Revised release notes")
        compare(saved.body, "Verify the package artifacts")
        mainWindow.destroy()
        notesModel.destroy()
    }

    function test_usesDesignTokens() {
        const component = Qt.createComponent("../../qml/Main.qml")
        compare(component.status, Component.Ready, component.errorString())

        const mainWindow = component.createObject(null, { navigationCommands: navigationCommands })
        verify(mainWindow !== null)
        compare(mainWindow.color.toString(), systemPalette.window.toString())
        compare(mainWindow.palette.window.toString(), systemPalette.window.toString())
        compare(mainWindow.palette.base.toString(), systemPalette.base.toString())
        compare(mainWindow.palette.highlight.toString(), systemPalette.highlight.toString())
        mainWindow.destroy()
    }

    function test_accessibleButtonExposesLabelAndPressAction() {
        const component = Qt.createComponent("../../qml/AccessibleButton.qml")
        compare(component.status, Component.Ready, component.errorString())

        const button = component.createObject(null, { text: "Save" })
        verify(button !== null)
        compare(button.accessibleName, "")
        compare(button.Accessible.name, "Save")
        compare(button.Accessible.role, Accessible.Button)
        verify(button.Accessible.focusable)
        button.accessibleName = "Save draft"
        compare(button.Accessible.name, "Save draft")
        button.destroy()
    }

    function test_accessibleNavigationButtonRoutesSelection() {
        const component = Qt.createComponent("../../qml/AccessibleNavigationButton.qml")
        compare(component.status, Component.Ready, component.errorString())

        const button = component.createObject(null, { pageName: "Notes", currentPage: true })
        verify(button !== null)
        let selectedPage = ""
        button.pageSelected.connect(function(pageName) {
            selectedPage = pageName
        })
        compare(button.text, "Notes")
        verify(button.checkable)
        verify(button.checked)
        compare(button.Accessible.name, "Notes")
        compare(button.Accessible.role, Accessible.PageTab)
        verify(button.Accessible.checkable)
        verify(button.Accessible.checked)
        button.click()
        compare(selectedPage, "Notes")
        button.destroy()
    }

    function test_dialogProvidesComposableAccessibleActions() {
        const component = Qt.createComponent("../../qml/HcbDialog.qml")
        compare(component.status, Component.Ready, component.errorString())

        const dialog = component.createObject(null, {
            title: "Edit task",
            primaryText: "Update",
            secondaryText: "Discard",
            primaryDestructive: true
        })
        verify(dialog !== null)
        compare(dialog.primaryButton.text, "Update")
        compare(dialog.secondaryButton.text, "Discard")
        compare(dialog.primaryButton.Accessible.description, "Destructive action")
        compare(dialog.closePolicy, Popup.CloseOnEscape)

        let primaryActions = 0
        let secondaryActions = 0
        dialog.primaryAction.connect(function() { primaryActions += 1 })
        dialog.secondaryAction.connect(function() { secondaryActions += 1 })
        dialog.primaryButton.click()
        dialog.secondaryButton.click()
        compare(primaryActions, 1)
        compare(secondaryActions, 1)
        dialog.destroy()
    }
}
