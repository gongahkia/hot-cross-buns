import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

HcbDialog {
    id: root
    title: "Delete task"
    primaryText: "Delete task"
    primaryDestructive: true
    primaryEnabled: taskId.length > 0
    property string taskId: ""
    property string taskTitle: ""
    signal taskDeleteRequested(string taskId)

    function openForDelete(taskId, taskTitle) {
        root.taskId = taskId
        root.taskTitle = taskTitle
        open()
    }

    onPrimaryAction: taskDeleteRequested(taskId)

    Label {
        Layout.fillWidth: true
        text: taskTitle.length > 0 ? "Delete \"" + taskTitle + "\"?" : "Delete this task?"
        wrapMode: Text.WordWrap
        Accessible.name: text
    }
}
