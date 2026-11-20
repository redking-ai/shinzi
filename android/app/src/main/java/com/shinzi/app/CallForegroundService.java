package com.shinzi.app;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

public class CallForegroundService extends Service {
    public static final String ACTION_START_CALL = "com.shinzi.app.CALL_FOREGROUND_START";
    public static final String ACTION_STOP_CALL = "com.shinzi.app.CALL_FOREGROUND_STOP";
    public static final int NOTIF_ID = 8888;

    private static PowerManager.WakeLock sWakeLock = null;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    public static void start(Context context, String callerName, String avatarUrl, String convId, String callId) {
        if (context == null) return;
        try {
            Intent intent = new Intent(context, CallForegroundService.class);
            intent.setAction(ACTION_START_CALL);
            intent.putExtra("callerName", callerName);
            intent.putExtra("avatarUrl", avatarUrl);
            intent.putExtra("convId", convId);
            intent.putExtra("callId", callId);
            ContextCompat.startForegroundService(context, intent);
        } catch (Throwable t) {
            android.util.Log.e("CallForegroundService", "Failed to start CallForegroundService", t);
        }
    }

    public static void stop(Context context) {
        if (context == null) return;
        try {
            Intent intent = new Intent(context, CallForegroundService.class);
            intent.setAction(ACTION_STOP_CALL);
            context.startService(intent);
        } catch (Throwable ignored) {}
    }

    private void releaseCallResources() {
        try {
            AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (am != null) {
                am.setMode(AudioManager.MODE_NORMAL);
            }
        } catch (Throwable ignored) {}

        if (sWakeLock != null && sWakeLock.isHeld()) {
            try {
                sWakeLock.release();
            } catch (Throwable ignored) {}
            sWakeLock = null;
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || ACTION_STOP_CALL.equals(intent.getAction())) {
            stopForeground(true);
            releaseCallResources();
            stopSelf();
            return START_NOT_STICKY;
        }

        if (ACTION_START_CALL.equals(intent.getAction())) {
            String callerName = intent.getStringExtra("callerName");
            if (callerName == null || callerName.isEmpty()) callerName = "Friend";
            String avatarUrl = intent.getStringExtra("avatarUrl");
            String convId = intent.getStringExtra("convId");
            String callId = intent.getStringExtra("callId");

            // Acquire CPU partial wakelock so WebRTC audio doesn't freeze in sleep/background
            try {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                if (pm != null && (sWakeLock == null || !sWakeLock.isHeld())) {
                    sWakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Shinzi:CallAudioWakeLock");
                    sWakeLock.acquire(4 * 60 * 60 * 1000L); // 4 hours maximum
                }
            } catch (Throwable t) {
                android.util.Log.e("CallForegroundService", "WakeLock error", t);
            }

            // Set system audio mode to communication for VoIP
            try {
                AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
                if (am != null) {
                    am.setMode(AudioManager.MODE_IN_COMMUNICATION);
                }
            } catch (Throwable ignored) {}

            ShinziNotificationPlugin.createCallNotificationChannel(this);

            Intent openIntent = new Intent(this, MainActivity.class);
            openIntent.setAction(Intent.ACTION_VIEW);
            openIntent.setData(Uri.parse("https://shinzi.vercel.app/call?id=" + Uri.encode(callId != null ? callId : "") + "&conv=" + Uri.encode(convId != null ? convId : "default")));
            openIntent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);

            int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                piFlags |= PendingIntent.FLAG_MUTABLE;
            }

            PendingIntent openPI = PendingIntent.getActivity(this, NOTIF_ID, openIntent, piFlags);

            Intent hangupIntent = new Intent(this, CallActionReceiver.class);
            hangupIntent.setAction(CallActionReceiver.ACTION_HANG_UP);
            hangupIntent.putExtra("callId", callId);
            hangupIntent.putExtra("convId", convId);
            hangupIntent.putExtra("notificationId", NOTIF_ID);
            PendingIntent hangupPI = PendingIntent.getBroadcast(this, 1, hangupIntent, piFlags);

            Bitmap avatar = ShinziNotificationPlugin.fetchCircularAvatar(this, avatarUrl != null ? avatarUrl : "", callerName, convId != null ? convId : "default");

            NotificationCompat.Builder builder = new NotificationCompat.Builder(this, ShinziNotificationPlugin.CALL_ONGOING_CHANNEL_ID)
                    .setSmallIcon(R.drawable.ic_stat_shinzi)
                    .setContentTitle(callerName)
                    .setContentText("Call in progress")
                    .setUsesChronometer(true)
                    .setContentIntent(openPI)
                    .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                    .setCategory(NotificationCompat.CATEGORY_CALL)
                    .setOngoing(true)
                    .setAutoCancel(false)
                    .addAction(R.drawable.ic_stat_shinzi, "Hang up", hangupPI);

            if (avatar != null) {
                builder.setLargeIcon(avatar);
            }

            Notification notification = builder.build();

            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    startForeground(NOTIF_ID, notification,
                            ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL | ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
                } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    startForeground(NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL);
                } else {
                    startForeground(NOTIF_ID, notification);
                }
            } catch (Throwable t) {
                android.util.Log.e("CallForegroundService", "startForeground failed: " + t.getMessage(), t);
            }

            // Async avatar download if needed
            final String fAvatarUrl = avatarUrl;
            final String fCallerName = callerName;
            final String fConvId = convId != null ? convId : "default";
            if (fAvatarUrl != null && fAvatarUrl.startsWith("http") && !ShinziNotificationPlugin.cachedAvatars.containsKey(fConvId)) {
                new Thread(() -> {
                    try {
                        Bitmap netAvatar = ShinziNotificationPlugin.fetchCircularAvatar(this, fAvatarUrl, fCallerName, fConvId);
                        if (netAvatar != null) {
                            builder.setLargeIcon(netAvatar);
                            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
                            if (nm != null) {
                                nm.notify(NOTIF_ID, builder.build());
                            }
                        }
                    } catch (Throwable ignored) {}
                }).start();
            }

            return START_STICKY;
        }

        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        stopForeground(true);
        releaseCallResources();
        super.onDestroy();
    }
}
