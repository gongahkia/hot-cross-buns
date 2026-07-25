import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

HcbDialog {
    id: root
    title: "Edit note"
    primaryText: "Save note"
    primaryEnabled: noteId.length > 0 && titleField.text.trim().length > 0
    property string noteId: ""
    property alias noteTitle: titleField.text
    property alias noteBody: bodyField.text
    property alias noteTitleField: titleField
    signal noteSaveRequested(string noteId, string title, string body)

    onOpened: titleField.forceActiveFocus()
    onPrimaryAction: noteSaveRequested(noteId, titleField.text.trim(), bodyField.text)

    TextField {
        id: titleField
        Layout.fillWidth: true
        placeholderText: "Note title"
        Accessible.name: "Note title"
        selectByMouse: true
        Keys.onReturnPressed: {
            if (root.primaryEnabled) {
                root.primaryButton.click()
            }
        }
    }

    TextArea {
        id: bodyField
        Layout.fillWidth: true
        Layout.preferredHeight: 240
        placeholderText: "Write your note"
        Accessible.name: "Note body"
        selectByMouse: true
        wrapMode: TextEdit.Wrap
    }
}
