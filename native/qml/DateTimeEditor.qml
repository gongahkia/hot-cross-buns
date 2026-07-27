import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

ColumnLayout {
    id: root
    property string value: ""
    property bool allDay: false
    property string timeZone: ""
    property var timeZoneConverter: null
    property string accessibleName: "Date and time"
    property bool updating: false

    function daysInMonth(year, month) { return new Date(Date.UTC(year, month, 0)).getUTCDate() }
    function syncFromValue() {
        const parsed = new Date(value)
        if (!Number.isFinite(parsed.getTime())) return
        updating = true
        const components = !allDay && timeZoneConverter !== null
                         ? timeZoneConverter.dateTimeComponents(value, timeZone) : null
        year.value = components && components.year !== undefined ? components.year
                                                                 : (allDay ? parsed.getUTCFullYear() : parsed.getFullYear())
        month.value = components && components.month !== undefined ? components.month
                                                                   : (allDay ? parsed.getUTCMonth() + 1 : parsed.getMonth() + 1)
        day.to = daysInMonth(year.value, month.value)
        day.value = components && components.day !== undefined ? components.day
                                                               : (allDay ? parsed.getUTCDate() : parsed.getDate())
        hour.value = allDay ? 0 : (components && components.hour !== undefined ? components.hour : parsed.getHours())
        minute.value = allDay ? 0 : (components && components.minute !== undefined ? components.minute : parsed.getMinutes())
        updating = false
    }
    function commit() {
        if (updating) return
        day.to = daysInMonth(year.value, month.value)
        if (day.value > day.to) day.value = day.to
        const next = allDay
                     ? new Date(Date.UTC(year.value, month.value - 1, day.value, 0, 0, 0, 0)).toISOString()
                     : (timeZoneConverter !== null
                        ? timeZoneConverter.dateTimeFromComponents(year.value, month.value - 1, day.value,
                                                                     hour.value, minute.value, timeZone)
                        : new Date(year.value, month.value - 1, day.value, hour.value, minute.value,
                                   0, 0).toISOString())
        if (next.length > 0) value = next
    }
    onValueChanged: syncFromValue()
    onTimeZoneChanged: syncFromValue()
    onAllDayChanged: {
        syncFromValue()
        commit()
    }
    Component.onCompleted: syncFromValue()

    RowLayout {
        Layout.fillWidth: true
        Label { text: root.accessibleName; Layout.preferredWidth: 72 }
        SpinBox { id: year; from: 1970; to: 2100; value: new Date().getFullYear(); editable: true
                  Accessible.name: root.accessibleName + " year"; onValueModified: root.commit() }
        SpinBox { id: month; from: 1; to: 12; value: 1; editable: true
                  Accessible.name: root.accessibleName + " month"; onValueModified: root.commit() }
        SpinBox { id: day; from: 1; to: 31; value: 1; editable: true
                  Accessible.name: root.accessibleName + " day"; onValueModified: root.commit() }
    }
    RowLayout {
        Layout.fillWidth: true
        visible: !root.allDay
        Label { text: "Time"; Layout.preferredWidth: 72 }
        SpinBox { id: hour; from: 0; to: 23; editable: true; Accessible.name: root.accessibleName + " hour"
                  onValueModified: root.commit() }
        Label { text: ":" }
        SpinBox { id: minute; from: 0; to: 59; editable: true; Accessible.name: root.accessibleName + " minute"
                  onValueModified: root.commit() }
    }
    TextField {
        id: advancedDateTime
        Layout.fillWidth: true
        placeholderText: "Advanced ISO 8601 (optional)"
        text: root.value
        selectByMouse: true
        Accessible.name: root.accessibleName + " advanced ISO time"
        onEditingFinished: {
            if (Number.isFinite(new Date(text.trim()).getTime())) root.value = text.trim()
        }
    }
}
