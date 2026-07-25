import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Pane {
    id: root
    property var agendaModel: null
    property var calendarVisibility: null
    property alias eventRows: eventRows
    signal eventSelected(string eventId)

    function scheduleLabel(startAt, allDay) {
        return allDay ? "All day" : startAt
    }

    function selectEvent(eventId) {
        eventSelected(eventId)
    }

    function isCalendarVisible(calendarId) {
        return calendarVisibility === null || calendarVisibility.isVisible(calendarId)
    }

    ColumnLayout {
        anchors.fill: parent
        spacing: Theme.spacingMedium

        Label {
            text: "Agenda"
            font.pixelSize: Theme.titleFontSize
            Accessible.role: Accessible.Heading
            Accessible.name: text
        }

        ListView {
            id: eventRows
            Layout.fillWidth: true
            Layout.fillHeight: true
            clip: true
            model: root.agendaModel
            spacing: Theme.spacingSmall

            delegate: AccessibleButton {
                required property string id
                required property string calendarId
                required property string title
                required property string startAt
                required property bool allDay
                width: ListView.view.width
                visible: root.isCalendarVisible(calendarId)
                height: visible ? implicitHeight : 0
                enabled: visible
                text: title + "\n" + root.scheduleLabel(startAt, allDay)
                accessibleName: title
                accessibleDescription: root.scheduleLabel(startAt, allDay) + ". Calendar " + calendarId
                onClicked: root.selectEvent(id)
            }
        }

        Label {
            Layout.fillWidth: true
            visible: eventRows.count === 0
            text: "No upcoming events."
            color: Theme.textSecondary
            horizontalAlignment: Text.AlignHCenter
        }
    }
}
