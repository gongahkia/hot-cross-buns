import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Pane {
    id: root
    property var notesModel: null
    property alias noteRows: noteRows
    signal noteSelected(string noteId)

    function selectNote(noteId) {
        noteSelected(noteId)
    }

    ColumnLayout {
        anchors.fill: parent
        spacing: Theme.spacingMedium

        Label {
            text: "Notes"
            font.pixelSize: Theme.titleFontSize
            Accessible.role: Accessible.Heading
            Accessible.name: text
        }

        ListView {
            id: noteRows
            Layout.fillWidth: true
            Layout.fillHeight: true
            clip: true
            model: root.notesModel
            spacing: Theme.spacingSmall

            delegate: AccessibleButton {
                required property string id
                required property string taskListTitle
                required property string title
                required property string body
                width: ListView.view.width
                text: title + "\n" + taskListTitle + " — " + body
                accessibleName: title
                accessibleDescription: taskListTitle + ". " + body
                onClicked: root.selectNote(id)
            }
        }

        Label {
            Layout.fillWidth: true
            visible: noteRows.count === 0
            text: "No notes yet."
            color: Theme.textSecondary
            horizontalAlignment: Text.AlignHCenter
        }
    }
}
