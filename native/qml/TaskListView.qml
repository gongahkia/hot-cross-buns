import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Pane {
    id: root
    property var taskModel: null
    property alias taskRows: taskRows
    property alias taskCreateButton: taskCreateButton
    signal taskSelected(string taskId)
    signal taskCreateRequested()
    signal taskSubtaskCreateRequested(string parentTaskId, string taskListId)
    signal taskEditRequested(string taskId, string title, string notes, string dueAt,
                             string dueTimeZone, int priority)
    signal taskCompletionRequested(string taskId, bool completed)
    signal taskDeleteRequested(string taskId, string taskTitle)
    signal taskMoveRequested(string taskId, string taskListId, string taskTitle)
    signal taskReparentRequested(string taskId, string parentTaskId)

    function selectTask(taskId) {
        taskSelected(taskId)
    }

    function requestTaskCreate() {
        taskCreateRequested()
    }

    function requestSubtaskCreate(parentTaskId, taskListId) {
        taskSubtaskCreateRequested(parentTaskId, taskListId)
    }

    function requestTaskEdit(taskId, title, notes, dueAt, dueTimeZone, priority) {
        taskEditRequested(taskId, title, notes, dueAt, dueTimeZone, priority)
    }

    function requestTaskCompletion(taskId, completed) {
        taskCompletionRequested(taskId, completed)
    }

    function requestTaskDelete(taskId, taskTitle) {
        taskDeleteRequested(taskId, taskTitle)
    }

    function requestTaskMove(taskId, taskListId, taskTitle) {
        taskMoveRequested(taskId, taskListId, taskTitle)
    }

    function requestTaskReparent(taskId, parentTaskId) {
        taskReparentRequested(taskId, parentTaskId)
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

                property alias completionButton: completionButton
                property alias expandButton: expandButton
                property alias deleteButton: deleteButton
                property alias editButton: editButton
                property alias moveButton: moveButton
                property alias promoteButton: promoteButton
                property alias subtaskButton: subtaskButton

                RowLayout {
                    id: taskRow
                    anchors.fill: parent
                    anchors.leftMargin: depth * Theme.spacingLarge
                    spacing: Theme.spacingSmall

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
                        onClicked: root.requestTaskDelete(id, title)
                    }

                    Button {
                        id: editButton
                        text: "Edit"
                        Accessible.name: text + " " + title
                        Accessible.description: "Edit this task"
                        onClicked: root.requestTaskEdit(id, title, notes, dueAt, dueTimeZone, priority)
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

                    AccessibleButton {
                        Layout.fillWidth: true
                        text: (completed ? "✓ " : "") + title
                        accessibleName: title
                        accessibleDescription: completed ? "Completed task" : "Open task"
                        onClicked: root.selectTask(id)
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
}
