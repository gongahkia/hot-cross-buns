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
    property string calendarDate: ""
    property var scheduledTasks: []
    property string monthLabel: ""
    property int visibleAllDayLanes: 3
    property int allDayLaneHeight: 22
    property alias cells: cells
    signal dateSelected(string date)
    signal eventSelectionRequested(string eventId, bool selected)
    signal eventCreateRequested(string date)
    signal quickCreateRequested(string startAt, string endAt, bool allDay)
    signal eventEditRequested(var event)
    signal eventDetailRequested(var event)
    signal eventMoveScopeRequested(var event, string startAt, string endAt, bool allDay)
    signal taskMoveRequested(string taskId, string dueDate)
    signal taskDetailRequested(var task)

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

    function localDateString(date) {
        return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" +
               String(date.getDate()).padStart(2, "0")
    }

    function gridStartDate() {
        const month = new Date(calendarDate + "T12:00:00")
        if (!Number.isFinite(month.getTime())) return null
        month.setDate(1)
        const offset = (month.getDay() - weekStartDay + 7) % 7
        month.setDate(month.getDate() - offset)
        return month
    }

    function dateForGridPoint(x, y) {
        const start = gridStartDate()
        if (start === null || gridArea.width <= 0 || gridArea.height <= 0) return ""
        const column = Math.max(0, Math.min(6, Math.floor(x / (gridArea.width / 7))))
        const row = Math.max(0, Math.min(5, Math.floor(y / (gridArea.height / 6))))
        start.setDate(start.getDate() + row * 7 + column)
        return localDateString(start)
    }

    function dayDelta(firstDate, secondDate) {
        const first = new Date(firstDate + "T12:00:00")
        const second = new Date(secondDate + "T12:00:00")
        return Math.round((second - first) / 86400000)
    }

    function shiftDateValue(value, offset, allDay) {
        if (allDay) {
            const date = new Date(value.slice(0, 10) + "T00:00:00Z")
            if (!Number.isFinite(date.getTime())) return ""
            date.setUTCDate(date.getUTCDate() + offset)
            return date.toISOString()
        }
        const date = new Date(value)
        if (!Number.isFinite(date.getTime())) return ""
        date.setDate(date.getDate() + offset)
        return date.toISOString()
    }

    function sourceDateForEvent(event) {
        if (event === null || event === undefined) return ""
        if (event.allDay === true) return (event.startAt || "").slice(0, 10)
        const date = new Date(event.startAt)
        return Number.isFinite(date.getTime()) ? localDateString(date) : ""
    }

    function requestEventMove(event, targetDate) {
        const sourceDate = sourceDateForEvent(event)
        if (sourceDate.length === 0 || targetDate.length === 0) return
        const offset = dayDelta(sourceDate, targetDate)
        if (offset === 0) return
        const startAt = shiftDateValue(event.startAt, offset, event.allDay === true)
        const endAt = shiftDateValue(event.endAt, offset, event.allDay === true)
        if (startAt.length > 0 && endAt.length > 0) {
            eventMoveScopeRequested(event, startAt, endAt, event.allDay === true)
        }
    }

    function tasksForDate(date) {
        if (!Array.isArray(scheduledTasks)) return []
        return scheduledTasks.filter(function(task) { return (task.dueAt || "").slice(0, 10) === date })
    }

    function quickCreateForRange(firstDate, lastDate) {
        if (firstDate.length === 0 || lastDate.length === 0) return
        const first = new Date(firstDate + "T00:00:00Z")
        const last = new Date(lastDate + "T00:00:00Z")
        if (!Number.isFinite(first.getTime()) || !Number.isFinite(last.getTime())) return
        const start = first <= last ? first : last
        const end = first <= last ? last : first
        end.setUTCDate(end.getUTCDate() + 1)
        quickCreateRequested(start.toISOString(), end.toISOString(), true)
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

                    MouseArea {
                        id: cellQuickCreateArea
                        anchors.fill: parent
                        z: -1
                        property string firstDate: ""
                        preventStealing: true
                        cursorShape: Qt.CrossCursor
                        onPressed: firstDate = date
                        onReleased: function(mouse) {
                            const point = mapToItem(gridArea, mouse.x, mouse.y)
                            root.quickCreateForRange(firstDate, root.dateForGridPoint(point.x, point.y))
                        }
                    }

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

                                DragHandler {
                                    enabled: !root.selectionMode
                                    target: null
                                    onActiveChanged: {
                                        const point = parent.mapToItem(gridArea,
                                                                       parent.width / 2 + activeTranslation.x,
                                                                       parent.height / 2 + activeTranslation.y)
                                        if (!active) root.requestEventMove(modelData,
                                                                           root.dateForGridPoint(point.x, point.y))
                                    }
                                }
                            }
                        }

                        Repeater {
                            model: root.tasksForDate(date).slice(0, 1)
                            delegate: CalendarTaskButton {
                                required property var modelData
                                width: parent.width
                                height: root.allDayLaneHeight
                                compact: true
                                text: modelData.title
                                accessibleName: "Task: " + modelData.title
                                onClicked: root.taskDetailRequested(modelData)

                                DragHandler {
                                    enabled: !root.selectionMode
                                    target: null
                                    onActiveChanged: {
                                        const point = parent.mapToItem(gridArea,
                                                                       parent.width / 2 + activeTranslation.x,
                                                                       parent.height / 2 + activeTranslation.y)
                                        if (!active) root.taskMoveRequested(modelData.id,
                                                                             root.dateForGridPoint(point.x, point.y))
                                    }
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

                    DragHandler {
                        enabled: !root.selectionMode && !modelData.startsBeforeRange
                        target: null
                        onActiveChanged: {
                            const point = parent.mapToItem(gridArea,
                                                           parent.x + activeTranslation.x,
                                                           parent.y + parent.height / 2 + activeTranslation.y)
                            if (!active) root.requestEventMove(modelData,
                                                               root.dateForGridPoint(point.x, point.y))
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
