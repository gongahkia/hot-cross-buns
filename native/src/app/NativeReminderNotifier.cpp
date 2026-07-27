#include "app/NativeReminderNotifier.h"

namespace hcb {

NativeReminderNotifier::NativeReminderNotifier(QObject* parent) : QObject(parent) {}
NativeReminderNotifier::~NativeReminderNotifier() = default;

void NativeReminderNotifier::requestAuthorization() {
  emit statusChanged(QStringLiteral("Native calendar reminders are unavailable on this platform"));
}

void NativeReminderNotifier::schedule(NativeReminderNotification notification) { Q_UNUSED(notification); }
void NativeReminderNotifier::cancel(QString identifier) { Q_UNUSED(identifier); }
void NativeReminderNotifier::handleAction(QString identifier, ReminderAction action) {
  emit actionRequested(std::move(identifier), action);
}

} // namespace hcb
