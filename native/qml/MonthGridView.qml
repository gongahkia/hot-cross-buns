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
    property int visibleAllDayLanes: 3
    property int allDayLaneHeight: 22
    property alias cells: cells
    signal dateSelected(string date)
    signal eventSelectionRequested(string eventId, bool selected)
    signal eventCreateRequested(string date)
    signal eventEditRequested(var event)
    signal eventDetailRequested(var event)

    function isCalendarVisible(calendarId) {
        return calendarVisibility === null || calendarVisibility.isVisible(calendarId)
    }

    function selectDate(date) {
        dateSelected(date)
    }

    function eventSummary(events) {
        const visible = events.filter(function(event) { return root.isCalendarVisible(event.calendarId) })
        return visible.length === 0 ? "" : visible[0].title + (visible.length > 1 ? " +" + (visible.length - 1) : "")
    }

    function eventIds(events) {
        return events.filter(function(event) {
            return root.isCalendarVisible(event.calendarId) && typeof event.id === "string" && event.id.length > 0
        }).map(function(event) { return event.id })
    }

    function isEventSelected(eventId) {
        return selectedEventIds.indexOf(eventId) >= 0
    }

    function eventColor(calendarId, colorId) {
        const fallback = calendarVisibility !== null && typeof calendarVisibility.calendarColor === "function"
                       ? calendarVisibility.calendarColor(calendarId) : Theme.calendarFallback
        return Theme.calendarColor(colorId, fallback)
    }

    function visibleTimedEvents(events) {
        return events.filter(function(event) {
            return root.isCalendarVisible(event.calendarId) && event.allDay !== true
        })
    }

    function visibleAllDaySpans() {
        const source = monthGridModel !== null && monthGridModel.allDaySpans !== undefined
                     ? monthGridModel.allDaySpans : []
        return source.filter(function(event) {
            return root.isCalendarVisible(event.calendarId) && event.laneIndex < root.visibleAllDayLanes
        })
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
                }
            }
        }

        Item {
            id: gridArea
            Layout.fillWidth: true
            Layout.fillHeight: true

            TableView {
                id: cells
                anchors.fill: parent
                clip: true
                columnSpacing: 1
                rowSpacing: 1
                model: root.monthGridModel
                columnWidthProvider: function() { return width / 7 }
                rowHeightProvider: function() { return height / 6 }

                delegate: Item {
                    required property string date
                    required property int day
                    required property bool outsideMonth
                    required property var events
                    required property int allDayOverflowCount
                    opacity: outsideMonth ? 0.5 : 1

                    AccessibleButton {
                        id: dayButton
                        anchors.top: parent.top
                        anchors.left: parent.left
                        anchors.margins: Theme.spacingSmall
                        width: 30
                        height: 24
                        padding: 0
                        text: day
                        accessibleName: date
                        onClicked: root.dateSelected(date)
                        background: Item {}
                    }

                    Column {
                        anchors.top: parent.top
                        anchors.topMargin: 28 + root.visibleAllDayLanes * root.allDayLaneHeight
                        anchors.left: parent.left
                        anchors.right: parent.right
                        anchors.bottom: parent.bottom
                        anchors.margins: Theme.spacingSmall
                        spacing: 1
                        clip: true

                        Repeater {
                            model: root.visibleTimedEvents(events).slice(0, 2)
                            delegate: CalendarEventButton {
                                required property var modelData
                                width: parent.width
                                height: root.allDayLaneHeight
                                compact: true
                                eventColor: root.eventColor(modelData.calendarId, modelData.colorId || "")
                                text: modelData.title
                                onClicked: {
                                    if (root.selectionMode) root.eventSelectionRequested(modelData.id, !root.isEventSelected(modelData.id))
                                    else root.eventDetailRequested(modelData)
                                }
                            }
                        }

                        AccessibleButton {
                            id: moreButton
                            property var timedEvents: root.visibleTimedEvents(events)
                            property int moreCount: allDayOverflowCount + Math.max(0, timedEvents.length - 2)
                            width: parent.width
                            height: root.allDayLaneHeight
                            visible: moreCount > 0
                            padding: 2
                            text: "+" + moreCount + " more"
                            onClicked: overflowMenu.open()

                            Menu {
                                id: overflowMenu
                                MenuItem { text: "New event"; onTriggered: root.eventCreateRequested(date) }
                                Repeater {
                                    model: moreButton.timedEvents.slice(2)
                                    delegate: MenuItem {
                                        required property var modelData
                                        text: modelData.title
                                        onTriggered: root.eventDetailRequested(modelData)
                                    }
                                }
                            }
                        }
                    }
                }
            }

            Repeater {
                model: root.visibleAllDaySpans()
                delegate: CalendarEventButton {
                    required property var modelData
                    x: modelData.startColumn * gridArea.width / 7 + Theme.spacingSmall
                    y: modelData.weekIndex * gridArea.height / 6 + 28 + modelData.laneIndex * root.allDayLaneHeight
                    width: Math.max(1, modelData.daySpan * gridArea.width / 7 - Theme.spacingSmall * 2)
                    height: root.allDayLaneHeight - 1
                    z: 2
                    compact: true
                    eventColor: root.eventColor(modelData.calendarId, modelData.colorId || "")
                    text: (modelData.startsBeforeRange ? "‹ " : "") + modelData.title +
                          (modelData.endsAfterRange ? " ›" : "")
                    accessibleName: modelData.title
                    onClicked: {
                        if (root.selectionMode) root.eventSelectionRequested(modelData.id, !root.isEventSelected(modelData.id))
                        else root.eventDetailRequested(modelData)
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
