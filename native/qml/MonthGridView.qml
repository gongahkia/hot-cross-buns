import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Pane {
    id: root
    property var monthGridModel: null
    property var calendarVisibility: null
    property var selectedEventIds: []
    property alias cells: cells
    signal dateSelected(string date)
    signal eventSelectionRequested(string eventId, bool selected)

    function eventSummary(events) {
        const visibleEvents = events.filter(function(event) {
            return root.isCalendarVisible(event.calendarId)
        })
        if (visibleEvents.length === 0) {
            return ""
        }
        return visibleEvents[0].title + (visibleEvents.length > 1 ? " +" + (visibleEvents.length - 1) : "")
    }

    function selectDate(date) {
        dateSelected(date)
    }

    function isCalendarVisible(calendarId) {
        return calendarVisibility === null || calendarVisibility.isVisible(calendarId)
    }

    function eventIds(events) {
        return events.filter(function(event) {
            return root.isCalendarVisible(event.calendarId) && typeof event.id === "string" && event.id.length > 0
        }).map(function(event) { return event.id })
    }

    function isEventSelected(eventId) {
        return selectedEventIds.indexOf(eventId) >= 0
    }

    ColumnLayout {
        anchors.fill: parent
        spacing: Theme.spacingMedium

        Label {
            text: "Month"
            font.pixelSize: Theme.titleFontSize
            Accessible.role: Accessible.Heading
            Accessible.name: text
        }

        RowLayout {
            Layout.fillWidth: true

            Repeater {
                model: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

                delegate: Label {
                    required property string modelData
                    Layout.fillWidth: true
                    text: modelData
                    horizontalAlignment: Text.AlignHCenter
                    Accessible.name: text
                }
            }
        }

        TableView {
            id: cells
            Layout.fillWidth: true
            Layout.fillHeight: true
            clip: true
            columnSpacing: 1
            rowSpacing: 1
            model: root.monthGridModel
            columnWidthProvider: function() {
                return width / 7
            }
            rowHeightProvider: function() {
                return height / 6
            }

            delegate: AccessibleButton {
                required property string date
                required property int day
                required property bool outsideMonth
                required property var events
                implicitWidth: 100
                implicitHeight: 72
                text: day + "\n" + root.eventSummary(events)
                opacity: outsideMonth ? 0.5 : 1
                accessibleName: date
                accessibleDescription: events.length === 0 ? "No events" : root.eventSummary(events)
                onClicked: root.selectDate(date)

                CheckBox {
                    property var selectableEventIds: root.eventIds(events)
                    anchors.top: parent.top
                    anchors.right: parent.right
                    anchors.margins: Theme.spacingSmall
                    z: 1
                    visible: selectableEventIds.length > 0
                    checked: selectableEventIds.length > 0 && selectableEventIds.every(function(eventId) {
                        return root.isEventSelected(eventId)
                    })
                    Accessible.name: "Select events on " + date
                    Accessible.description: checked ? "All visible events selected" : "Visible events not selected"
                    onClicked: {
                        for (let index = 0; index < selectableEventIds.length; ++index) {
                            root.eventSelectionRequested(selectableEventIds[index], checked)
                        }
                    }
                }
            }
        }
    }

    Label {
        anchors.centerIn: parent
        visible: monthGridModel === null || cells.rows === 0
        text: "No month selected."
        color: Theme.textSecondary
    }
}
