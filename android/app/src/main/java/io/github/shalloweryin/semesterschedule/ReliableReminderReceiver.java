package io.github.shalloweryin.semesterschedule;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Receives the notification-free reliable-reminder watchdog heartbeat. */
public class ReliableReminderReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        ReliableReminderService.onHeartbeat(context);
    }
}
