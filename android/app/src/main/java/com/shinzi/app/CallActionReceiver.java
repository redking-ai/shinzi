package com.shinzi.app;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class CallActionReceiver extends BroadcastReceiver {
    public static final String ACTION_HANG_UP = "com.shinzi.app.ACTION_CALL_HANGUP";
    public static final String ACTION_SELF_MUTE = "com.shinzi.app.ACTION_CALL_SELF_MUTE";
    public static final String ACTION_MUTE_SOUND = "com.shinzi.app.ACTION_CALL_MUTE_SOUND";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        String action = intent.getAction();
        String callId = intent.getStringExtra("callId");

        switch (action) {
            case ACTION_HANG_UP:
                int notifId = intent.getIntExtra("notificationId", 9999);
                NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
                if (nm != null) {
                    nm.cancel(notifId);
                }
                ShinziNotificationPlugin.notifyCallAction("hangup", callId);
                break;

            case ACTION_SELF_MUTE:
                ShinziNotificationPlugin.notifyCallAction("self_mute", callId);
                break;

            case ACTION_MUTE_SOUND:
                ShinziNotificationPlugin.notifyCallAction("mute_sound", callId);
                break;
        }
    }
}
