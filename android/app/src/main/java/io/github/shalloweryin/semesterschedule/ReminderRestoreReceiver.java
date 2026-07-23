package io.github.shalloweryin.semesterschedule;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Restores persisted exact alarms after reboot, clock changes, timezone changes, or an APK update. */
public class ReminderRestoreReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        ReminderSupportPlugin.ensureChannel(context);
        ReminderAlarmReceiver.restore(context);
    }
}
