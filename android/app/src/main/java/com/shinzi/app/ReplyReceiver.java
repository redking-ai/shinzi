package com.shinzi.app;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import androidx.core.app.NotificationCompat;
import androidx.core.app.Person;
import androidx.core.app.RemoteInput;

public class ReplyReceiver extends BroadcastReceiver {
    public static final String KEY_TEXT_REPLY = "key_text_reply";
    public static final String ACTION_REPLY = "com.shinzi.app.ACTION_REPLY";

    @Override
    public void onReceive(Context context, Intent intent) {
        Bundle remoteInput = RemoteInput.getResultsFromIntent(intent);
        if (remoteInput != null) {
            CharSequence replyText = remoteInput.getCharSequence(KEY_TEXT_REPLY);
            int notificationId = intent.getIntExtra("notificationId", 1001);
            String convId = intent.getStringExtra("convId");
            String senderName = intent.getStringExtra("senderName");

            if (replyText != null && replyText.length() > 0) {
                // Notify the active plugin if running
                ShinziNotificationPlugin.notifyReplyReceived(convId, replyText.toString());

                // Update notification with user's reply in MessagingStyle to give immediate feedback
                Person me = new Person.Builder().setName("You").build();
                NotificationCompat.MessagingStyle style = new NotificationCompat.MessagingStyle(me)
                        .setConversationTitle(senderName != null ? senderName : "Shinzi")
                        .addMessage(replyText.toString(), System.currentTimeMillis(), me);

                NotificationCompat.Builder repliedNotification = new NotificationCompat.Builder(context, ShinziNotificationPlugin.CHANNEL_ID)
                        .setSmallIcon(R.drawable.ic_stat_shinzi)
                        .setStyle(style)
                        .setContentText("Sent: " + replyText)
                        .setAutoCancel(true);

                NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
                if (manager != null) {
                    manager.notify(notificationId, repliedNotification.build());
                }
            }
        }
    }
}
