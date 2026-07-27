import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

HcbDialog {
    id: root
    title: "Edit task"
    primaryText: "Save task"
    primaryEnabled: taskId.length > 0 && titleField.text.trim().length > 0 && recurrenceInputValid()
    property string taskId: ""
    property string taskDueTimeZone: ""
    property int taskPriority: 0
    property bool taskManagedRecurrence: false
    property string taskRecurrenceSummary: ""
    property alias taskTitle: titleField.text
    property alias taskNotes: notesField.text
    property alias taskDueAt: dueField.text
    property alias taskPriorityPicker: priorityPicker
    property alias taskTitleField: titleField
    signal taskUpdateRequested(string taskId, string title, string notes, string dueAt,
                               string dueTimeZone, int priority, bool managedRecurrence,
                               int recurrenceFrequency, int recurrenceInterval, int recurrenceEndKind,
                               string recurrenceEndUntil, int recurrenceEndCount)
    signal taskRecurrenceActionRequested(string taskId, string title, int action)

    function recurrenceInputValid() {
        if (!taskManagedRecurrence) return true
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

    function openForEdit(taskId, title, notes, dueAt, dueTimeZone, priority, managedRecurrence,
                         recurrenceSummary, recurrenceFrequency, recurrenceInterval,
                         recurrenceEndKind, recurrenceEndUntil, recurrenceEndCount) {
        root.taskId = taskId
        titleField.text = title
        notesField.text = notes
        dueField.text = dueAt
        root.taskDueTimeZone = dueTimeZone
        priorityPicker.currentIndex = priorityPicker.indexOfValue(priority)
        root.taskPriority = priorityPicker.currentValue
        root.taskManagedRecurrence = managedRecurrence === true
        root.taskRecurrenceSummary = recurrenceSummary || ""
        frequencyPicker.currentIndex = Math.max(0, frequencyPicker.indexOfValue(
                                                    typeof recurrenceFrequency === "number"
                                                    ? recurrenceFrequency : 0))
        intervalField.text = String(recurrenceInterval > 0 ? recurrenceInterval : 1)
        endPicker.currentIndex = Math.max(0, endPicker.indexOfValue(
                                              typeof recurrenceEndKind === "number"
                                              ? recurrenceEndKind : 0))
        untilField.text = recurrenceEndUntil || ""
        countField.text = String(recurrenceEndCount > 0 ? recurrenceEndCount : 1)
        open()
    }

    onOpened: titleField.forceActiveFocus()
    onPrimaryAction: taskUpdateRequested(taskId, titleField.text.trim(), notesField.text,
                                         dueField.text.trim(), dueField.text.trim().length > 0
                                         ? taskDueTimeZone : "", taskPriority, taskManagedRecurrence,
                                         frequencyPicker.currentValue, Number(intervalField.text),
                                         endPicker.currentValue, untilField.text.trim(), Number(countField.text))

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

    Label {
        Layout.fillWidth: true
        visible: taskManagedRecurrence
        text: taskRecurrenceSummary
        color: Theme.textSecondary
        wrapMode: Text.WordWrap
        Accessible.name: "Task recurrence: " + text
    }

    ComboBox {
        id: frequencyPicker
        Layout.fillWidth: true
        visible: taskManagedRecurrence
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
        visible: taskManagedRecurrence
        placeholderText: "Repeat interval"
        inputMethodHints: Qt.ImhDigitsOnly
        Accessible.name: "Task repeat interval"
        selectByMouse: true
    }

    ComboBox {
        id: endPicker
        Layout.fillWidth: true
        visible: taskManagedRecurrence
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
        visible: taskManagedRecurrence && endPicker.currentValue === 1
        placeholderText: "End date (YYYY-MM-DD)"
        Accessible.name: "Task repeat end date"
        selectByMouse: true
    }

    TextField {
        id: countField
        Layout.fillWidth: true
        visible: taskManagedRecurrence && endPicker.currentValue === 2
        placeholderText: "Number of occurrences"
        inputMethodHints: Qt.ImhDigitsOnly
        Accessible.name: "Task repeat occurrence count"
        selectByMouse: true
    }

    RowLayout {
        Layout.fillWidth: true
        visible: taskManagedRecurrence

        Button {
            text: "Stop repeating"
            Accessible.name: text
            onClicked: {
                root.close()
                root.taskRecurrenceActionRequested(root.taskId, titleField.text, 0)
            }
        }

        Button {
            text: "New series from here"
            Accessible.name: text
            onClicked: {
                root.close()
                root.taskRecurrenceActionRequested(root.taskId, titleField.text, 1)
            }
        }
    }
}
