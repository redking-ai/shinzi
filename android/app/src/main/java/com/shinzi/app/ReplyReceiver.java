package com.shinzi.app;

import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import androidx.core.app.NotificationCompat;
import androidx.core.app.Person;
import androidx.core.app.RemoteInput;
import androidx.core.graphics.drawable.IconCompat;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.List;

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
            if (senderName == null || senderName.isEmpty()) senderName = "Friend";
            String senderUid = intent.getStringExtra("senderUid");
            if (senderUid == null) senderUid = "";

            if (replyText != null && replyText.length() > 0 && convId != null) {
                final String text = replyText.toString();
                SharedPreferences prefs = context.getSharedPreferences("shinzi_prefs", Context.MODE_PRIVATE);
                final String myUid = prefs.getString("current_uid", "");
                final String myName = prefs.getString("current_name", "You");

                // 1. Post reply to Firestore via backend API
                final String finalSenderUid = senderUid;
                final String finalSenderName = senderName;
                new Thread(() -> {
                    try {
                        URL url = new URL("https://shinzi.vercel.app/api/send-push");
                        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                        conn.setRequestMethod("POST");
                        conn.setRequestProperty("Content-Type", "application/json");
                        conn.setConnectTimeout(5000);
                        conn.setReadTimeout(5000);
                        conn.setDoOutput(true);

                        JSONObject payload = new JSONObject();
                        payload.put("action", "reply");
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

                // 3. Deduplicate & append user's reply to conversation history
                List<ShinziNotificationPlugin.HistoryMessage> history = ShinziNotificationPlugin.loadHistory(context, convId);
                if (!history.isEmpty()) {
                    ShinziNotificationPlugin.HistoryMessage last = history.get(history.size() - 1);
                    if (last.text != null && last.text.equals(text) && last.isMe && (System.currentTimeMillis() - last.time < 4000)) {
                        return;
                    }
                }
                history.add(new ShinziNotificationPlugin.HistoryMessage(myName, text, System.currentTimeMillis(), true));
                if (history.size() > 12) {
                    history = history.subList(history.size() - 12, history.size());
                }
                ShinziNotificationPlugin.saveHistory(context, convId, history);

                // 4. Retrieve cached large sender avatar
                Bitmap avatarBitmap = ShinziNotificationPlugin.getCachedAvatar(context, convId, finalSenderName);

                // 5. Build Person objects
                Person.Builder personBuilder = new Person.Builder()
                        .setName(finalSenderName)
                        .setKey(finalSenderName);
                if (avatarBitmap != null) {
                    personBuilder.setIcon(IconCompat.createWithBitmap(avatarBitmap));
                }
                Person senderPerson = personBuilder.build();

                // 1x1 transparent icon so Android SystemUI does not draw the gray silhouette avatar
                Bitmap transparentPixel = Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888);
                Person mePerson = new Person.Builder()
                        .setName("You")
                        .setIcon(IconCompat.createWithBitmap(transparentPixel))
                        .build();

                // 6. Build MessagingStyle keeping full conversation history
                NotificationCompat.MessagingStyle style = new NotificationCompat.MessagingStyle(mePerson);
                style.setConversationTitle(null);
                style.setGroupConversation(false);

                for (ShinziNotificationPlugin.HistoryMessage msg : history) {
                    if (msg.isMe) {
                        // Null Person renders message cleanly as "You: <text>" without circular avatar
                        style.addMessage(msg.text, msg.time, (Person) null);
                    } else {
                        style.addMessage(msg.text, msg.time, senderPerson);
                    }
                }

                // 7. Retain the "Reply" button so the user can send multiple consecutive replies!
                NotificationCompat.Action replyAction = ShinziNotificationPlugin.createReplyAction(
                        context,
                        notificationId,
                        convId,
                        finalSenderName,
                        finalSenderUid
                );

                // 8. Content Intent on tap (opens specific chat)
                Intent openIntent = new Intent(context, MainActivity.class);
                openIntent.setAction(Intent.ACTION_VIEW);
                String openUrl = "https://shinzi.vercel.app/chat?conv=" + convId;
                if (!finalSenderUid.isEmpty()) {
                    openUrl += "&user=" + finalSenderUid;
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

                // 9. Update notification with single sender avatar on the left, clean "You: <reply>", and persistent reply button
                NotificationCompat.Builder repliedNotification = new NotificationCompat.Builder(context, ShinziNotificationPlugin.CHANNEL_ID)
                        .setSmallIcon(R.drawable.ic_stat_shinzi)
                        .setStyle(style)
                        .setContentIntent(contentPendingIntent)
                        .addAction(replyAction) // Allows user to send multiple replies without losing the input action
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
