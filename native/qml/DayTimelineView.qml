import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Pane {
    id: root
    property var timelineModel: null
    property var calendarVisibility: null
    property int dayIndex: 0
    property int hourHeight: 64
    property int timeColumnWidth: 64
    property alias eventRows: eventRows
    signal eventSelected(string eventId)
    signal eventMoveRequested(string eventId, string startAt, string endAt, bool allDay)

    function timePosition(minute) {
        return minute * hourHeight / 60
    }

    function eventHeight(durationMinutes) {
        return Math.max(24, durationMinutes * hourHeight / 60)
    }

    function dropMinute(y) {
        return Math.max(0, Math.min(24 * 60 - 1, Math.round(y * 60 / hourHeight)))
    }

    function requestMove(eventId, targetDayIndex, targetMinute) {
        if (timelineModel === null || typeof timelineModel.moveInput !== "function") {
            return
        }
        const move = timelineModel.moveInput(eventId, targetDayIndex, targetMinute)
        if (move === null || typeof move.id !== "string" || typeof move.startAt !== "string" ||
                typeof move.endAt !== "string" || typeof move.allDay !== "boolean") {
            return
        }
        eventMoveRequested(move.id, move.startAt, move.endAt, move.allDay)
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
            text: "Day"
            font.pixelSize: Theme.titleFontSize
            Accessible.role: Accessible.Heading
            Accessible.name: text
        }

        Column {
            Layout.fillWidth: true
            spacing: Theme.spacingSmall

            Repeater {
                model: root.timelineModel

                delegate: AccessibleButton {
                    required property string id
                    required property string calendarId
                    required property string title
                    required property bool allDay
                    required property int dayIndex
                    visible: allDay && dayIndex === root.dayIndex && root.isCalendarVisible(calendarId)
                    width: parent.width
                    text: title + " — All day"
                    accessibleName: title
                    accessibleDescription: "All-day event"
                    onClicked: root.selectEvent(id)
                }
            }
        }

        Flickable {
            id: timelineViewport
            Layout.fillWidth: true
            Layout.fillHeight: true
            clip: true
            contentWidth: width
            contentHeight: timelineCanvas.height

            Item {
                id: timelineCanvas
                width: timelineViewport.width
                height: root.hourHeight * 24

                Repeater {
                    model: 24

                    delegate: Item {
                        required property int index
                        x: 0
                        y: index * root.hourHeight
                        width: timelineCanvas.width
                        height: root.hourHeight

                        Label {
                            width: root.timeColumnWidth
                            text: String(index).padStart(2, "0") + ":00"
                            color: Theme.textSecondary
                        }

                        Rectangle {
                            anchors.left: parent.left
                            anchors.leftMargin: root.timeColumnWidth
                            anchors.right: parent.right
                            anchors.top: parent.top
                            height: 1
                            color: Theme.textSecondary
                            opacity: 0.25
                        }
                    }
                }

                Repeater {
                    id: eventRows
                    model: root.timelineModel

                    delegate: AccessibleButton {
                        required property string id
                        required property string calendarId
                        required property string title
                        required property bool allDay
                        required property int dayIndex
                        required property int startMinute
                        required property int durationMinutes
                        required property int laneIndex
                        required property int laneCount
                        visible: !allDay && dayIndex === root.dayIndex && root.isCalendarVisible(calendarId)
                        x: root.timeColumnWidth + laneIndex *
                           (timelineCanvas.width - root.timeColumnWidth) / Math.max(1, laneCount)
                        y: root.timePosition(startMinute)
                        width: (timelineCanvas.width - root.timeColumnWidth) / Math.max(1, laneCount)
                        height: root.eventHeight(durationMinutes)
                        text: title
                        accessibleName: title
                        accessibleDescription: "Timed event"
                        onClicked: root.selectEvent(id)

                        DragHandler {
                            id: moveHandler
                            target: null
                            onActiveChanged: {
                                const targetMinute = root.dropMinute(parent.y + activeTranslation.y)
                                if (!active && targetMinute !== startMinute) {
                                    root.requestMove(id, root.dayIndex, targetMinute)
                                }
                            }
                        }

                        opacity: moveHandler.active ? 0.7 : 1
                    }
                }
            }
        }
    }

    Label {
        anchors.centerIn: parent
        visible: eventRows.count === 0
        text: "No events today."
        color: Theme.textSecondary
    }
}
