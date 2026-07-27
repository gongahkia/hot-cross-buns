import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Pane {
    id: root
    property var agendaModel: null
    property var calendarVisibility: null
    property var selectedEventIds: []
    property alias eventRows: eventRows
    signal eventSelected(string eventId)
    signal eventSelectionRequested(string eventId, bool selected)
    signal eventEditRequested(string eventId, string calendarId, string title, string startAt,
                              string endAt, bool allDay, string description, string location,
                              string startTimeZone, string colorId, string transparency,
                              string visibility, string attendeeEmailsJson, string remindersJson,
                              bool remindersUseDefault, string recurrenceRule,
                              string recurringRemoteId, string originalStartAt, string eventType,
                              string conferenceJson, string attachmentsJson,
                              string guestPermissionsJson, string statusPropertiesJson)

    function scheduleLabel(startAt, allDay) {
        return allDay ? "All day" : startAt
    }

    function selectEvent(eventId) {
        eventSelected(eventId)
    }

    function requestEdit(eventId, calendarId, title, startAt, endAt, allDay, description, location,
                         startTimeZone, colorId, transparency, visibility, attendeeEmailsJson,
                         remindersJson, remindersUseDefault, recurrenceRule, recurringRemoteId,
                         originalStartAt, eventType, conferenceJson, attachmentsJson,
                         guestPermissionsJson, statusPropertiesJson) {
        eventEditRequested(eventId, calendarId, title, startAt, endAt, allDay, description, location,
                           startTimeZone, colorId, transparency, visibility, attendeeEmailsJson,
                           remindersJson, remindersUseDefault, recurrenceRule, recurringRemoteId,
                           originalStartAt, eventType, conferenceJson, attachmentsJson,
                           guestPermissionsJson, statusPropertiesJson)
    }

    function isCalendarVisible(calendarId) {
        return calendarVisibility === null || calendarVisibility.isVisible(calendarId)
    }

    function isEventSelected(eventId) {
        return selectedEventIds.indexOf(eventId) >= 0
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
                required property string endAt
                required property bool allDay
                required property string description
                required property string location
                required property string startTimeZone
                required property string colorId
                required property string transparency
                required property string visibility
                required property string attendeeEmailsJson
                required property string remindersJson
                required property bool remindersUseDefault
                required property string recurrenceRule
                required property string recurringRemoteId
                required property string originalStartAt
                property string eventType: "default"
                property string conferenceJson: ""
                property string attachmentsJson: "[]"
                property string guestPermissionsJson: "{}"
                property string statusPropertiesJson: "{}"
                width: ListView.view.width
                visible: root.isCalendarVisible(calendarId)
                height: visible ? implicitHeight : 0
                enabled: visible
                text: title + "\n" + root.scheduleLabel(startAt, allDay)
                accessibleName: title
                accessibleDescription: root.scheduleLabel(startAt, allDay) + ". Calendar " + calendarId
                onClicked: {
                    root.selectEvent(id)
                    root.requestEdit(id, calendarId, title, startAt, endAt, allDay, description, location,
                                     startTimeZone, colorId, transparency, visibility,
                                     attendeeEmailsJson, remindersJson, remindersUseDefault,
                                     recurrenceRule, recurringRemoteId, originalStartAt, eventType,
                                     conferenceJson, attachmentsJson, guestPermissionsJson,
                                     statusPropertiesJson)
                }

                CheckBox {
                    anchors.top: parent.top
                    anchors.right: parent.right
                    anchors.margins: Theme.spacingSmall
                    z: 1
                    checked: root.isEventSelected(id)
                    Accessible.name: "Select " + title
                    Accessible.description: checked ? "Event selected" : "Event not selected"
                    onClicked: root.eventSelectionRequested(id, checked)
                }
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
