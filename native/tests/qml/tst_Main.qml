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
        taskModel.append({ id: "inbox-1", title: "Plan release", completed: false })
        taskModel.append({ id: "inbox-2", title: "Review sync", completed: true })
        const taskList = component.createObject(null, {
            taskModel: taskModel,
            width: 480,
            height: 320,
            visible: true
        })
        verify(taskList !== null)
        tryCompare(taskList.taskRows, "count", 2)
        let selectedId = ""
        taskList.taskSelected.connect(function(taskId) { selectedId = taskId })
        taskList.selectTask("inbox-1")
        compare(selectedId, "inbox-1")
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
            allDay: false
        })
        agendaModel.append({
            id: "event-2",
            calendarId: "calendar-1",
            title: "Team offsite",
            startAt: "2026-07-27",
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
        agenda.destroy()
        agendaModel.destroy()
    }

    function test_dayTimelinePresentsAndSelectsEvents() {
        const component = Qt.createComponent("../../qml/DayTimelineView.qml")
        compare(component.status, Component.Ready, component.errorString())

        const timelineModel = Qt.createQmlObject('import QtQml.Models; ListModel {}', testCase)
        timelineModel.append({
            id: "event-1",
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

    function test_taskListVirtualizesRows() {
        const component = Qt.createComponent("../../qml/TaskListView.qml")
        compare(component.status, Component.Ready, component.errorString())

        const taskModel = Qt.createQmlObject('import QtQml.Models; ListModel {}', testCase)
        for (let index = 0; index < 1000; ++index) {
            taskModel.append({
                id: "task-" + index,
                title: "Task " + index,
                completed: false
            })
        }
        const taskList = component.createObject(testCase, {
            taskModel: taskModel,
            width: 480,
            height: 320
        })
        verify(taskList !== null)
        tryCompare(taskList.taskRows, "count", 1000)
        verify(taskList.taskRows.reuseItems)
        compare(taskList.taskRows.cacheBuffer, taskList.taskRows.height)
        tryVerify(function() {
            return taskList.taskRows.itemAtIndex(0) !== null
        })
        verify(taskList.taskRows.contentItem.children.length < taskList.taskRows.count)
        taskList.taskRows.contentY = taskList.taskRows.contentHeight - taskList.taskRows.height
        tryVerify(function() {
            return taskList.taskRows.itemAtIndex(999) !== null
        })
        verify(taskList.taskRows.contentItem.children.length < taskList.taskRows.count)
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
