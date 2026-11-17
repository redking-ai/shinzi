package com.shinzi.app;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;

public class CallActionReceiver extends BroadcastReceiver {
    public static final String ACTION_CALL_PICKUP = "com.shinzi.app.ACTION_CALL_PICKUP";
    public static final String ACTION_CALL_DECLINE = "com.shinzi.app.ACTION_CALL_DECLINE";
    public static final String ACTION_HANG_UP = "com.shinzi.app.ACTION_CALL_HANGUP";
    public static final String ACTION_SELF_MUTE = "com.shinzi.app.ACTION_CALL_SELF_MUTE";
    public static final String ACTION_MUTE_SOUND = "com.shinzi.app.ACTION_CALL_MUTE_SOUND";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        String action = intent.getAction();
        String callId = intent.getStringExtra("callId");
        int notifId = intent.getIntExtra("notificationId", 8888);

        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);

        switch (action) {
            case ACTION_CALL_PICKUP:
                ShinziNotificationPlugin.clearCallNotificationNative(context);
                if (nm != null) nm.cancel(notifId);
                ShinziNotificationPlugin.notifyCallAction("pickup", callId);
                try {
                    Intent launchIntent = new Intent(context, MainActivity.class);
                    launchIntent.setAction(Intent.ACTION_VIEW);
                    launchIntent.setData(Uri.parse("https://shinzi.vercel.app/call?id=" + (callId != null ? callId : "") + "&action=answer"));
                    launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                    context.startActivity(launchIntent);
                } catch (Exception e) {
                    e.printStackTrace();
                }
                break;

            case ACTION_CALL_DECLINE:
                ShinziNotificationPlugin.clearCallNotificationNative(context);
                if (nm != null) nm.cancel(notifId);
                ShinziNotificationPlugin.notifyCallAction("decline", callId);
                break;

            case ACTION_HANG_UP:
                ShinziNotificationPlugin.clearCallNotificationNative(context);
                if (nm != null) nm.cancel(notifId);
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
