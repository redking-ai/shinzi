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
                // 1. Immediately cancel incoming ringing notification & stop phone vibration
                ShinziNotificationPlugin.clearCallNotificationNative(context);
                if (nm != null) nm.cancel(notifId);

                // 2. Notify webview call engine to functionally answer and stream audio
                ShinziNotificationPlugin.notifyCallAction("pickup", callId);

                // 3. Post ongoing active call notification with live chronometer timer and "Hang up" button
                String caller = intent.getStringExtra("callerName");
                String avatar = intent.getStringExtra("avatarUrl");
                String conv = intent.getStringExtra("convId");
                ShinziNotificationPlugin.showOngoingCallNotificationNative(
                        context,
                        caller != null ? caller : "Friend",
                        avatar != null ? avatar : "",
                        conv != null ? conv : "default",
                        callId != null ? callId : ""
                );

                // 4. Launch/resume MainActivity with autoAnswer=true so WebRTC connects immediately
                try {
                    Intent openApp = new Intent(context, MainActivity.class);
                    openApp.setAction(Intent.ACTION_VIEW);
                    String safeCaller = caller != null ? Uri.encode(caller) : "Friend";
                    String safeAvatar = avatar != null ? Uri.encode(avatar) : "";
                    String safeConv = conv != null ? Uri.encode(conv) : "default";
                    String safeCallId = callId != null ? Uri.encode(callId) : "";
                    String callType = intent.getStringExtra("callType");
                    String safeType = callType != null ? Uri.encode(callType) : "voice";
                    openApp.setData(Uri.parse("https://shinzi.vercel.app/call?id=" + safeCallId + "&conv=" + safeConv + "&caller=" + safeCaller + "&avatar=" + safeAvatar + "&type=" + safeType + "&autoAnswer=true"));
                    openApp.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                    context.startActivity(openApp);
                } catch (Exception ignored) {}
                break;

            case ACTION_CALL_DECLINE:
                ShinziNotificationPlugin.hasActiveCall = false;
                ShinziNotificationPlugin.clearCallNotificationNative(context);
                if (nm != null) nm.cancel(notifId);
                ShinziNotificationPlugin.notifyCallAction("decline", callId);

                // Asynchronously update Firestore via serverless API even if app process is dead
                if (callId != null && !callId.isEmpty()) {
                    final String targetCallId = callId;
                    final String targetConvId = intent.getStringExtra("convId");
                    new Thread(() -> {
                        try {
                            java.net.URL url = new java.net.URL("https://shinzi.vercel.app/api/decline-call");
                            java.net.HttpURLConnection conn = (java.net.HttpURLConnection) url.openConnection();
                            conn.setRequestMethod("POST");
                            conn.setRequestProperty("Content-Type", "application/json");
                            conn.setDoOutput(true);
                            conn.setConnectTimeout(4000);
                            conn.setReadTimeout(4000);
                            String body = "{\"callId\":\"" + targetCallId + "\",\"convId\":\"" + (targetConvId != null ? targetConvId : "") + "\"}";
                            try (java.io.OutputStream os = conn.getOutputStream()) {
                                os.write(body.getBytes("UTF-8"));
                            }
                            conn.getResponseCode();
                        } catch (Exception ignored) {}
                    }).start();
                }
                break;

            case ACTION_HANG_UP:
                ShinziNotificationPlugin.hasActiveCall = false;
                ShinziNotificationPlugin.clearCallNotificationNative(context);
                if (nm != null) nm.cancel(notifId);
                ShinziNotificationPlugin.notifyCallAction("hangup", callId);

                if (callId != null && !callId.isEmpty()) {
                    final String targetCallId = callId;
                    final String targetConvId = intent.getStringExtra("convId");
                    new Thread(() -> {
                        try {
                            java.net.URL url = new java.net.URL("https://shinzi.vercel.app/api/decline-call");
                            java.net.HttpURLConnection conn = (java.net.HttpURLConnection) url.openConnection();
                            conn.setRequestMethod("POST");
                            conn.setRequestProperty("Content-Type", "application/json");
                            conn.setDoOutput(true);
                            conn.setConnectTimeout(4000);
                            conn.setReadTimeout(4000);
                            String body = "{\"callId\":\"" + targetCallId + "\",\"convId\":\"" + (targetConvId != null ? targetConvId : "") + "\"}";
                            try (java.io.OutputStream os = conn.getOutputStream()) {
                                os.write(body.getBytes("UTF-8"));
                            }
                            conn.getResponseCode();
                        } catch (Exception ignored) {}
                    }).start();
                }
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
