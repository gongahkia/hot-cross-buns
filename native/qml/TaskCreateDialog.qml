import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

HcbDialog {
    id: root
    title: "New task"
    primaryText: "Create task"
    primaryEnabled: taskListId.length > 0 && titleField.text.trim().length > 0 && recurrenceInputValid()
    property var taskListModel: null
    property int taskListRevision: taskListModel !== null && taskListModel.revision !== undefined
                                   ? taskListModel.revision : 0
    property var activeTaskLists: {
        const revision = taskListRevision
        if (taskListModel !== null && typeof taskListModel.selectedTaskLists === "function") {
            return taskListModel.selectedTaskLists()
        }
        return taskListModel
    }
    property string taskListId: ""
    property string parentTaskId: ""
    property alias taskTitle: titleField.text
    property alias taskListPicker: taskListPicker
    property alias taskTitleField: titleField
    property alias taskNotes: notesField.text
    property alias taskDueAt: dueField.text
    property alias managedRecurrenceCheck: recurrenceCheck
    property alias recurrenceFrequencyPicker: frequencyPicker
    property alias recurrenceIntervalField: intervalField
    property alias recurrenceEndPicker: endPicker
    property alias recurrenceEndUntilField: untilField
    property alias recurrenceEndCountField: countField
    signal taskCreateRequested(string taskListId, string parentTaskId, string title, string notes,
                               string dueAt, string dueTimeZone, int priority, bool managedRecurrence,
                               int recurrenceFrequency, int recurrenceInterval, int recurrenceEndKind,
                               string recurrenceEndUntil, int recurrenceEndCount)

    function recurrenceInputValid() {
        if (!recurrenceCheck.checked) return true
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dueField.text.trim())) return false
        const interval = Number(intervalField.text)
        if (!Number.isInteger(interval) || interval < 1 || interval > 1000) return false
        if (endPicker.currentValue === 1) return /^\d{4}-\d{2}-\d{2}$/.test(untilField.text.trim())
        if (endPicker.currentValue === 2) {
            const count = Number(countField.text)
            return Number.isInteger(count) && count >= 1 && count <= 10000
        }
        return true
    }

    function openForCreate(initialTaskListId, initialParentTaskId) {
        titleField.clear()
        notesField.clear()
        dueField.clear()
        timeZoneField.clear()
        priorityPicker.currentIndex = 0
        recurrenceCheck.checked = false
        frequencyPicker.currentIndex = 1
        intervalField.text = "1"
        endPicker.currentIndex = 0
        untilField.clear()
        countField.text = "1"
        taskListPicker.currentIndex = taskListPicker.indexOfValue(initialTaskListId || "")
        if (taskListPicker.currentIndex < 0 && taskListPicker.count > 0) {
            taskListPicker.currentIndex = 0
        }
        taskListId = taskListPicker.currentValue || ""
        parentTaskId = initialParentTaskId || ""
        open()
    }

    onOpened: titleField.forceActiveFocus()
    onPrimaryAction: taskCreateRequested(taskListId, parentTaskId, titleField.text.trim(), notesField.text,
                                         dueField.text.trim(), timeZoneField.text.trim(), priorityPicker.currentValue,
                                         recurrenceCheck.checked, frequencyPicker.currentValue,
                                         Number(intervalField.text), endPicker.currentValue,
                                         untilField.text.trim(), Number(countField.text))

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
        Layout.preferredHeight: 100
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

    TextField {
        id: timeZoneField
        Layout.fillWidth: true
        placeholderText: "Time zone (IANA, optional)"
        Accessible.name: "Task due time zone"
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
    }

    CheckBox {
        id: recurrenceCheck
        text: "Repeat task with HCB"
        enabled: root.parentTaskId.length === 0
        Accessible.name: text
        Accessible.description: enabled ? "Adds a visible HCB recurrence marker to Google Task notes"
                                       : "Subtasks cannot use managed recurrence"
    }

    ComboBox {
        id: frequencyPicker
        Layout.fillWidth: true
        visible: recurrenceCheck.checked
        model: [
            { label: "Daily", value: 0 },
            { label: "Weekly", value: 1 },
            { label: "Monthly", value: 2 },
            { label: "Yearly", value: 3 }
        ]
        textRole: "label"
        valueRole: "value"
        Accessible.name: "Task repeat frequency"
    }

    TextField {
        id: intervalField
        Layout.fillWidth: true
        visible: recurrenceCheck.checked
        placeholderText: "Repeat interval"
        inputMethodHints: Qt.ImhDigitsOnly
        Accessible.name: "Task repeat interval"
        selectByMouse: true
    }

    ComboBox {
        id: endPicker
        Layout.fillWidth: true
        visible: recurrenceCheck.checked
        model: [
            { label: "Never ends", value: 0 },
            { label: "Ends on date", value: 1 },
            { label: "Ends after count", value: 2 }
        ]
        textRole: "label"
        valueRole: "value"
        Accessible.name: "Task repeat end condition"
    }

    TextField {
        id: untilField
        Layout.fillWidth: true
        visible: recurrenceCheck.checked && endPicker.currentValue === 1
        placeholderText: "End date (YYYY-MM-DD)"
        Accessible.name: "Task repeat end date"
        selectByMouse: true
    }

    TextField {
        id: countField
        Layout.fillWidth: true
        visible: recurrenceCheck.checked && endPicker.currentValue === 2
        placeholderText: "Number of occurrences"
        inputMethodHints: Qt.ImhDigitsOnly
        Accessible.name: "Task repeat occurrence count"
        selectByMouse: true
    }

    ComboBox {
        id: taskListPicker
        Layout.fillWidth: true
        model: root.activeTaskLists
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
