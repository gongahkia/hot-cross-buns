import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Pane {
    id: root
    property var calendarSourceModel: null
    property var visibleCalendarIds: []
    property bool visibilityInitialized: false
    property int sourceRevision: calendarSourceModel !== null && calendarSourceModel.revision !== undefined
                                 ? calendarSourceModel.revision : 0
    property alias sourceRows: sourceRows

    function calendarIds() {
        const revision = sourceRevision
        if (calendarSourceModel === null) {
            return []
        }
        if (typeof calendarSourceModel.calendarIds === "function") {
            return calendarSourceModel.calendarIds()
        }
        const ids = []
        for (let row = 0; row < calendarSourceModel.count; ++row) {
            ids.push(calendarSourceModel.get(row).id)
        }
        return ids
    }

    function selectedCalendarIds() {
        if (calendarSourceModel === null) {
            return []
        }
        if (typeof calendarSourceModel.selectedCalendarIds === "function") {
            return calendarSourceModel.selectedCalendarIds()
        }
        const ids = []
        for (let row = 0; row < calendarSourceModel.count; ++row) {
            const calendar = calendarSourceModel.get(row)
            if (calendar.selected) {
                ids.push(calendar.id)
            }
        }
        return ids
    }

    function initializeVisibility() {
        const ids = calendarIds()
        if (ids.length === 0) {
            visibleCalendarIds = []
            visibilityInitialized = false
            return
        }
        const selected = selectedCalendarIds()
        visibleCalendarIds = selected.length > 0 ? selected : ids
        visibilityInitialized = true
    }

    function reconcileVisibility() {
        const ids = calendarIds()
        visibleCalendarIds = visibleCalendarIds.filter(function(calendarId) {
            return ids.indexOf(calendarId) >= 0
        })
    }

    function isVisible(calendarId) {
        return visibleCalendarIds.indexOf(calendarId) >= 0
    }

    function preferredCalendarId() {
        return visibleCalendarIds.length > 0 ? visibleCalendarIds[0] : calendarIds()[0] || ""
    }

    function setCalendarVisible(calendarId, visible) {
        const next = visibleCalendarIds.filter(function(currentId) {
            return currentId !== calendarId
        })
        if (visible) {
            next.push(calendarId)
        }
        visibleCalendarIds = next
    }

    function showAll() {
        visibleCalendarIds = calendarIds()
    }

    onCalendarSourceModelChanged: initializeVisibility()
    onSourceRevisionChanged: {
        if (visibilityInitialized) {
            reconcileVisibility()
        } else {
            initializeVisibility()
        }
    }

    padding: Theme.spacingMedium
    implicitHeight: controlsRow.implicitHeight + topPadding + bottomPadding
    visible: sourceRows.count > 0

    RowLayout {
        id: controlsRow
        anchors.fill: parent
        spacing: Theme.spacingMedium

        Label {
            text: "Calendar visibility"
            font.pixelSize: Theme.labelFontSize
            Accessible.role: Accessible.Heading
            Accessible.name: text
        }

        Flow {
            Layout.fillWidth: true
            spacing: Theme.spacingSmall

            Repeater {
                id: sourceRows
                model: root.calendarSourceModel

                delegate: CheckBox {
                    required property string id
                    required property string title
                    checked: root.isVisible(id)
                    text: title
                    Accessible.name: title
                    Accessible.description: checked ? "Calendar visible" : "Calendar hidden"
                    onToggled: root.setCalendarVisible(id, checked)
                }
            }
        }

        Button {
            text: "Show all"
            enabled: root.visibleCalendarIds.length < root.calendarIds().length
            Accessible.name: text
            onClicked: root.showAll()
        }
    }
}
