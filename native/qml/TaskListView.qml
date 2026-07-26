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
    signal taskCompletionRequested(string taskId, bool completed)
    signal taskDeleteRequested(string taskId, string taskTitle)
    signal taskMoveRequested(string taskId, string taskListId, string taskTitle)

    function selectTask(taskId) {
        taskSelected(taskId)
    }

    function requestTaskCreate() {
        taskCreateRequested()
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

        ListView {
            id: taskRows
            Layout.fillWidth: true
            Layout.fillHeight: true
            clip: true
            model: root.taskModel
            spacing: Theme.spacingSmall
            cacheBuffer: height
            reuseItems: true

            delegate: RowLayout {
                required property string id
                required property string taskListId
                required property string title
                required property bool completed
                width: ListView.view.width
                spacing: Theme.spacingSmall

                property alias completionButton: completionButton
                property alias deleteButton: deleteButton
                property alias moveButton: moveButton

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
                    id: moveButton
                    text: "Move"
                    Accessible.name: text + " " + title
                    Accessible.description: "Move this task to another task list"
                    onClicked: root.requestTaskMove(id, taskListId, title)
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

        Label {
            Layout.fillWidth: true
            visible: taskRows.count === 0
            text: "Your inbox is clear."
            color: Theme.textSecondary
            horizontalAlignment: Text.AlignHCenter
        }
    }
}
