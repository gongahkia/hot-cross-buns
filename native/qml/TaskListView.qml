import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Pane {
    id: root
    property var taskListModel: null
    property var taskModel: null
    property bool taskListLoading: false
    property string taskListErrorMessage: ""
    property string bulkTaskStatusMessage: ""
    property string bulkTaskPreviewMessage: ""
    property int bulkTaskPreviewRequestToken: -1
    property int bulkTextRecurrenceScope: 2
    property var selectedTaskIds: []
    property alias taskRows: taskRows
    property alias taskCreateButton: taskCreateButton
    property alias importButton: importButton
    property alias taskListControls: taskListControls
    property alias bulkSelectAllButton: bulkSelectAllButton
    property alias bulkCompleteButton: bulkCompleteButton
    property alias bulkDeleteButton: bulkDeleteButton
    property alias bulkSelectionStatus: bulkSelectionStatus
    property alias bulkDeleteDialog: bulkDeleteDialog
    property alias bulkMoveDialog: bulkMoveDialog
    property alias bulkEditDialog: bulkEditDialog
    signal taskSelected(string taskId)
    signal taskCreateRequested()
    signal importRequested()
    signal taskSubtaskCreateRequested(string parentTaskId, string taskListId)
    signal taskEditRequested(string taskId, string title, string notes, string dueAt,
                             string dueTimeZone, int priority, bool managedRecurrence,
                             string recurrenceSummary, int recurrenceFrequency, int recurrenceInterval,
                             int recurrenceEndKind, string recurrenceEndUntil, int recurrenceEndCount,
                             string recurrenceRule, string recurrenceExclusionDates,
                             string recurrenceAdditionDates)
    signal taskCompletionRequested(string taskId, bool completed)
    signal taskDeleteRequested(string taskId, string taskTitle, bool managedRecurrence)
    signal taskMoveRequested(string taskId, string taskListId, string taskTitle)
    signal taskReparentRequested(string taskId, string parentTaskId)
    signal taskReorderRequested(string taskId, bool earlier)
    signal taskListCreateRequested()
    signal taskListRenameRequested(string taskListId, string title)
    signal taskListDeleteRequested(string taskListId, string title, int taskCount, var taskTitles)
    signal taskListSelectionRequested(string taskListId, bool selected)
    signal bulkTaskCompletionRequested(var taskIds, bool completed)
    signal bulkTaskDeleteRequested(var taskIds)
    signal bulkTaskMoveRequested(var taskIds, string taskListId)
    signal bulkTaskDueRequested(var taskIds, string dueAt)
    signal bulkTaskClearDueRequested(var taskIds)
    signal bulkTaskPriorityRequested(var taskIds, int priority)
    signal bulkTaskReparentRequested(var taskIds, string parentTaskId)
    signal bulkTaskTextPreviewRequested(var taskIds, string findText, int fields, int recurrenceScope,
                                        int requestToken)
    signal bulkTaskTextReplaceRequested(var taskIds, string findText, string replaceText, int fields,
                                        int recurrenceScope)

    function selectTask(taskId) {
        taskSelected(taskId)
    }

    function requestTaskCreate() {
        taskCreateRequested()
    }

    function requestSubtaskCreate(parentTaskId, taskListId) {
        taskSubtaskCreateRequested(parentTaskId, taskListId)
    }

    function requestTaskEdit(taskId, title, notes, dueAt, dueTimeZone, priority, managedRecurrence,
                             recurrenceSummary, recurrenceFrequency, recurrenceInterval,
                             recurrenceEndKind, recurrenceEndUntil, recurrenceEndCount,
                             recurrenceRule, recurrenceExclusionDates, recurrenceAdditionDates) {
        taskEditRequested(taskId, title, notes, dueAt, dueTimeZone, priority, managedRecurrence,
                          recurrenceSummary, recurrenceFrequency, recurrenceInterval,
                          recurrenceEndKind, recurrenceEndUntil, recurrenceEndCount,
                          recurrenceRule, recurrenceExclusionDates, recurrenceAdditionDates)
    }

    function requestTaskCompletion(taskId, completed) {
        taskCompletionRequested(taskId, completed)
    }

    function requestTaskDelete(taskId, taskTitle, managedRecurrence) {
        taskDeleteRequested(taskId, taskTitle, managedRecurrence)
    }

    function requestTaskMove(taskId, taskListId, taskTitle) {
        taskMoveRequested(taskId, taskListId, taskTitle)
    }

    function requestTaskReparent(taskId, parentTaskId) {
        taskReparentRequested(taskId, parentTaskId)
    }

    function requestTaskReorder(taskId, earlier) {
        taskReorderRequested(taskId, earlier)
    }

    function isTaskSelected(taskId) {
        return selectedTaskIds.indexOf(taskId) >= 0
    }

    function setTaskSelected(taskId, selected) {
        const next = selectedTaskIds.slice()
        const index = next.indexOf(taskId)
        if (selected && index < 0) {
            next.push(taskId)
        } else if (!selected && index >= 0) {
            next.splice(index, 1)
        }
        selectedTaskIds = next
    }

    function selectAllTasks() {
        if (taskModel !== null && typeof taskModel.taskIds === "function") {
            selectedTaskIds = taskModel.taskIds()
        }
    }

    function clearTaskSelection() {
        selectedTaskIds = []
    }

    Shortcut {
        sequence: "Ctrl+A"
        autoRepeat: false
        enabled: root.visible
        onActivated: root.selectAllTasks()
    }

    Connections {
        target: root.taskModel
        function onModelReset() {
            root.clearTaskSelection()
        }
    }

    ColumnLayout {
        anchors.fill: parent
        spacing: Theme.spacingMedium

        RowLayout {
            Layout.fillWidth: true

            Label {
                text: "Inbox"
                font.pixelSize: Theme.titleFontSize
                Accessible.role: Accessible.Heading
                Accessible.name: text
            }

            Item { Layout.fillWidth: true }

            Button {
                id: taskCreateButton
                text: "New task"
                Accessible.name: text
                Accessible.description: "Create a task in an active task list"
                onClicked: root.requestTaskCreate()
            }

            Button {
                id: importButton
                text: "Import"
                Accessible.name: "Import Tasks and events"
                enabled: !root.taskListLoading
                onClicked: root.importRequested()
            }

            Button {
                id: bulkSelectAllButton
                text: "Select all"
                Accessible.name: "Select all tasks in current view"
                enabled: !root.taskListLoading && root.taskModel !== null
                onClicked: root.selectAllTasks()
            }
        }

        TaskListControls {
            id: taskListControls
            Layout.fillWidth: true
            taskListModel: root.taskListModel
            loading: root.taskListLoading
            errorMessage: root.taskListErrorMessage
            onTaskListCreateRequested: root.taskListCreateRequested()
            onTaskListRenameRequested: function(taskListId, title) {
                root.taskListRenameRequested(taskListId, title)
            }
            onTaskListDeleteRequested: function(taskListId, title, taskCount, taskTitles) {
                root.taskListDeleteRequested(taskListId, title, taskCount, taskTitles)
            }
            onTaskListSelectionRequested: function(taskListId, selected) {
                root.taskListSelectionRequested(taskListId, selected)
            }
        }

        Flow {
            Layout.fillWidth: true
            spacing: Theme.spacingSmall
            visible: selectedTaskIds.length > 0

            Label {
                id: bulkSelectionStatus
                text: selectedTaskIds.length + " selected · eligibility checked before queueing"
                color: Theme.textSecondary
                Accessible.name: text
            }

            Button {
                text: "Select all again"
                Accessible.name: "Select all tasks in current view"
                enabled: !root.taskListLoading
                onClicked: root.selectAllTasks()
            }

            Button {
                text: "Clear selection"
                Accessible.name: text
                enabled: !root.taskListLoading
                onClicked: root.clearTaskSelection()
            }

            Button {
                id: bulkCompleteButton
                text: "Complete"
                Accessible.name: text + " " + root.selectedTaskIds.length + " tasks"
                enabled: !root.taskListLoading
                onClicked: root.bulkTaskCompletionRequested(selectedTaskIds, true)
            }

            Button {
                text: "Reopen"
                Accessible.name: text + " " + selectedTaskIds.length + " tasks"
                enabled: !root.taskListLoading
                onClicked: root.bulkTaskCompletionRequested(selectedTaskIds, false)
            }

            Button {
                id: bulkDeleteButton
                text: "Delete"
                Accessible.name: text + " " + selectedTaskIds.length + " tasks"
                enabled: !root.taskListLoading
                onClicked: bulkDeleteDialog.openForDelete(selectedTaskIds)
            }

            Button {
                text: "Move"
                Accessible.name: text + " " + selectedTaskIds.length + " tasks"
                enabled: !root.taskListLoading
                onClicked: bulkMoveDialog.openForMove(selectedTaskIds)
            }

            Button {
                text: "Set due"
                Accessible.name: text + " for " + selectedTaskIds.length + " tasks"
                enabled: !root.taskListLoading
                onClicked: bulkEditDialog.openForDue(selectedTaskIds)
            }

            Button {
                text: "Clear due"
                Accessible.name: text + " for " + selectedTaskIds.length + " tasks"
                enabled: !root.taskListLoading
                onClicked: root.bulkTaskClearDueRequested(selectedTaskIds)
            }

            Button {
                text: "Set priority"
                Accessible.name: text + " for " + selectedTaskIds.length + " tasks"
                enabled: !root.taskListLoading
                onClicked: bulkEditDialog.openForPriority(selectedTaskIds)
            }

            Button {
                text: "Reparent"
                Accessible.name: text + " " + selectedTaskIds.length + " tasks"
                enabled: !root.taskListLoading
                onClicked: bulkEditDialog.openForReparent(selectedTaskIds)
            }

            Button {
                text: "Find and replace"
                Accessible.name: text + " " + selectedTaskIds.length + " tasks"
                enabled: !root.taskListLoading
                onClicked: bulkTextReplaceDialog.openFor(root.selectedTaskIds,
                                                         root.bulkTextRecurrenceScope)
            }
        }

        Label {
            Layout.fillWidth: true
            visible: bulkTaskStatusMessage.length > 0
            text: bulkTaskStatusMessage
            color: Theme.textSecondary
            wrapMode: Text.WordWrap
            Accessible.name: text
        }

        TreeView {
            id: taskRows
            Layout.fillWidth: true
            Layout.fillHeight: true
            clip: true
            model: root.taskModel
            reuseItems: true
            columnWidthProvider: function() { return width }

            delegate: Item {
                implicitWidth: taskRows.width
                implicitHeight: taskRow.implicitHeight
                required property TreeView treeView
                required property bool expanded
                required property bool hasChildren
                required property bool isTreeNode
                required property int column
                required property int depth
                required property int row
                required property string id
                required property string taskListId
                required property string title
                required property string notes
                required property string dueAt
                required property string dueTimeZone
                required property int priority
                required property bool completed
                required property bool managedRecurrence
                required property string recurrenceSummary
                required property int recurrenceFrequency
                required property int recurrenceInterval
                required property int recurrenceEndKind
                required property string recurrenceEndUntil
                required property int recurrenceEndCount
                property string recurrenceRule: ""
                property string recurrenceExclusionDates: ""
                property string recurrenceAdditionDates: ""
                property string recurrenceDiagnostic: ""

                property alias completionButton: completionButton
                property alias expandButton: expandButton
                property alias deleteButton: deleteButton
                property alias editButton: editButton
                property alias moveButton: moveButton
                property alias promoteButton: promoteButton
                property alias subtaskButton: subtaskButton
                property alias moveEarlierButton: moveEarlierButton
                property alias moveLaterButton: moveLaterButton

                ColumnLayout {
                    id: taskRow
                    anchors.fill: parent
                    anchors.leftMargin: depth * Theme.spacingLarge
                    spacing: Theme.spacingSmall

                    RowLayout {
                        Layout.fillWidth: true

                        CheckBox {
                            id: taskSelectionCheck
                            checked: root.isTaskSelected(id)
                            Accessible.name: "Select " + title
                            onToggled: root.setTaskSelected(id, checked)
                        }

                        Button {
                            id: expandButton
                            visible: isTreeNode && hasChildren
                            text: expanded ? "Collapse" : "Expand"
                            Accessible.name: text + " subtasks for " + title
                            onClicked: treeView.toggleExpanded(row)
                        }

                        Item {
                            Layout.preferredWidth: !expandButton.visible ? expandButton.implicitWidth : 0
                            Layout.preferredHeight: 1
                        }

                        Button {
                            id: completionButton
                            text: completed ? "Reopen" : "Complete"
                            Accessible.name: text + " " + title
                            Accessible.description: completed ? "Mark task active" : "Mark task completed"
                            onClicked: root.requestTaskCompletion(id, !completed)
                        }

                        Button {
                            id: deleteButton
                            text: "Delete"
                            Accessible.name: text + " " + title
                            Accessible.description: "Delete this task"
                            onClicked: root.requestTaskDelete(id, title, managedRecurrence)
                        }

                        Button {
                            id: editButton
                            text: "Edit"
                            Accessible.name: text + " " + title
                            Accessible.description: "Edit this task"
                            onClicked: root.requestTaskEdit(id, title, notes, dueAt, dueTimeZone, priority,
                                                            managedRecurrence, recurrenceSummary,
                                                            recurrenceFrequency, recurrenceInterval,
                                                            recurrenceEndKind, recurrenceEndUntil,
                                                            recurrenceEndCount, recurrenceRule,
                                                            recurrenceExclusionDates,
                                                            recurrenceAdditionDates)
                        }

                        Button {
                            id: moveButton
                            text: "Move"
                            Accessible.name: text + " " + title
                            Accessible.description: "Move this task to another task list"
                            onClicked: root.requestTaskMove(id, taskListId, title)
                        }

                        Button {
                            id: subtaskButton
                            visible: depth === 0
                            text: "Add subtask"
                            Accessible.name: text + " to " + title
                            onClicked: root.requestSubtaskCreate(id, taskListId)
                        }

                        Button {
                            id: promoteButton
                            visible: depth > 0
                            text: "Promote"
                            Accessible.name: text + " " + title
                            Accessible.description: "Move this subtask to the top level"
                            onClicked: root.requestTaskReparent(id, "")
                        }

                        Button {
                            id: moveEarlierButton
                            text: "Move earlier"
                            Accessible.name: text + " " + title
                            Accessible.description: "Move this task earlier among its siblings"
                            onClicked: root.requestTaskReorder(id, true)
                        }

                        Button {
                            id: moveLaterButton
                            text: "Move later"
                            Accessible.name: text + " " + title
                            Accessible.description: "Move this task later among its siblings"
                            onClicked: root.requestTaskReorder(id, false)
                        }

                        AccessibleButton {
                            Layout.fillWidth: true
                            text: (completed ? "✓ " : "") + title
                            accessibleName: title
                            accessibleDescription: completed ? "Completed task" : "Open task"
                            onClicked: root.selectTask(id)
                        }
                    }

                    Label {
                        Layout.fillWidth: true
                        visible: managedRecurrence
                        text: recurrenceSummary
                        color: Theme.textSecondary
                        wrapMode: Text.WordWrap
                        Accessible.name: "Task recurrence: " + recurrenceSummary
                    }

                    Label {
                        Layout.fillWidth: true
                        visible: recurrenceDiagnostic.length > 0
                        text: recurrenceDiagnostic
                        color: Theme.destructive
                        wrapMode: Text.WordWrap
                        Accessible.name: "Task recurrence warning: " + recurrenceDiagnostic
                    }
                }
            }
        }

        Label {
            Layout.fillWidth: true
            visible: taskRows.rows === 0
            text: "Your inbox is clear."
            color: Theme.textSecondary
            horizontalAlignment: Text.AlignHCenter
        }
    }

    TaskBulkDeleteDialog {
        id: bulkDeleteDialog
        parent: Overlay.overlay
        onBulkDeleteRequested: function(taskIds) {
            root.bulkTaskDeleteRequested(taskIds)
        }
    }

    TaskBulkMoveDialog {
        id: bulkMoveDialog
        parent: Overlay.overlay
        taskListModel: root.taskListModel
        onBulkMoveRequested: function(taskIds, taskListId) {
            root.bulkTaskMoveRequested(taskIds, taskListId)
        }
    }

    TaskBulkEditDialog {
        id: bulkEditDialog
        parent: Overlay.overlay
        taskModel: root.taskModel
        onBulkDueRequested: function(taskIds, dueAt) {
            root.bulkTaskDueRequested(taskIds, dueAt)
        }
        onBulkPriorityRequested: function(taskIds, priority) {
            root.bulkTaskPriorityRequested(taskIds, priority)
        }
        onBulkReparentRequested: function(taskIds, parentTaskId) {
            root.bulkTaskReparentRequested(taskIds, parentTaskId)
        }
    }

    BulkTextReplaceDialog {
        id: bulkTextReplaceDialog
        parent: Overlay.overlay
        kind: "task"
        previewMessage: root.bulkTaskPreviewMessage
        previewResultRequestToken: root.bulkTaskPreviewRequestToken
        onPreviewRequested: function(taskIds, findText, fields, recurrenceScope, requestToken) {
            root.bulkTaskTextPreviewRequested(taskIds, findText, fields, recurrenceScope, requestToken)
        }
        onReplaceRequested: function(taskIds, findText, replaceText, fields, recurrenceScope) {
            root.bulkTaskTextReplaceRequested(taskIds, findText, replaceText, fields, recurrenceScope)
        }
    }
}
