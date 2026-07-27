import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

HcbDialog {
    id: root
    title: "New event"
    primaryText: "Create event"
    primaryEnabled: eventCalendarId.length > 0 && titleField.text.trim().length > 0 && validRange() && validMetadata()
    property var calendarSourceModel: null
    property var driveAttachmentCandidates: []
    property var freeBusyIntervals: []
    property string eventCalendarId: ""
    property bool guestPermissionsCustomized: false
    property alias eventTitle: titleField.text
    property alias eventStartAt: startField.text
    property alias eventEndAt: endField.text
    property alias eventAllDay: allDayCheck.checked
    property alias eventDescription: descriptionField.text
    property alias eventLocation: locationField.text
    property alias calendarPicker: calendarPicker
    property alias eventTitleField: titleField
    signal eventCreateRequested(string calendarId, string title, string startAt, string endAt,
                                bool allDay, string description, string location, string timeZone,
                                string colorId, bool available, string visibility, var attendees,
                                bool remindersUseDefault, var reminders, string recurrenceRule)
    signal richEventCreateRequested(string calendarId, string title, string startAt, string endAt,
                                bool allDay, string description, string location, string timeZone,
                                string colorId, bool available, string visibility, var attendees,
                                bool remindersUseDefault, var reminders, string recurrenceRule,
                                bool createGoogleMeet, string attachmentsJson,
                                string guestPermissionsJson, string eventType,
                                string statusPropertiesJson, string sendUpdates)
    signal driveSearchRequested(string query)
    signal availabilityRequested(var calendarIds, string startAt, string endAt)
    ListModel { id: attachmentModel }

    function validRange() {
        const start = Date.parse(startField.text)
        const end = Date.parse(endField.text)
        return Number.isFinite(start) && Number.isFinite(end) && end > start
    }

    function attendeeValues() {
        const seen = {}
        const values = attendeeField.text.split(/[\n,;]/).map(function(value) { return value.trim() })
            .filter(function(value) { return value.length > 0 })
        for (let index = 0; index < values.length; ++index) {
            const key = values[index].toLowerCase()
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values[index]) || seen[key]) return null
            seen[key] = true
        }
        return values.length <= 200 ? values : null
    }

    function reminderValues() {
        const text = reminderField.text.trim()
        if (text.length === 0) return []
        const values = text.split(/[\n,;]/).map(function(value) { return value.trim() })
            .filter(function(value) { return value.length > 0 })
        const reminders = []
        for (let index = 0; index < values.length; ++index) {
            const match = /^(email|popup)\s*:\s*(\d+)$/.exec(values[index])
            if (match === null) return null
            const minutes = Number(match[2])
            if (!Number.isInteger(minutes) || minutes < 0 || minutes > 40320) return null
            reminders.push({ method: match[1], minutes: minutes })
        }
        return reminders.length <= 5 ? reminders : null
    }

    function validMetadata() {
        return attendeeValues() !== null && reminderValues() !== null &&
               (timeZoneField.text.trim().length === 0 ||
                /^(?:UTC|[A-Za-z_]+(?:\/[A-Za-z_+-]+)+)$/.test(timeZoneField.text.trim())) &&
               validStatusProperties()
    }

    function attachmentsJson() {
        const items = []
        for (let index = 0; index < attachmentModel.count; ++index) {
            const item = attachmentModel.get(index)
            items.push({ fileUrl: item.fileUrl, title: item.title, mimeType: item.mimeType })
        }
        return JSON.stringify(items)
    }

    function guestPermissionsJson() {
        if (!guestPermissionsCustomized) return "{}"
        return JSON.stringify({ guestsCanInviteOthers: guestsCanInviteCheck.checked,
                                guestsCanModify: guestsCanModifyCheck.checked,
                                guestsCanSeeOtherGuests: guestsCanSeeCheck.checked })
    }

    function validStatusProperties() {
        return statusEditor.validProperties()
    }

    function busyIntervalCount() {
        return freeBusyIntervals === null ? 0 : freeBusyIntervals.length
    }

    function recurrenceSummary() {
        const match = /(?:^|\n)RRULE:([^\n]+)/.exec(recurrenceRuleField.text.trim())
        if (match === null) return ""
        const frequency = /(?:^|;)FREQ=([A-Z]+)(?:;|$)/.exec(match[1])
        const interval = /(?:^|;)INTERVAL=(\d+)(?:;|$)/.exec(match[1])
        if (frequency === null) return "Google will validate this recurrence rule"
        const unit = frequency[1].toLowerCase().slice(0, -2)
        return interval !== null && interval[1] !== "1" ? "Repeats every " + interval[1] + " " + unit + "s"
                                                         : "Repeats " + unit + "ly"
    }

    function roundedStartAt() {
        const now = new Date()
        now.setUTCMinutes(0, 0, 0)
        return now.toISOString()
    }

    function startForDate(date) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return roundedStartAt()
        }
        const local = new Date(date + "T09:00:00")
        return Number.isFinite(local.getTime()) ? local.toISOString() : roundedStartAt()
    }

    function openForCreate(calendarId, date) {
        eventCalendarId = calendarId
        titleField.clear()
        allDayCheck.checked = false
        startField.text = startForDate(date || "")
        endField.text = new Date(Date.parse(startField.text) + 60 * 60 * 1000).toISOString()
        descriptionField.clear()
        locationField.clear()
        timeZoneField.clear()
        colorIdField.clear()
        availableCheck.checked = false
        visibilityPicker.currentIndex = visibilityPicker.indexOfValue("default")
        attendeeField.clear()
        defaultRemindersCheck.checked = true
        reminderField.clear()
        recurrenceRuleField.clear()
        recurrencePresetPicker.currentIndex = 0
        googleMeetCheck.checked = false
        attachmentModel.clear()
        guestPermissionsCustomized = false
        guestsCanInviteCheck.checked = true
        guestsCanModifyCheck.checked = false
        guestsCanSeeCheck.checked = true
        sendUpdatesPicker.currentIndex = sendUpdatesPicker.indexOfValue("all")
        eventTypePicker.currentIndex = eventTypePicker.indexOfValue("default")
        statusEditor.resetForEventType()
        calendarPicker.currentIndex = calendarPicker.indexOfValue(calendarId)
        open()
    }

    onOpened: titleField.forceActiveFocus()
    onPrimaryAction: {
        eventCreateRequested(eventCalendarId, titleField.text.trim(), startField.text,
                             endField.text, allDayCheck.checked, descriptionField.text,
                             locationField.text, timeZoneField.text.trim(), colorIdField.text.trim(),
                             availableCheck.checked, visibilityPicker.currentValue, attendeeValues(),
                             defaultRemindersCheck.checked, reminderValues(), recurrenceRuleField.text)
        richEventCreateRequested(eventCalendarId, titleField.text.trim(), startField.text,
                                          endField.text, allDayCheck.checked, descriptionField.text,
                                          locationField.text, timeZoneField.text.trim(),
                                          colorIdField.text.trim(), availableCheck.checked,
                                          visibilityPicker.currentValue, attendeeValues(),
                                          defaultRemindersCheck.checked, reminderValues(),
                                          recurrenceRuleField.text, googleMeetCheck.checked,
                                          attachmentsJson(), guestPermissionsJson(),
                                          eventTypePicker.currentValue, statusEditor.propertiesJson,
                                          sendUpdatesPicker.currentValue)
    }

    TextField {
        id: titleField
        Layout.fillWidth: true
        placeholderText: "Event title"
        Accessible.name: "Event title"
        selectByMouse: true
        Keys.onReturnPressed: {
            if (root.primaryEnabled) {
                root.primaryButton.click()
            }
        }
    }

    CheckBox {
        id: googleMeetCheck
        text: "Add Google Meet"
        Accessible.name: text
    }

    Button {
        Layout.fillWidth: true
        text: "Check availability"
        enabled: root.eventCalendarId.length > 0 && root.validRange()
        onClicked: root.availabilityRequested([root.eventCalendarId], startField.text, endField.text)
    }

    Label {
        Layout.fillWidth: true
        visible: root.freeBusyIntervals && root.freeBusyIntervals.length > 0
        text: root.busyIntervalCount() + " busy interval(s) in this range"
        color: Theme.textSecondary
    }

    ComboBox {
        id: eventTypePicker
        Layout.fillWidth: true
        model: [{ text: "Standard event", value: "default" },
                { text: "Focus time", value: "focusTime" },
                { text: "Out of office", value: "outOfOffice" },
                { text: "Working location", value: "workingLocation" }]
        textRole: "text"
        valueRole: "value"
        Accessible.name: "Event type"
    }

    StatusEventPropertiesEditor {
        id: statusEditor
        Layout.fillWidth: true
        eventType: eventTypePicker.currentValue
    }

    CheckBox {
        id: guestsCanInviteCheck
        text: "Guests can invite others"
        Accessible.name: text
        onClicked: root.guestPermissionsCustomized = true
    }

    CheckBox {
        id: guestsCanModifyCheck
        text: "Guests can modify event"
        Accessible.name: text
        onClicked: root.guestPermissionsCustomized = true
    }

    CheckBox {
        id: guestsCanSeeCheck
        text: "Guests can see guest list"
        Accessible.name: text
        onClicked: root.guestPermissionsCustomized = true
    }

    ComboBox {
        id: sendUpdatesPicker
        Layout.fillWidth: true
        model: [{ text: "Notify all guests", value: "all" },
                { text: "Notify external guests", value: "externalOnly" },
                { text: "Do not notify guests", value: "none" }]
        textRole: "text"
        valueRole: "value"
        Accessible.name: "Guest notifications"
    }

    TextField {
        id: driveSearchField
        Layout.fillWidth: true
        placeholderText: "Search Google Drive attachments"
        Accessible.name: "Search Google Drive attachments"
        selectByMouse: true
        onAccepted: root.driveSearchRequested(text)
    }

    Repeater {
        model: root.driveAttachmentCandidates
        delegate: Button {
            required property var modelData
            Layout.fillWidth: true
            text: "Attach " + modelData.name
            onClicked: attachmentModel.append({ fileUrl: modelData.fileUrl, title: modelData.name,
                                                 mimeType: modelData.mimeType })
        }
    }

    Repeater {
        model: attachmentModel
        delegate: Button {
            required property string title
            required property int index
            Layout.fillWidth: true
            text: "Remove attachment: " + title
            onClicked: attachmentModel.remove(index)
        }
    }

    TextField {
        id: timeZoneField
        Layout.fillWidth: true
        placeholderText: "Time zone (IANA, optional)"
        Accessible.name: "Event time zone"
        selectByMouse: true
    }

    TextField {
        id: colorIdField
        Layout.fillWidth: true
        placeholderText: "Google color ID (optional)"
        Accessible.name: "Event color"
        selectByMouse: true
    }

    CheckBox {
        id: availableCheck
        text: "Show as available"
        Accessible.name: text
    }

    ComboBox {
        id: visibilityPicker
        Layout.fillWidth: true
        model: [{ text: "Default", value: "default" }, { text: "Public", value: "public" },
                { text: "Private", value: "private" }, { text: "Confidential", value: "confidential" }]
        textRole: "text"
        valueRole: "value"
        Accessible.name: "Event visibility"
    }

    TextField {
        id: attendeeField
        Layout.fillWidth: true
        placeholderText: "Guests (comma-separated email addresses)"
        Accessible.name: "Event guests"
        selectByMouse: true
    }

    CheckBox {
        id: defaultRemindersCheck
        text: "Use calendar default reminders"
        Accessible.name: text
    }

    TextField {
        id: reminderField
        Layout.fillWidth: true
        enabled: !defaultRemindersCheck.checked
        placeholderText: "Custom reminders, e.g. popup:10, email:60"
        Accessible.name: "Event custom reminders"
        selectByMouse: true
    }

    ComboBox {
        id: recurrencePresetPicker
        Layout.fillWidth: true
        model: [{ text: "Custom / none", value: "" },
                { text: "Daily", value: "RRULE:FREQ=DAILY" },
                { text: "Weekdays", value: "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" },
                { text: "Weekly", value: "RRULE:FREQ=WEEKLY" },
                { text: "Monthly", value: "RRULE:FREQ=MONTHLY" },
                { text: "Yearly", value: "RRULE:FREQ=YEARLY" }]
        textRole: "text"
        valueRole: "value"
        Accessible.name: "Recurrence preset"
        onActivated: {
            if (currentValue.length > 0) recurrenceRuleField.text = currentValue
        }
    }

    TextArea {
        id: recurrenceRuleField
        Layout.fillWidth: true
        Layout.preferredHeight: 84
        placeholderText: "Repeat rule, e.g. RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR"
        Accessible.name: "Event recurrence rule"
        Accessible.description: "Optional Google Calendar RFC 5545 lines; presets replace this text"
        selectByMouse: true
        wrapMode: TextEdit.Wrap
    }

    Label {
        Layout.fillWidth: true
        visible: root.recurrenceSummary().length > 0
        text: root.recurrenceSummary()
        color: Theme.textSecondary
        wrapMode: Text.WordWrap
        Accessible.name: "Recurrence summary: " + text
    }

    ComboBox {
        id: calendarPicker
        Layout.fillWidth: true
        model: root.calendarSourceModel
        textRole: "title"
        valueRole: "id"
        Accessible.name: "Event calendar"
        onCurrentValueChanged: root.eventCalendarId = currentValue || ""
    }

    CheckBox {
        id: allDayCheck
        text: "All day"
        Accessible.name: text
    }

    TextField {
        id: startField
        Layout.fillWidth: true
        placeholderText: "Start (ISO 8601)"
        Accessible.name: "Event starts"
        selectByMouse: true
    }

    TextField {
        id: endField
        Layout.fillWidth: true
        placeholderText: "End (ISO 8601)"
        Accessible.name: "Event ends"
        selectByMouse: true
    }

    TextField {
        id: locationField
        Layout.fillWidth: true
        placeholderText: "Location"
        Accessible.name: "Event location"
        selectByMouse: true
    }

    TextArea {
        id: descriptionField
        Layout.fillWidth: true
        Layout.preferredHeight: 160
        placeholderText: "Description"
        Accessible.name: "Event description"
        selectByMouse: true
        wrapMode: TextEdit.Wrap
    }
}
