import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

HcbDialog {
    id: root
    title: "Quick Capture"
    primaryText: "Add task"
    primaryEnabled: titleField.text.trim().length > 0
    property alias taskTitle: titleField.text
    property alias taskTitleField: titleField
    signal taskRequested(string title)

    onOpened: {
        titleField.clear()
        titleField.forceActiveFocus()
    }
    onPrimaryAction: taskRequested(titleField.text.trim())

    Label {
        text: "Capture a task without leaving your current page."
        wrapMode: Text.WordWrap
        Layout.fillWidth: true
        color: Theme.textSecondary
    }

    TextField {
        id: titleField
        Layout.fillWidth: true
        placeholderText: "What needs to be done?"
        Accessible.name: "Task title"
        selectByMouse: true
        Keys.onReturnPressed: {
            if (root.primaryEnabled) {
                root.primaryButton.click()
            }
        }
    }
}
