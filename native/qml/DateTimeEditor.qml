import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

ColumnLayout {
    id: root
    property string value: ""
    property bool allDay: false
    property string accessibleName: "Date and time"
    property bool updating: false

    function daysInMonth(year, month) { return new Date(Date.UTC(year, month, 0)).getUTCDate() }
    function syncFromValue() {
        const parsed = new Date(value)
        if (!Number.isFinite(parsed.getTime())) return
        updating = true
        year.value = parsed.getFullYear()
        month.value = parsed.getMonth() + 1
        day.to = daysInMonth(year.value, month.value)
        day.value = parsed.getDate()
        hour.value = parsed.getHours()
        minute.value = parsed.getMinutes()
        updating = false
    }
    function commit() {
        if (updating) return
        day.to = daysInMonth(year.value, month.value)
        if (day.value > day.to) day.value = day.to
        value = new Date(year.value, month.value - 1, day.value, allDay ? 0 : hour.value,
                         allDay ? 0 : minute.value, 0, 0).toISOString()
    }
    onValueChanged: syncFromValue()
    onAllDayChanged: commit()
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
