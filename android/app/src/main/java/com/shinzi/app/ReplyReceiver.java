package com.shinzi.app;

import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import androidx.core.app.NotificationCompat;
import androidx.core.app.Person;
import androidx.core.app.RemoteInput;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

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
            String senderUid = intent.getStringExtra("senderUid");

            if (replyText != null && replyText.length() > 0 && convId != null) {
                final String text = replyText.toString();
                SharedPreferences prefs = context.getSharedPreferences("shinzi_prefs", Context.MODE_PRIVATE);
                final String myUid = prefs.getString("current_uid", "");
                final String myName = prefs.getString("current_name", "You");

                // 1. Post reply to Firestore via backend API
                new Thread(() -> {
                    try {
                        URL url = new URL("https://shinzi.vercel.app/api/send-reply");
                        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                        conn.setRequestMethod("POST");
                        conn.setRequestProperty("Content-Type", "application/json");
                        conn.setConnectTimeout(5000);
                        conn.setReadTimeout(5000);
                        conn.setDoOutput(true);

                        JSONObject payload = new JSONObject();
                        payload.put("convId", convId);
                        payload.put("text", text);
                        payload.put("senderUid", myUid);
                        payload.put("senderName", myName);

                        OutputStream os = conn.getOutputStream();
                        os.write(payload.toString().getBytes(StandardCharsets.UTF_8));
                        os.close();
                        conn.getResponseCode();
                    } catch (Exception e) {
                        e.printStackTrace();
                    }
                }).start();

                // 2. Notify active web plugin if app is running in foreground
                ShinziNotificationPlugin.notifyReplyReceived(convId, text);

                // 3. Keep existing conversation history & append user's reply cleanly
                Person mePerson = new Person.Builder().setName("You").build();
                NotificationCompat.MessagingStyle style = ShinziNotificationPlugin.getConversationStyles().get(convId);
                if (style == null) {
                    style = new NotificationCompat.MessagingStyle(mePerson);
                    ShinziNotificationPlugin.getConversationStyles().put(convId, style);
                }
                style.addMessage(text, System.currentTimeMillis(), mePerson);

                Intent openIntent = new Intent(context, MainActivity.class);
                openIntent.setAction(Intent.ACTION_VIEW);
                String openUrl = "https://shinzi.vercel.app/chat?conv=" + convId;
                if (senderUid != null && !senderUid.isEmpty()) {
                    openUrl += "&user=" + senderUid;
                }
                openIntent.setData(Uri.parse(openUrl));
                openIntent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);

                int flags = PendingIntent.FLAG_UPDATE_CURRENT;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    flags |= PendingIntent.FLAG_MUTABLE;
                }

                PendingIntent contentPendingIntent = PendingIntent.getActivity(
                        context,
                        notificationId,
                        openIntent,
                        flags
                );

                NotificationCompat.Builder repliedNotification = new NotificationCompat.Builder(context, ShinziNotificationPlugin.CHANNEL_ID)
                        .setSmallIcon(R.drawable.ic_stat_shinzi)
                        .setStyle(style)
                        .setContentIntent(contentPendingIntent)
                        .setPriority(NotificationCompat.PRIORITY_MAX)
                        .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                        .setAutoCancel(true);

                NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
                if (manager != null) {
                    manager.notify(notificationId, repliedNotification.build());
                }
            }
        }
    }
}
