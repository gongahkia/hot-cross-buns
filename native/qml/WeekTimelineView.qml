import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Pane {
    id: root
    property var timelineModel: null
    property var calendarVisibility: null
    property var selectedEventIds: []
    property bool selectionMode: false
    property var dayLabels: []
    property int dayCount: 7
    property int hourHeight: 48
    property bool use24HourTime: true
    property int workdayStartHour: 9
    property int timeColumnWidth: 64
    property int allDayLaneHeight: 28
    property bool timelineActive: true
    property bool bypassCalendarVisibility: false
    property var allDayEventRows: null
    property var timedEventRows: null
    property var viewportSource: null
    property alias eventRows: eventRows
    signal eventSelected(string eventId)
    signal eventSelectionRequested(string eventId, bool selected)
    signal eventMoveRequested(string eventId, string startAt, string endAt, bool allDay)
    signal eventResizeRequested(string eventId, string endAt)
    signal eventEditRequested(string eventId, string calendarId, string title, string startAt,
                              string endAt, bool allDay, string description, string location,
                              string startTimeZone, string colorId, string transparency,
                              string visibility, string attendeeEmailsJson, string remindersJson,
                              bool remindersUseDefault, string recurrenceRule,
                              string recurringRemoteId, string originalStartAt, string eventType,
                              string conferenceJson, string attachmentsJson,
                              string guestPermissionsJson, string statusPropertiesJson)

    function dayColumnWidth(availableWidth) {
        return (availableWidth - timeColumnWidth) / dayCount
    }

    function dayPosition(dayIndex, availableWidth) {
        return timeColumnWidth + dayIndex * dayColumnWidth(availableWidth)
    }

    function timePosition(minute) {
        return minute * hourHeight / 60
    }

    function eventColor(calendarId, colorId) {
        const fallback = calendarVisibility !== null && typeof calendarVisibility.calendarColor === "function"
                       ? calendarVisibility.calendarColor(calendarId) : Theme.calendarFallback
        return Theme.calendarColor(colorId, fallback)
    }

    function timeRange(startAt, endAt) {
        const start = new Date(startAt)
        const end = new Date(endAt)
        if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return ""
        return Qt.locale().toString(start, "HH:mm") + "–" + Qt.locale().toString(end, "HH:mm")
    }

    function hourLabel(hour) {
        if (use24HourTime) return String(hour).padStart(2, "0") + ":00"
        const suffix = hour < 12 ? "AM" : "PM"
        const display = hour % 12 === 0 ? 12 : hour % 12
        return display + " " + suffix
    }

    function dropDayIndex(x, availableWidth) {
        return Math.max(0, Math.min(dayCount - 1,
                                    Math.floor((x - timeColumnWidth) / dayColumnWidth(availableWidth))))
    }

    function dropMinute(y) {
        return Math.max(0, Math.min(24 * 60 - 1, Math.round(y * 60 / hourHeight)))
    }

    function dropEndMinute(y) {
        return Math.max(0, Math.min(24 * 60, Math.round(y * 60 / hourHeight)))
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

    function requestAllDayMove(eventId, targetDayIndex) {
        if (timelineModel === null || typeof timelineModel.moveAllDayInput !== "function") {
            return
        }
        const move = timelineModel.moveAllDayInput(eventId, targetDayIndex)
        if (move === null || typeof move.id !== "string" || typeof move.startAt !== "string" ||
                typeof move.endAt !== "string" || move.allDay !== true) {
            return
        }
        eventMoveRequested(move.id, move.startAt, move.endAt, true)
    }

    function requestResize(eventId, targetEndDayIndex, targetEndMinute) {
        if (timelineModel === null || typeof timelineModel.resizeInput !== "function") {
            return
        }
        const resize = timelineModel.resizeInput(eventId, targetEndDayIndex, targetEndMinute)
        if (resize === null || typeof resize.id !== "string" || typeof resize.endAt !== "string") {
            return
        }
        eventResizeRequested(resize.id, resize.endAt)
    }

    function requestAllDayResize(eventId, targetEndDayIndex) {
        if (timelineModel === null || typeof timelineModel.resizeAllDayInput !== "function") {
            return
        }
        const resize = timelineModel.resizeAllDayInput(eventId, targetEndDayIndex)
        if (resize === null || typeof resize.id !== "string" || typeof resize.endAt !== "string") {
            return
        }
        eventResizeRequested(resize.id, resize.endAt)
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
        return bypassCalendarVisibility || calendarVisibility === null || calendarVisibility.isVisible(calendarId)
    }

    function isEventSelected(eventId) {
        return selectedEventIds.indexOf(eventId) >= 0
    }

    function configureViewportModels() {
        if (viewportSource === timelineModel) {
            updateViewportFilters()
            return
        }
        viewportSource = timelineModel
        if (timelineModel !== null && typeof timelineModel.createViewport === "function") {
            allDayEventRows = timelineModel.createViewport()
            timedEventRows = timelineModel.createViewport()
        } else {
            allDayEventRows = timelineModel
            timedEventRows = timelineModel
        }
        updateViewportFilters()
    }

    function updateViewportFilters() {
        if (allDayEventRows !== null && typeof allDayEventRows.firstDayIndex === "number") {
            allDayEventRows.firstDayIndex = 0
            allDayEventRows.dayCount = dayCount
            allDayEventRows.allDay = true
            allDayEventRows.active = timelineActive
            allDayEventRows.filterCalendarVisibility = !bypassCalendarVisibility &&
                                                       calendarVisibility !== null
            allDayEventRows.visibleCalendarIds = calendarVisibility !== null
                                                 ? calendarVisibility.visibleCalendarIds : []
        }
        if (timedEventRows !== null && typeof timedEventRows.firstDayIndex === "number") {
            timedEventRows.firstDayIndex = 0
            timedEventRows.dayCount = dayCount
            timedEventRows.allDay = false
            timedEventRows.active = timelineActive
            timedEventRows.filterCalendarVisibility = !bypassCalendarVisibility &&
                                                     calendarVisibility !== null
            timedEventRows.visibleCalendarIds = calendarVisibility !== null
                                               ? calendarVisibility.visibleCalendarIds : []
        }
    }

    Component.onCompleted: configureViewportModels()
    onTimelineModelChanged: {
        configureViewportModels()
        Qt.callLater(timelineViewport.updateVisibleMinuteRange)
    }
    onDayCountChanged: updateViewportFilters()
    onCalendarVisibilityChanged: updateViewportFilters()
    onBypassCalendarVisibilityChanged: updateViewportFilters()
    onTimelineActiveChanged: {
        updateViewportFilters()
        if (timelineActive) Qt.callLater(timelineViewport.updateVisibleMinuteRange)
    }

    Connections {
        target: root.calendarVisibility
        function onVisibleCalendarIdsChanged() { root.updateViewportFilters() }
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
                    text: root.dayLabels.length === root.dayCount ? root.dayLabels[index]
                                                                  : "Day " + (index + 1)
                    horizontalAlignment: Text.AlignHCenter
                    Accessible.name: text
                }
            }

            Repeater {
                model: allDayEventRows

                delegate: CalendarEventButton {
                    required property string id
                    required property string calendarId
                    required property string title
                    required property bool allDay
                    required property int dayIndex
                    required property int laneIndex
                    required property int daySpan
                    required property bool startsBeforeRange
                    required property bool endsAfterRange
                    required property string description
                    required property string location
                    required property string startAt
                    required property string startTimeZone
                    required property string endAt
                    required property string transparency
                    required property string visibility
                    required property string colorId
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
                    visible: root.isCalendarVisible(calendarId)
                    x: root.dayPosition(dayIndex, dayHeader.width)
                    y: root.allDayLaneHeight + laneIndex * root.allDayLaneHeight
                    width: daySpan * root.dayColumnWidth(dayHeader.width)
                    height: root.allDayLaneHeight
                    compact: true
                    eventColor: root.eventColor(calendarId, colorId)
                    text: title
                    accessibleName: title
                    accessibleDescription: "All-day event, starting day " + (dayIndex + 1)
                    onClicked: {
                        if (root.selectionMode) {
                            root.eventSelectionRequested(id, !root.isEventSelected(id))
                        } else {
                            root.selectEvent(id)
                            root.requestEdit(id, calendarId, title, startAt, endAt, allDay, description,
                                             location, startTimeZone, colorId, transparency, visibility,
                                             attendeeEmailsJson, remindersJson, remindersUseDefault,
                                             recurrenceRule, recurringRemoteId, originalStartAt, eventType,
                                             conferenceJson, attachmentsJson, guestPermissionsJson,
                                             statusPropertiesJson)
                        }
                    }

                    HoverHandler { id: allDayHover }

                    DragHandler {
                        id: allDayMoveHandler
                        enabled: !root.selectionMode && !startsBeforeRange && !endsAfterRange
                        target: null
                        onActiveChanged: {
                            const targetDay = root.dropDayIndex(parent.x + activeTranslation.x,
                                                                dayHeader.width)
                            if (!active && !allDayResizeHandler.active && targetDay !== dayIndex) {
                                root.requestAllDayMove(id, targetDay)
                            }
                        }
                    }

                    AccessibleButton {
                        id: allDayResizeHandle
                        anchors.top: parent.top
                        anchors.right: parent.right
                        anchors.bottom: parent.bottom
                        width: 14
                        visible: allDayHover.hovered || allDayResizeHandler.active
                        padding: 0
                        text: ""
                        enabled: !root.selectionMode && !startsBeforeRange && !endsAfterRange
                        accessibleName: "Resize " + title + " end"
                        accessibleDescription: "Drag to change the all-day end date"
                        onClicked: root.requestAllDayResize(id, dayIndex + daySpan)

                        DragHandler {
                            id: allDayResizeHandler
                            enabled: !root.selectionMode
                            target: null
                            cursorShape: Qt.SizeHorCursor
                            grabPermissions: PointerHandler.CanTakeOverFromAnything
                            onActiveChanged: {
                                const targetDay = root.dropDayIndex(
                                            parent.parent.x + parent.parent.width - 1 + activeTranslation.x,
                                            dayHeader.width)
                                const initialEndDay = dayIndex + daySpan - 1
                                if (!active && targetDay !== initialEndDay) {
                                    root.requestAllDayResize(id, targetDay)
                                }
                            }
                        }
                    }

                    CheckBox {
                        anchors.top: parent.top
                        anchors.right: parent.right
                        anchors.margins: 2
                        z: 1
                        visible: root.selectionMode
                        checked: root.isEventSelected(id)
                        Accessible.name: "Select " + title
                        Accessible.description: checked ? "Event selected" : "Event not selected"
                        onClicked: root.eventSelectionRequested(id, checked)
                    }
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

            function revealWorkday() {
                contentY = Math.max(0, Math.min(contentHeight - height,
                                                 root.workdayStartHour * root.hourHeight))
                updateVisibleMinuteRange()
            }

            function updateVisibleMinuteRange() {
                if (!root.timelineActive || timedEventRows === null ||
                        typeof timedEventRows.visibleStartMinute !== "number" ||
                        root.hourHeight <= 0 || height <= 0) {
                    return
                }
                const startMinute = Math.max(0, Math.floor(
                                               (contentY * 60 / root.hourHeight - 60) / 30) * 30)
                const endMinute = Math.min(24 * 60, Math.ceil(
                                             ((contentY + height) * 60 / root.hourHeight + 60) / 30) * 30)
                if (endMinute > startMinute) {
                    timedEventRows.visibleStartMinute = startMinute
                    timedEventRows.visibleEndMinute = endMinute
                }
            }

            Component.onCompleted: Qt.callLater(revealWorkday)
            onHeightChanged: {
                Qt.callLater(revealWorkday)
                Qt.callLater(updateVisibleMinuteRange)
            }
            onContentYChanged: updateVisibleMinuteRange()
            Connections {
                target: root
                function onWorkdayStartHourChanged() { Qt.callLater(timelineViewport.revealWorkday) }
                function onHourHeightChanged() { Qt.callLater(timelineViewport.updateVisibleMinuteRange) }
            }

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
                            text: root.hourLabel(index)
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
                    model: timedEventRows

                    delegate: CalendarEventButton {
                        required property string id
                        required property string calendarId
                        required property string title
                        required property bool allDay
                        required property int dayIndex
                        required property int startMinute
                        required property int durationMinutes
                        required property int laneIndex
                        required property int laneCount
                        required property string description
                        required property string location
                        required property string startAt
                        required property string startTimeZone
                        required property string endAt
                        required property string transparency
                        required property string visibility
                        required property string colorId
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
                        visible: root.isCalendarVisible(calendarId)
                        x: root.dayPosition(dayIndex, timelineCanvas.width) + laneIndex *
                           root.dayColumnWidth(timelineCanvas.width) / Math.max(1, laneCount) + 2
                        y: root.timePosition(startMinute)
                        width: Math.max(1, root.dayColumnWidth(timelineCanvas.width) /
                                        Math.max(1, laneCount) - 4)
                        height: Math.max(24, durationMinutes * root.hourHeight / 60)
                        eventColor: root.eventColor(calendarId, colorId)
                        text: title + (height >= 42 ? "\n" + root.timeRange(startAt, endAt) : "")
                        accessibleName: title
                        accessibleDescription: "Timed event, day " + (dayIndex + 1)
                        onClicked: {
                            if (root.selectionMode) {
                                root.eventSelectionRequested(id, !root.isEventSelected(id))
                            } else {
                                root.selectEvent(id)
                                root.requestEdit(id, calendarId, title, startAt, endAt, allDay, description,
                                                 location, startTimeZone, colorId, transparency, visibility,
                                                 attendeeEmailsJson, remindersJson, remindersUseDefault,
                                                 recurrenceRule, recurringRemoteId, originalStartAt, eventType,
                                                 conferenceJson, attachmentsJson, guestPermissionsJson,
                                                 statusPropertiesJson)
                            }
                        }

                        HoverHandler { id: eventHover }

                        DragHandler {
                            id: moveHandler
                            enabled: !root.selectionMode
                            target: null
                            onActiveChanged: {
                                const targetDay = root.dropDayIndex(parent.x + activeTranslation.x,
                                                                    timelineCanvas.width)
                                const targetMinute = root.dropMinute(parent.y + activeTranslation.y)
                                if (!active && !resizeHandler.active &&
                                        (targetDay !== dayIndex || targetMinute !== startMinute)) {
                                    root.requestMove(id, targetDay, targetMinute)
                                }
                            }
                        }

                        opacity: moveHandler.active ? 0.7 : 1

                        CheckBox {
                            anchors.top: parent.top
                            anchors.right: parent.right
                            anchors.margins: 2
                            z: 1
                            visible: root.selectionMode
                            checked: root.isEventSelected(id)
                            Accessible.name: "Select " + title
                            Accessible.description: checked ? "Event selected" : "Event not selected"
                            onClicked: root.eventSelectionRequested(id, checked)
                        }

                        AccessibleButton {
                            id: resizeHandle
                            anchors.left: parent.left
                            anchors.right: parent.right
                            anchors.bottom: parent.bottom
                            height: 14
                            visible: eventHover.hovered || resizeHandler.active
                            padding: 0
                            text: ""
                            accessibleName: "Resize " + title + " end"
                            accessibleDescription: "Drag to change the end time"
                            onClicked: root.requestResize(id, dayIndex,
                                                          Math.min(24 * 60,
                                                                   startMinute + durationMinutes + 15))

                            background: Rectangle {
                                color: root.eventColor(calendarId, colorId)
                                opacity: resizeHandler.active ? 1 : 0.65
                                radius: 1
                            }

                            DragHandler {
                                id: resizeHandler
                                enabled: !root.selectionMode
                                target: null
                                cursorShape: Qt.SizeVerCursor
                                grabPermissions: PointerHandler.CanTakeOverFromAnything
                                onActiveChanged: {
                                    const targetEndDay = root.dropDayIndex(
                                                parent.parent.x + parent.parent.width - 1 + activeTranslation.x,
                                                timelineCanvas.width)
                                    const targetEndMinute = root.dropEndMinute(
                                                parent.parent.y + parent.parent.height + activeTranslation.y)
                                    const initialEndMinute = Math.min(24 * 60,
                                                                      startMinute + durationMinutes)
                                    if (!active && (targetEndDay !== dayIndex ||
                                                    targetEndMinute !== initialEndMinute)) {
                                        root.requestResize(id, targetEndDay, targetEndMinute)
                                    }
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
        visible: root.timelineModel === null || root.timelineModel.totalItemCount === 0
        text: "No events this week."
        color: Theme.textSecondary
    }
}
