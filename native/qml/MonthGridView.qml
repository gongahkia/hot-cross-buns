import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Pane {
    id: root
    property var monthGridModel: null
    property var calendarVisibility: null
    property var selectedEventIds: []
    property bool selectionMode: false
    property int weekStartDay: 0
    property string monthLabel: ""
    property alias cells: cells
    signal dateSelected(string date)
    signal eventSelectionRequested(string eventId, bool selected)
    signal eventCreateRequested(string date)
    signal eventEditRequested(var event)

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

    function visibleEvents(events) {
        return events.filter(function(event) { return root.isCalendarVisible(event.calendarId) })
    }

    function isEventSelected(eventId) {
        return selectedEventIds.indexOf(eventId) >= 0
    }

    function eventColor(calendarId, colorId) {
        const fallback = calendarVisibility !== null && typeof calendarVisibility.calendarColor === "function"
                       ? calendarVisibility.calendarColor(calendarId) : Theme.calendarFallback
        return Theme.calendarColor(colorId, fallback)
    }

    function isContinuation(event, date) {
        return event.allDay === true && typeof event.startAt === "string" &&
               event.startAt.slice(0, 10) !== date
    }

    ColumnLayout {
        anchors.fill: parent
        spacing: Theme.spacingMedium

        Label {
            text: root.monthLabel.length > 0 ? root.monthLabel : "Month"
            font.pixelSize: Theme.titleFontSize
            Accessible.role: Accessible.Heading
            Accessible.name: text
        }

        RowLayout {
            Layout.fillWidth: true

            Repeater {
                model: root.weekStartDay === 1
                       ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
                       : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

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

            delegate: Item {
                required property string date
                required property int day
                required property bool outsideMonth
                required property var events
                implicitWidth: 100
                implicitHeight: 72
                opacity: outsideMonth ? 0.5 : 1

                Row {
                    id: cellActions
                    anchors.top: parent.top
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.margins: Theme.spacingSmall
                    spacing: Theme.spacingSmall

                    AccessibleButton {
                        width: 28
                        height: 24
                        padding: 0
                        text: day
                        accessibleName: date
                        accessibleDescription: events.length === 0 ? "No events" : root.eventSummary(events)
                        onClicked: root.selectDate(date)
                        background: Item {}
                    }
                }

                Column {
                    anchors.top: cellActions.bottom
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.bottom: parent.bottom
                    anchors.margins: Theme.spacingSmall
                    spacing: 1
                    clip: true

                    Repeater {
                        model: root.visibleEvents(events).slice(0, 3)

                        delegate: CalendarEventButton {
                            required property var modelData
                            width: parent.width
                            height: 22
                            padding: 2
                            compact: true
                            eventColor: root.eventColor(modelData.calendarId, modelData.colorId || "")
                            text: root.isContinuation(modelData, date) ? "↳" : modelData.title
                            accessibleName: modelData.title
                            accessibleDescription: "Edit event on " + date
                            onClicked: {
                                if (root.selectionMode) {
                                    root.eventSelectionRequested(modelData.id,
                                                                 !root.isEventSelected(modelData.id))
                                } else {
                                    root.eventEditRequested(modelData)
                                }
                            }
                        }
                    }

                    AccessibleButton {
                        id: moreEventsButton
                        property var visibleEventRows: root.visibleEvents(events)
                        width: parent.width
                        height: 22
                        padding: 2
                        visible: visibleEventRows.length > 3
                        text: "+" + (visibleEventRows.length - 3) + " more"
                        accessibleName: "More events on " + date
                        onClicked: overflowMenu.open()

                        Menu {
                            id: overflowMenu

                            MenuItem {
                                text: "New event"
                                onTriggered: root.eventCreateRequested(date)
                            }

                            Repeater {
                                model: moreEventsButton.visibleEventRows.slice(3)

                                delegate: MenuItem {
                                    required property var modelData
                                    text: modelData.title
                                    onTriggered: root.eventEditRequested(modelData)
                                }
                            }
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
