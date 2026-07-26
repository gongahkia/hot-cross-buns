import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

HcbDialog {
    id: root
    title: "Edit task"
    primaryText: "Save task"
    primaryEnabled: taskId.length > 0 && titleField.text.trim().length > 0
    property string taskId: ""
    property string taskDueTimeZone: ""
    property int taskPriority: 0
    property alias taskTitle: titleField.text
    property alias taskNotes: notesField.text
    property alias taskDueAt: dueField.text
    property alias taskPriorityPicker: priorityPicker
    property alias taskTitleField: titleField
    signal taskUpdateRequested(string taskId, string title, string notes, string dueAt,
                               string dueTimeZone, int priority)

    function openForEdit(taskId, title, notes, dueAt, dueTimeZone, priority) {
        root.taskId = taskId
        titleField.text = title
        notesField.text = notes
        dueField.text = dueAt
        root.taskDueTimeZone = dueTimeZone
        priorityPicker.currentIndex = priorityPicker.indexOfValue(priority)
        root.taskPriority = priorityPicker.currentValue
        open()
    }

    onOpened: titleField.forceActiveFocus()
    onPrimaryAction: taskUpdateRequested(taskId, titleField.text.trim(), notesField.text,
                                         dueField.text.trim(), dueField.text.trim().length > 0
                                         ? taskDueTimeZone : "", taskPriority)

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

    TextArea {
        id: notesField
        Layout.fillWidth: true
        Layout.preferredHeight: 120
        placeholderText: "Notes"
        Accessible.name: "Task notes"
        selectByMouse: true
        wrapMode: TextEdit.Wrap
    }

    TextField {
        id: dueField
        Layout.fillWidth: true
        placeholderText: "Due date (YYYY-MM-DD)"
        Accessible.name: "Task due date"
        selectByMouse: true
    }

    ComboBox {
        id: priorityPicker
        Layout.fillWidth: true
        model: [
            { label: "No priority", value: 0 },
            { label: "Low priority", value: 1 },
            { label: "Medium priority", value: 2 },
            { label: "High priority", value: 3 }
        ]
        textRole: "label"
        valueRole: "value"
        Accessible.name: "Task priority"
        onCurrentValueChanged: root.taskPriority = currentValue
    }
}
