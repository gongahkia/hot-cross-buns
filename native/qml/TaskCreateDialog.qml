import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

HcbDialog {
    id: root
    title: "New task"
    primaryText: "Create task"
    primaryEnabled: taskListId.length > 0 && titleField.text.trim().length > 0
    property var taskListModel: null
    property string taskListId: ""
    property string parentTaskId: ""
    property alias taskTitle: titleField.text
    property alias taskListPicker: taskListPicker
    property alias taskTitleField: titleField
    signal taskCreateRequested(string taskListId, string parentTaskId, string title)

    function openForCreate(initialTaskListId, initialParentTaskId) {
        titleField.clear()
        taskListPicker.currentIndex = taskListPicker.indexOfValue(initialTaskListId || "")
        taskListId = taskListPicker.currentValue || ""
        parentTaskId = initialParentTaskId || ""
        open()
    }

    onOpened: titleField.forceActiveFocus()
    onPrimaryAction: taskCreateRequested(taskListId, parentTaskId, titleField.text.trim())

    TextField {
        id: titleField
        Layout.fillWidth: true
        placeholderText: "Task title"
        Accessible.name: "Task title"
        selectByMouse: true
        Keys.onReturnPressed: {
            if (root.primaryEnabled) {
                root.primaryButton.click()
            }
        }
    }

    ComboBox {
        id: taskListPicker
        Layout.fillWidth: true
        model: root.taskListModel
        textRole: "title"
        valueRole: "id"
        Accessible.name: "Task list"
        onCurrentValueChanged: root.taskListId = currentValue || ""
    }

    Label {
        Layout.fillWidth: true
        visible: taskListPicker.count === 0
        text: "No active task lists are available."
        color: Theme.textSecondary
        horizontalAlignment: Text.AlignHCenter
    }
}
