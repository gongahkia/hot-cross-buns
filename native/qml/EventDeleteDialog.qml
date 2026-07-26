import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

HcbDialog {
    id: root
    title: "Delete event"
    primaryText: "Delete event"
    primaryDestructive: true
    primaryEnabled: eventId.length > 0
    property string eventId: ""
    property string eventTitle: ""
    signal eventDeleteRequested(string eventId)

    function openForDelete(eventId, eventTitle) {
        root.eventId = eventId
        root.eventTitle = eventTitle
        open()
    }

    onPrimaryAction: eventDeleteRequested(eventId)

    Label {
        Layout.fillWidth: true
        text: eventTitle.length > 0 ? "Delete \"" + eventTitle + "\"?" : "Delete this event?"
        wrapMode: Text.WordWrap
        Accessible.name: text
    }
}
