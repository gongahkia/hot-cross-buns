import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Pane {
    id: root
    property var timelineModel: null
    property int dayCount: 7
    property int hourHeight: 48
    property int timeColumnWidth: 64
    property int allDayLaneHeight: 28
    property alias eventRows: eventRows
    signal eventSelected(string eventId)

    function dayColumnWidth(availableWidth) {
        return (availableWidth - timeColumnWidth) / dayCount
    }

    function dayPosition(dayIndex, availableWidth) {
        return timeColumnWidth + dayIndex * dayColumnWidth(availableWidth)
    }

    function timePosition(minute) {
        return minute * hourHeight / 60
    }

    function selectEvent(eventId) {
        eventSelected(eventId)
    }

    ColumnLayout {
        anchors.fill: parent
        spacing: Theme.spacingMedium

        Label {
            text: "Week"
            font.pixelSize: Theme.titleFontSize
            Accessible.role: Accessible.Heading
            Accessible.name: text
        }

        Item {
            id: dayHeader
            Layout.fillWidth: true
            Layout.preferredHeight: root.allDayLaneHeight * 2

            Repeater {
                model: root.dayCount

                delegate: Label {
                    required property int index
                    x: root.dayPosition(index, dayHeader.width)
                    width: root.dayColumnWidth(dayHeader.width)
                    text: "Day " + (index + 1)
                    horizontalAlignment: Text.AlignHCenter
                    Accessible.name: text
                }
            }

            Repeater {
                model: root.timelineModel

                delegate: AccessibleButton {
                    required property string id
                    required property string title
                    required property bool allDay
                    required property int dayIndex
                    required property int laneIndex
                    required property int daySpan
                    visible: allDay
                    x: root.dayPosition(dayIndex, dayHeader.width)
                    y: root.allDayLaneHeight + laneIndex * root.allDayLaneHeight
                    width: daySpan * root.dayColumnWidth(dayHeader.width)
                    height: root.allDayLaneHeight
                    text: title
                    accessibleName: title
                    accessibleDescription: "All-day event, starting day " + (dayIndex + 1)
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
                        y: index * root.hourHeight
                        width: timelineCanvas.width
                        height: root.hourHeight

                        Label {
                            width: root.timeColumnWidth
                            text: String(index).padStart(2, "0") + ":00"
                            color: Theme.textSecondary
                        }

                        Repeater {
                            model: root.dayCount

                            delegate: Rectangle {
                                required property int index
                                x: root.dayPosition(index, timelineCanvas.width)
                                width: root.dayColumnWidth(timelineCanvas.width)
                                height: 1
                                color: Theme.textSecondary
                                opacity: 0.25
                            }
                        }
                    }
                }

                Repeater {
                    id: eventRows
                    model: root.timelineModel

                    delegate: AccessibleButton {
                        required property string id
                        required property string title
                        required property bool allDay
                        required property int dayIndex
                        required property int startMinute
                        required property int durationMinutes
                        required property int laneIndex
                        required property int laneCount
                        visible: !allDay
                        x: root.dayPosition(dayIndex, timelineCanvas.width) + laneIndex *
                           root.dayColumnWidth(timelineCanvas.width) / Math.max(1, laneCount)
                        y: root.timePosition(startMinute)
                        width: root.dayColumnWidth(timelineCanvas.width) / Math.max(1, laneCount)
                        height: Math.max(24, durationMinutes * root.hourHeight / 60)
                        text: title
                        accessibleName: title
                        accessibleDescription: "Timed event, day " + (dayIndex + 1)
                        onClicked: root.selectEvent(id)
                    }
                }
            }
        }
    }

    Label {
        anchors.centerIn: parent
        visible: eventRows.count === 0
        text: "No events this week."
        color: Theme.textSecondary
    }
}
