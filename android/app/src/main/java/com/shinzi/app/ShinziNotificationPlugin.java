package com.shinzi.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.PorterDuff;
import android.graphics.PorterDuffXfermode;
import android.graphics.Rect;
import android.net.Uri;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.Person;
import androidx.core.app.RemoteInput;
import androidx.core.graphics.drawable.IconCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@CapacitorPlugin(name = "ShinziNotification")
public class ShinziNotificationPlugin extends Plugin {
    public static final String CHANNEL_ID = "shinzi_messages";
    private static final String CHANNEL_NAME = "Direct Messages";
    private static ShinziNotificationPlugin instance;

    // Track app foreground and active conversation
    public static volatile boolean isAppForeground = false;
    public static volatile String activeConversationId = null;

    // Cache circular avatar bitmaps in memory
    private static final Map<String, Bitmap> cachedAvatars = new ConcurrentHashMap<>();

    public static class HistoryMessage {
        public String sender;
        public String text;
        public long time;
        public boolean isMe;

        public HistoryMessage(String sender, String text, long time, boolean isMe) {
            this.sender = sender;
            this.text = text;
            this.time = time;
            this.isMe = isMe;
        }
    }

    @Override
    public void load() {
        super.load();
        instance = this;
        createNotificationChannel(getContext());
    }

    @PluginMethod
    public void setActiveConversation(PluginCall call) {
        String convId = call.getString("convId", null);
        activeConversationId = (convId != null && !convId.isEmpty()) ? convId : null;
        call.resolve();
    }

    @PluginMethod
    public void clearConversationNotification(PluginCall call) {
        String convId = call.getString("convId", "");
        if (!convId.isEmpty()) {
            NotificationManagerCompat manager = NotificationManagerCompat.from(getContext());
            manager.cancel(convId.hashCode());
            clearHistory(getContext(), convId);
        }
        call.resolve();
    }

    @PluginMethod
    public void setCurrentUser(PluginCall call) {
        String uid = call.getString("uid", "");
        String name = call.getString("name", "You");
        getContext().getSharedPreferences("shinzi_prefs", Context.MODE_PRIVATE)
                .edit()
                .putString("current_uid", uid)
                .putString("current_name", name)
                .apply();
        call.resolve();
    }

    public static void notifyReplyReceived(String convId, String replyText) {
        if (instance != null) {
            JSObject data = new JSObject();
            data.put("convId", convId);
            data.put("replyText", replyText);
            instance.notifyListeners("onNotificationReply", data);
        }
    }

    public static void notifyTokenRefresh(String token) {
        if (instance != null) {
            JSObject data = new JSObject();
            data.put("token", token);
            instance.notifyListeners("onFcmToken", data);
        }
    }

    @PluginMethod
    public void getFcmToken(PluginCall call) {
        com.google.firebase.messaging.FirebaseMessaging.getInstance().getToken()
                .addOnCompleteListener(task -> {
                    JSObject ret = new JSObject();
                    if (task.isSuccessful() && task.getResult() != null) {
                        String token = task.getResult();
                        getContext().getSharedPreferences("shinzi_prefs", Context.MODE_PRIVATE)
                                .edit()
                                .putString("fcm_token", token)
                                .apply();
                        ret.put("token", token);
                    } else {
                        String cached = getContext().getSharedPreferences("shinzi_prefs", Context.MODE_PRIVATE)
                                .getString("fcm_token", null);
                        ret.put("token", cached);
                    }
                    call.resolve(ret);
                });
    }

    public static void createNotificationChannel(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    CHANNEL_NAME,
                    NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("Incoming chat messages with instant reply");
            channel.enableVibration(true);
            channel.setShowBadge(true);
            channel.setLockscreenVisibility(NotificationCompat.VISIBILITY_PUBLIC);

            NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    @PluginMethod
    public void showMessagingNotification(PluginCall call) {
        String senderName = call.getString("senderName", "Friend");
        String text = call.getString("text", "");
        String avatarUrl = call.getString("avatarUrl", "");
        String convId = call.getString("convId", "default");
        String senderUid = call.getString("senderUid", "");

        showNotificationNative(getContext(), senderName, text, avatarUrl, convId, senderUid);
        call.resolve(new JSObject().put("success", true));
    }

    public static void showNotificationNative(
            Context context,
            String senderName,
            String text,
            String avatarUrl,
            String convId
    ) {
        showNotificationNative(context, senderName, text, avatarUrl, convId, "");
    }

    public static void showNotificationNative(
            Context context,
            String senderName,
            String text,
            String avatarUrl,
            String convId,
            String senderUid
    ) {
        createNotificationChannel(context);
        int notificationId = convId.hashCode();

        new Thread(() -> {
            try {
                // 1. Deduplicate & append incoming message to conversation history (limit to last 12 messages)
                List<HistoryMessage> history = loadHistory(context, convId);
                if (!history.isEmpty()) {
                    HistoryMessage last = history.get(history.size() - 1);
                    if (last.text != null && last.text.equals(text) && !last.isMe && (System.currentTimeMillis() - last.time < 4000)) {
                        // Suppress duplicate push event
                        return;
                    }
                }
                history.add(new HistoryMessage(senderName, text, System.currentTimeMillis(), false));
                if (history.size() > 12) {
                    history = history.subList(history.size() - 12, history.size());
                }
                saveHistory(context, convId, history);

                // 2. Fetch or retrieve large circular sender avatar
                Bitmap avatarBitmap = fetchCircularAvatar(context, avatarUrl, senderName, convId);

                // 3. Sender Person with circular avatar
                Person.Builder personBuilder = new Person.Builder()
                        .setName(senderName)
                        .setKey(senderName);
                if (avatarBitmap != null) {
                    personBuilder.setIcon(IconCompat.createWithBitmap(avatarBitmap));
                }
                Person senderPerson = personBuilder.build();

                // 4. User Person ("You") with 1x1 transparent icon so Android SystemUI does not draw a gray silhouette icon!
                Bitmap transparentPixel = Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888);
                Person mePerson = new Person.Builder()
                        .setName("You")
                        .setIcon(IconCompat.createWithBitmap(transparentPixel))
                        .build();

                // 5. Build MessagingStyle populated with all stacked history messages
                NotificationCompat.MessagingStyle style = new NotificationCompat.MessagingStyle(mePerson);
                style.setConversationTitle(null); // Direct chat format (shows sender name & avatar on the left)
                style.setGroupConversation(false);

                for (HistoryMessage msg : history) {
                    if (msg.isMe) {
                        // Pass (Person) null so Android renders "You: <text>" cleanly without avatar bubble
                        style.addMessage(msg.text, msg.time, (Person) null);
                    } else {
                        style.addMessage(msg.text, msg.time, senderPerson);
                    }
                }

                // 6. Inline RemoteInput Reply Action (keeps Reply button on notification)
                NotificationCompat.Action replyAction = createReplyAction(context, notificationId, convId, senderName, senderUid);

                // 7. Content Intent on tap (opens specific chat)
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

                // 8. Assemble NotificationCompat.
                // Note: builder.setLargeIcon is REMOVED so Android does NOT place a duplicate avatar on the right side!
                // The circular avatar is displayed on the left next to sender messages via senderPerson.
                NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
                        .setSmallIcon(R.drawable.ic_stat_shinzi)
                        .setStyle(style)
                        .setContentIntent(contentPendingIntent)
                        .addAction(replyAction) // Reply action button
                        .setPriority(NotificationCompat.PRIORITY_MAX)
                        .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                        .setAutoCancel(true)
                        .setDefaults(NotificationCompat.DEFAULT_ALL)
                        .setWhen(System.currentTimeMillis())
                        .setShowWhen(true);

                NotificationManagerCompat notificationManager = NotificationManagerCompat.from(context);
                notificationManager.notify(notificationId, builder.build());
            } catch (Exception e) {
                e.printStackTrace();
            }
        }).start();
    }

    public static NotificationCompat.Action createReplyAction(
            Context context,
            int notificationId,
            String convId,
            String senderName,
            String senderUid
    ) {
        RemoteInput remoteInput = new RemoteInput.Builder(ReplyReceiver.KEY_TEXT_REPLY)
                .setLabel("Reply")
                .build();

        Intent replyIntent = new Intent(context, ReplyReceiver.class);
        replyIntent.setAction(ReplyReceiver.ACTION_REPLY);
        replyIntent.putExtra("notificationId", notificationId);
        replyIntent.putExtra("convId", convId);
        replyIntent.putExtra("senderName", senderName);
        replyIntent.putExtra("senderUid", senderUid);

        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            flags |= PendingIntent.FLAG_MUTABLE;
        }

        PendingIntent replyPendingIntent = PendingIntent.getBroadcast(
                context,
                notificationId,
                replyIntent,
                flags
        );

        return new NotificationCompat.Action.Builder(
                R.drawable.ic_stat_shinzi,
                "Reply",
                replyPendingIntent
        )
                .addRemoteInput(remoteInput)
                .setAllowGeneratedReplies(true)
                .build();
    }

    public static Bitmap fetchCircularAvatar(Context context, String avatarUrl, String senderName, String convId) {
        if (avatarUrl != null && !avatarUrl.isEmpty()) {
            if (avatarUrl.startsWith("/")) {
                avatarUrl = "https://shinzi.vercel.app" + avatarUrl;
            }
        }

        // Check memory cache
        if (cachedAvatars.containsKey(convId)) {
            return cachedAvatars.get(convId);
        }

        // Check local disk cache
        File diskCache = new File(context.getCacheDir(), "avatar_" + Math.abs(convId.hashCode()) + ".png");
        if (diskCache.exists()) {
            try {
                Bitmap cached = BitmapFactory.decodeFile(diskCache.getAbsolutePath());
                if (cached != null) {
                    cachedAvatars.put(convId, cached);
                    return cached;
                }
            } catch (Exception ignored) {}
        }

        Bitmap avatarBitmap = null;
        if (avatarUrl != null && !avatarUrl.isEmpty() && avatarUrl.startsWith("http")) {
            try {
                String currentUrl = avatarUrl;
                HttpURLConnection conn = null;
                // Follow up to 4 HTTP/HTTPS cross-protocol redirects
                for (int redirect = 0; redirect < 4; redirect++) {
                    URL url = new URL(currentUrl);
                    conn = (HttpURLConnection) url.openConnection();
                    conn.setInstanceFollowRedirects(true);
                    conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android) ShinziMobile");
                    conn.setConnectTimeout(4500);
                    conn.setReadTimeout(4500);
                    int status = conn.getResponseCode();
                    if (status == HttpURLConnection.HTTP_MOVED_TEMP
                            || status == HttpURLConnection.HTTP_MOVED_PERM
                            || status == HttpURLConnection.HTTP_SEE_OTHER
                            || status == 307 || status == 308) {
                        String newLocation = conn.getHeaderField("Location");
                        if (newLocation != null && !newLocation.isEmpty()) {
                            currentUrl = newLocation;
                            continue;
                        }
                    }
                    break;
                }

                if (conn != null) {
                    InputStream in = conn.getInputStream();
                    ByteArrayOutputStream buffer = new ByteArrayOutputStream();
                    byte[] chunk = new byte[8192];
                    int bytesRead;
                    while ((bytesRead = in.read(chunk, 0, chunk.length)) != -1) {
                        buffer.write(chunk, 0, bytesRead);
                    }
                    buffer.flush();
                    byte[] imageBytes = buffer.toByteArray();
                    in.close();

                    if (imageBytes.length > 0) {
                        // Decodes first frame of animated GIFs as static preview, or JPEG/PNG/WebP
                        Bitmap raw = BitmapFactory.decodeByteArray(imageBytes, 0, imageBytes.length);
                        if (raw != null) {
                            avatarBitmap = getCircularBitmap(raw);
                            // Persist to disk cache
                            try (FileOutputStream fos = new FileOutputStream(diskCache)) {
                                avatarBitmap.compress(Bitmap.CompressFormat.PNG, 95, fos);
                            } catch (Exception ignored) {}
                        }
                    }
                }
            } catch (Exception ignored) {}
        }

        if (avatarBitmap == null) {
            avatarBitmap = createInitialAvatar(senderName);
        }

        cachedAvatars.put(convId, avatarBitmap);
        return avatarBitmap;
    }

    public static Bitmap getCachedAvatar(Context context, String convId, String senderName) {
        if (cachedAvatars.containsKey(convId)) {
            return cachedAvatars.get(convId);
        }
        File diskCache = new File(context.getCacheDir(), "avatar_" + Math.abs(convId.hashCode()) + ".png");
        if (diskCache.exists()) {
            try {
                Bitmap cached = BitmapFactory.decodeFile(diskCache.getAbsolutePath());
                if (cached != null) {
                    cachedAvatars.put(convId, cached);
                    return cached;
                }
            } catch (Exception ignored) {}
        }
        return createInitialAvatar(senderName);
    }

    public static synchronized List<HistoryMessage> loadHistory(Context context, String convId) {
        List<HistoryMessage> list = new ArrayList<>();
        try {
            SharedPreferences sp = context.getSharedPreferences("shinzi_conv_history", Context.MODE_PRIVATE);
            String jsonStr = sp.getString(convId, null);
            if (jsonStr != null && !jsonStr.isEmpty()) {
                JSONArray arr = new JSONArray(jsonStr);
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject obj = arr.getJSONObject(i);
                    list.add(new HistoryMessage(
                            obj.optString("sender", "Friend"),
                            obj.optString("text", ""),
                            obj.optLong("time", System.currentTimeMillis()),
                            obj.optBoolean("isMe", false)
                    ));
                }
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
        return list;
    }

    public static synchronized void saveHistory(Context context, String convId, List<HistoryMessage> list) {
        try {
            JSONArray arr = new JSONArray();
            for (HistoryMessage m : list) {
                JSONObject obj = new JSONObject();
                obj.put("sender", m.sender);
                obj.put("text", m.text);
                obj.put("time", m.time);
                obj.put("isMe", m.isMe);
                arr.put(obj);
            }
            context.getSharedPreferences("shinzi_conv_history", Context.MODE_PRIVATE)
                    .edit()
                    .putString(convId, arr.toString())
                    .apply();
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    public static synchronized void clearHistory(Context context, String convId) {
        try {
            context.getSharedPreferences("shinzi_conv_history", Context.MODE_PRIVATE)
                    .edit()
                    .remove(convId)
                    .apply();
        } catch (Exception ignored) {}
    }

    private static Bitmap getCircularBitmap(Bitmap bitmap) {
        int size = Math.min(bitmap.getWidth(), bitmap.getHeight());
        Bitmap output = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(output);

        final Paint paint = new Paint();
        final Rect rect = new Rect(0, 0, size, size);

        paint.setAntiAlias(true);
        canvas.drawARGB(0, 0, 0, 0);
        paint.setColor(Color.WHITE);
        canvas.drawCircle(size / 2f, size / 2f, size / 2f, paint);
        paint.setXfermode(new PorterDuffXfermode(PorterDuff.Mode.SRC_IN));
        canvas.drawBitmap(bitmap, rect, rect, paint);
        return output;
    }

    private static Bitmap createInitialAvatar(String name) {
        int size = 128;
        Bitmap bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);

        Paint bgPaint = new Paint();
        bgPaint.setAntiAlias(true);
        bgPaint.setColor(Color.parseColor("#5865F2"));
        canvas.drawCircle(size / 2f, size / 2f, size / 2f, bgPaint);

        String letter = (name != null && !name.isEmpty()) ? name.substring(0, 1).toUpperCase() : "S";
        Paint textPaint = new Paint();
        textPaint.setColor(Color.WHITE);
        textPaint.setTextSize(64);
        textPaint.setTextAlign(Paint.Align.CENTER);
        textPaint.setAntiAlias(true);

        Rect bounds = new Rect();
        textPaint.getTextBounds(letter, 0, letter.length(), bounds);
        float y = (size / 2f) + (bounds.height() / 2f);
        canvas.drawText(letter, size / 2f, y, textPaint);

        return bitmap;
    }
}
