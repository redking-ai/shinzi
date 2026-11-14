package com.shinzi.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
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

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.Map;

@CapacitorPlugin(name = "ShinziNotification")
public class ShinziNotificationPlugin extends Plugin {
    public static final String CHANNEL_ID = "shinzi_messages";
    private static final String CHANNEL_NAME = "Direct Messages";
    private static ShinziNotificationPlugin instance;

    // Cache message history per conversation for multi-message stacked display
    private static final Map<String, NotificationCompat.MessagingStyle> conversationStyles = new HashMap<>();

    @Override
    public void load() {
        super.load();
        instance = this;
        createNotificationChannel(getContext());
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

        showNotificationNative(getContext(), senderName, text, avatarUrl, convId);
        call.resolve(new JSObject().put("success", true));
    }

    public static void showNotificationNative(
            Context context,
            String senderName,
            String text,
            String avatarUrl,
            String convId
    ) {
        createNotificationChannel(context);
        int notificationId = convId.hashCode();

        new Thread(() -> {
            try {
                // 1. Fetch or generate circular avatar bitmap
                Bitmap avatarBitmap = null;
                if (avatarUrl != null && !avatarUrl.isEmpty() && avatarUrl.startsWith("http")) {
                    try {
                        URL url = new URL(avatarUrl);
                        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                        conn.setDoInput(true);
                        conn.setConnectTimeout(3000);
                        conn.setReadTimeout(3000);
                        conn.connect();
                        InputStream input = conn.getInputStream();
                        Bitmap raw = BitmapFactory.decodeStream(input);
                        if (raw != null) {
                            avatarBitmap = getCircularBitmap(raw);
                        }
                    } catch (Exception ignored) {}
                }

                if (avatarBitmap == null) {
                    avatarBitmap = createInitialAvatar(senderName);
                }

                // 2. Build Sender Person
                Person.Builder personBuilder = new Person.Builder()
                        .setName(senderName)
                        .setKey(senderName);
                if (avatarBitmap != null) {
                    personBuilder.setIcon(IconCompat.createWithBitmap(avatarBitmap));
                }
                Person senderPerson = personBuilder.build();

                // 3. User (Recipient) Person
                Person mePerson = new Person.Builder()
                        .setName("You")
                        .build();

                // 4. MessagingStyle (Supports multi-message vertical stacking)
                NotificationCompat.MessagingStyle style = conversationStyles.get(convId);
                if (style == null) {
                    style = new NotificationCompat.MessagingStyle(mePerson)
                            .setConversationTitle(senderName);
                    conversationStyles.put(convId, style);
                }
                style.addMessage(text, System.currentTimeMillis(), senderPerson);

                // 5. Inline RemoteInput Reply Action
                RemoteInput remoteInput = new RemoteInput.Builder(ReplyReceiver.KEY_TEXT_REPLY)
                        .setLabel("Reply")
                        .build();

                Intent replyIntent = new Intent(context, ReplyReceiver.class);
                replyIntent.setAction(ReplyReceiver.ACTION_REPLY);
                replyIntent.putExtra("notificationId", notificationId);
                replyIntent.putExtra("convId", convId);
                replyIntent.putExtra("senderName", senderName);

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

                NotificationCompat.Action replyAction = new NotificationCompat.Action.Builder(
                        R.drawable.ic_stat_shinzi,
                        "Reply",
                        replyPendingIntent
                )
                        .addRemoteInput(remoteInput)
                        .setAllowGeneratedReplies(true)
                        .build();

                // 6. Open App Intent on tap
                Intent openIntent = new Intent(context, MainActivity.class);
                openIntent.setAction(Intent.ACTION_VIEW);
                openIntent.setData(Uri.parse("https://shinzi.vercel.app/?conv=" + convId));
                openIntent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);

                PendingIntent contentPendingIntent = PendingIntent.getActivity(
                        context,
                        notificationId,
                        openIntent,
                        flags
                );

                // 7. Assemble NotificationCompat (Avatar placed on LEFT via Person icon in MessagingStyle)
                NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
                        .setSmallIcon(R.drawable.ic_stat_shinzi)
                        .setStyle(style)
                        .setContentIntent(contentPendingIntent)
                        .addAction(replyAction)
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
