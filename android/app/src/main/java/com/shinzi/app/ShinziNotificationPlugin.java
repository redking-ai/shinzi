package com.shinzi.app;

import android.app.Activity;
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
import android.media.AudioAttributes;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.media.projection.MediaProjectionManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.Settings;
import androidx.activity.result.ActivityResult;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.Person;
import androidx.core.app.RemoteInput;
import androidx.core.graphics.drawable.IconCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
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
    public static final String CALL_INCOMING_CHANNEL_ID = "shinzi_call_incoming_v4";
    public static final String CALL_ONGOING_CHANNEL_ID = "shinzi_call_ongoing_v2";
    private static final int CALL_NOTIFICATION_ID = 8888;
    private static ShinziNotificationPlugin instance;
    public static ShinziNotificationPlugin getInstance() { return instance; }

    // Track app foreground and active conversation
    public static volatile boolean isAppForeground = false;
    public static volatile String activeConversationId = null;

    // Track ongoing active call for status bar sync
    public static volatile boolean hasActiveCall = false;
    public static volatile String activeCallCallerName = "";
    public static volatile String activeCallAvatarUrl = "";
    public static volatile String activeCallConvId = "";
    public static volatile String activeCallId = "";

    public static boolean isAppInForeground(Context context) {
        return isAppForeground;
    }

    // Track pending notification chat opened by tap
    private static volatile String pendingConvId = null;
    private static volatile String pendingSenderUid = null;

    // Deduplication tracker for incoming call alerts
    public static volatile String lastIncomingCallId = "";
    public static volatile long lastIncomingCallTime = 0;

    // Cache circular avatar bitmaps in memory
    static final Map<String, Bitmap> cachedAvatars = new ConcurrentHashMap<>();

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

    @PluginMethod
    public void isBatteryOptimizationIgnored(PluginCall call) {
        JSObject ret = new JSObject();
        boolean ignored = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                ignored = pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
            }
        }
        ret.put("ignored", ignored);
        call.resolve(ret);
    }

    @PluginMethod
    public void requestBatteryOptimization(PluginCall call) {
        // Redundant with ongoing foreground services and high-priority FCM. Safe no-op to prevent Google Play Protect flags.
        call.resolve();
    }

    public static void notifyCallAction(String action, String callId) {
        if (instance != null) {
            JSObject data = new JSObject();
            data.put("action", action != null ? action : "");
            data.put("callId", callId != null ? callId : "");
            instance.notifyListeners("onCallAction", data);
        }
    }

    @PluginMethod
    public void showCallNotification(PluginCall call) {
        String callerName = call.getString("callerName", "Friend");
        String callId = call.getString("callId", "call_default");
        String convId = call.getString("convId", "default");
        String callType = call.getString("callType", "voice");
        boolean isConnected = Boolean.TRUE.equals(call.getBoolean("isConnected", false));
        boolean isIncoming = Boolean.TRUE.equals(call.getBoolean("isIncoming", false));
        boolean isMuted = Boolean.TRUE.equals(call.getBoolean("isMuted", false));
        boolean isDeafened = Boolean.TRUE.equals(call.getBoolean("isDeafened", false));

        createCallNotificationChannel(getContext());

        Intent openIntent = new Intent(getContext(), MainActivity.class);
        openIntent.setAction(Intent.ACTION_VIEW);
        openIntent.setData(Uri.parse("https://shinzi.vercel.app/call?id=" + callId + "&conv=" + convId));
        openIntent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);

        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            flags |= PendingIntent.FLAG_MUTABLE;
        }

        PendingIntent openPI = PendingIntent.getActivity(getContext(), CALL_NOTIFICATION_ID, openIntent, flags);

        String channelToUse = isIncoming ? CALL_INCOMING_CHANNEL_ID : CALL_ONGOING_CHANNEL_ID;
        NotificationCompat.Builder builder = new NotificationCompat.Builder(getContext(), channelToUse)
                .setSmallIcon(R.drawable.ic_stat_shinzi)
                .setContentTitle(callerName)
                .setContentIntent(openPI)
                .setPriority(isIncoming ? NotificationCompat.PRIORITY_MAX : NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setOngoing(true)
                .setAutoCancel(false);

        if (isIncoming) {
            String avatarUrl = call.getString("avatarUrl", "");
            showIncomingCallNotificationNative(getContext(), callerName, avatarUrl, convId, callId, callType);
            call.resolve();
            return;
        } else if (isConnected) {
            String avatarUrl = call.getString("avatarUrl", "");
            showOngoingCallNotificationNative(getContext(), callerName, avatarUrl, convId, callId);
            call.resolve();
            return;
        } else {
            // Outgoing Ringing
            builder.setContentText("Calling...");

            Intent hangupIntent = new Intent(getContext(), CallActionReceiver.class);
            hangupIntent.setAction(CallActionReceiver.ACTION_HANG_UP);
            hangupIntent.putExtra("callId", callId);
            hangupIntent.putExtra("notificationId", CALL_NOTIFICATION_ID);
            PendingIntent hangupPI = PendingIntent.getBroadcast(getContext(), 1, hangupIntent, flags);

            builder.addAction(0, "Hang up", hangupPI);
        }

        try {
            NotificationManagerCompat.from(getContext()).notify(CALL_NOTIFICATION_ID, builder.build());
        } catch (Throwable t) {
            android.util.Log.e("ShinziNotif", "Error notifying call", t);
        }
        call.resolve();
    }

    public static java.util.Map<String, String> pendingCall = null;
    public static Vibrator sCallVibrator = null;

    @PluginMethod
    public void getPendingCall(PluginCall call) {
        if (pendingCall != null) {
            JSObject ret = new JSObject();
            for (java.util.Map.Entry<String, String> entry : pendingCall.entrySet()) {
                ret.put(entry.getKey(), entry.getValue());
            }
            pendingCall = null;
            call.resolve(ret);
        } else {
            call.resolve();
        }
    }

    @PluginMethod
    public void clearCallNotification(PluginCall call) {
        clearCallNotificationNative(getContext());
        call.resolve();
    }

    @PluginMethod
    public void startCallVibration(PluginCall call) {
        startCallVibrationNative(getContext());
        call.resolve();
    }

    @PluginMethod
    public void stopCallVibration(PluginCall call) {
        stopCallVibrationNative(getContext());
        call.resolve();
    }

    @PluginMethod
    public void startCallRingtone(PluginCall call) {
        startCallRingtoneNative(getContext());
        call.resolve();
    }

    @PluginMethod
    public void stopCallRingtone(PluginCall call) {
        stopCallRingtoneNative(getContext());
        call.resolve();
    }

    @PluginMethod
    public void setCallActiveState(PluginCall call) {
        boolean active = Boolean.TRUE.equals(call.getBoolean("active", false));
        hasActiveCall = active;
        if (active) {
            activeCallCallerName = call.getString("callerName", "Friend");
            activeCallAvatarUrl = call.getString("avatarUrl", "");
            activeCallConvId = call.getString("convId", "default");
            activeCallId = call.getString("callId", "");
            showOngoingCallNotificationNative(
                    getContext(),
                    activeCallCallerName,
                    activeCallAvatarUrl,
                    activeCallConvId,
                    activeCallId
            );
        } else {
            activeCallCallerName = "";
            activeCallAvatarUrl = "";
            activeCallConvId = "";
            activeCallId = "";
            clearCallNotificationNative(getContext());
        }
        call.resolve();
    }

    @PluginMethod
    public void getAudioDevices(PluginCall call) {
        Context context = getContext();
        boolean hasHeadset = false;
        if (context != null) {
            AudioManager am = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
            if (am != null) {
                if (am.isWiredHeadsetOn()) {
                    hasHeadset = true;
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    AudioDeviceInfo[] devices = am.getDevices(AudioManager.GET_DEVICES_OUTPUTS);
                    if (devices != null) {
                        for (AudioDeviceInfo dev : devices) {
                            int type = dev.getType();
                            if (type == AudioDeviceInfo.TYPE_WIRED_HEADSET ||
                                type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES ||
                                type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO ||
                                type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP ||
                                type == AudioDeviceInfo.TYPE_BLE_HEADSET ||
                                type == AudioDeviceInfo.TYPE_USB_HEADSET) {
                                hasHeadset = true;
                                break;
                            }
                        }
                    }
                }
            }
        }
        JSObject ret = new JSObject();
        ret.put("hasHeadset", hasHeadset);
        call.resolve(ret);
    }

    @PluginMethod
    public void setAudioRoute(PluginCall call) {
        String route = call.getString("route", "mobile"); // "mobile" / "earpiece", "speaker", "device"
        try {
            Context context = getContext();
            if (context != null) {
                AudioManager audioManager = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
                if (audioManager != null) {
                    audioManager.setMode(AudioManager.MODE_IN_COMMUNICATION);
                    if ("speaker".equalsIgnoreCase(route)) {
                        try { audioManager.stopBluetoothSco(); } catch (Exception ignored) {}
                        audioManager.setBluetoothScoOn(false);
                        audioManager.setSpeakerphoneOn(true);
                    } else if ("device".equalsIgnoreCase(route)) {
                        audioManager.setSpeakerphoneOn(false);
                        try {
                            audioManager.startBluetoothSco();
                            audioManager.setBluetoothScoOn(true);
                        } catch (Exception ignored) {}
                    } else { // "mobile" / "earpiece"
                        try { audioManager.stopBluetoothSco(); } catch (Exception ignored) {}
                        audioManager.setBluetoothScoOn(false);
                        audioManager.setSpeakerphoneOn(false);
                    }
                    call.resolve();
                    return;
                }
            }
        } catch (Exception e) {
            call.reject("Failed to set audio route: " + e.getMessage());
            return;
        }
        call.resolve();
    }

    public static void startCallVibrationNative(Context context) {
        try {
            stopCallVibrationNative(context);
            Vibrator v = null;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                android.os.VibratorManager vm = (android.os.VibratorManager) context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
                if (vm != null) {
                    v = vm.getDefaultVibrator();
                }
            }
            if (v == null) {
                v = (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
            }
            if (v != null && v.hasVibrator()) {
                long[] pattern = new long[]{0, 1000, 1000};
                AudioAttributes audioAttributes = new AudioAttributes.Builder()
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                        .build();
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    v.vibrate(VibrationEffect.createWaveform(pattern, 0), audioAttributes);
                } else {
                    v.vibrate(pattern, 0);
                }
                sCallVibrator = v;
            }
        } catch (Exception ignored) {}
    }

    public static void stopCallVibrationNative(Context context) {
        try {
            if (sCallVibrator != null) {
                sCallVibrator.cancel();
                sCallVibrator = null;
            }
            Vibrator v = (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
            if (v != null) {
                v.cancel();
            }
        } catch (Exception ignored) {}
    }

    private static Ringtone sCallRingtone = null;

    public static synchronized void startCallRingtoneNative(Context context) {
        if (context == null) return;
        try {
            stopCallRingtoneNative(context);
            Uri ringtoneUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
            if (ringtoneUri == null) {
                ringtoneUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
            }
            if (ringtoneUri != null) {
                sCallRingtone = RingtoneManager.getRingtone(context.getApplicationContext(), ringtoneUri);
                if (sCallRingtone != null) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                        AudioAttributes aa = new AudioAttributes.Builder()
                                .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                                .build();
                        sCallRingtone.setAudioAttributes(aa);
                    }
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                        sCallRingtone.setLooping(true);
                    }
                    sCallRingtone.play();
                }
            }
        } catch (Throwable t) {
            android.util.Log.e("ShinziNotif", "Error starting call ringtone: " + t.getMessage());
        }
    }

    public static synchronized void stopCallRingtoneNative(Context context) {
        try {
            if (sCallRingtone != null) {
                sCallRingtone.stop();
                sCallRingtone = null;
            }
        } catch (Throwable ignored) {}
    }

    public static void showOngoingCallNotificationNative(
            Context context,
            String callerName,
            String avatarUrl,
            String convId,
            String callId
    ) {
        if (context == null) return;
        try {
            hasActiveCall = true;
            activeCallCallerName = callerName != null && !callerName.isEmpty() ? callerName : "Friend";
            activeCallAvatarUrl = avatarUrl != null ? avatarUrl : "";
            activeCallConvId = convId != null && !convId.isEmpty() ? convId : "default";
            activeCallId = callId != null && !callId.isEmpty() ? callId : "";

            // Use Android Foreground Service with type phoneCall|microphone to prevent audio/mic cutoff in background
            CallForegroundService.start(context, activeCallCallerName, activeCallAvatarUrl, activeCallConvId, activeCallId);
        } catch (Throwable t) {
            android.util.Log.e("ShinziNotif", "Error showing ongoing call notification", t);
        }
    }

    public static void showIncomingCallNotificationNative(
            Context context,
            String callerName,
            String avatarUrl,
            String convId,
            String callId,
            String callType
    ) {
        if (context == null) return;
        try {
            String safeCallId = callId != null && !callId.isEmpty() ? callId : "call_default";

            // Deduplication: prevent double incoming call alerts from both FCM push and Firestore snapshot
            long now = System.currentTimeMillis();
            if (safeCallId.equals(lastIncomingCallId) && (now - lastIncomingCallTime < 20000)) {
                return;
            }
            lastIncomingCallId = safeCallId;
            lastIncomingCallTime = now;

            createCallNotificationChannel(context);

            String safeCaller = callerName != null && !callerName.isEmpty() ? callerName : "Friend";
            String safeAvatar = avatarUrl != null ? avatarUrl : "";
            String safeConv = convId != null && !convId.isEmpty() ? convId : "default";
            String safeType = callType != null ? callType : "voice";

            java.util.Map<String, String> pending = new java.util.HashMap<>();
            pending.put("callId", safeCallId);
            pending.put("convId", safeConv);
            pending.put("caller", safeCaller);
            pending.put("avatar", safeAvatar);
            pending.put("type", safeType);
            pendingCall = pending;

            // Continuous Non-Stop Looping Vibration & Loud Ringtone
            startCallVibrationNative(context);
            startCallRingtoneNative(context);

            Intent openIntent = new Intent(context, MainActivity.class);
            openIntent.setAction(Intent.ACTION_VIEW);
            openIntent.setData(Uri.parse("https://shinzi.vercel.app/call?id=" + Uri.encode(safeCallId) + "&conv=" + Uri.encode(safeConv) + "&caller=" + Uri.encode(safeCaller) + "&avatar=" + Uri.encode(safeAvatar) + "&type=" + Uri.encode(safeType)));
            openIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);

            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                flags |= PendingIntent.FLAG_MUTABLE;
            }

            android.os.Bundle activityOptionsBundle = null;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                android.app.ActivityOptions options = android.app.ActivityOptions.makeBasic();
                options.setPendingIntentBackgroundActivityStartMode(
                    android.app.ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED
                );
                activityOptionsBundle = options.toBundle();
            }

            PendingIntent openPI;
            if (activityOptionsBundle != null) {
                openPI = PendingIntent.getActivity(context, CALL_NOTIFICATION_ID, openIntent, flags, activityOptionsBundle);
            } else {
                openPI = PendingIntent.getActivity(context, CALL_NOTIFICATION_ID, openIntent, flags);
            }

            Intent declineIntent = new Intent(context, CallActionReceiver.class);
            declineIntent.setAction(CallActionReceiver.ACTION_CALL_DECLINE);
            declineIntent.putExtra("callId", safeCallId);
            declineIntent.putExtra("convId", safeConv);
            declineIntent.putExtra("notificationId", CALL_NOTIFICATION_ID);
            PendingIntent declinePI = PendingIntent.getBroadcast(context, 10, declineIntent, flags);

            // Outside app Answer button: directly answers the call functionally in background
            Intent answerIntent = new Intent(context, CallActionReceiver.class);
            answerIntent.setAction(CallActionReceiver.ACTION_CALL_PICKUP);
            answerIntent.putExtra("callId", safeCallId);
            answerIntent.putExtra("convId", safeConv);
            answerIntent.putExtra("callerName", safeCaller);
            answerIntent.putExtra("avatarUrl", safeAvatar);
            answerIntent.putExtra("callType", safeType);
            answerIntent.putExtra("notificationId", CALL_NOTIFICATION_ID);
            PendingIntent answerPI = PendingIntent.getBroadcast(context, 20, answerIntent, flags);

            Bitmap avatar = fetchCircularAvatar(context, safeAvatar, safeCaller, safeConv);

            long[] pattern30s = new long[]{
                0, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000,
                1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000,
                1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000
            };

            NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CALL_INCOMING_CHANNEL_ID)
                    .setSmallIcon(R.drawable.ic_stat_shinzi)
                    .setContentTitle(safeCaller)
                    .setContentText("video".equals(safeType) ? "Incoming Video Call..." : "Incoming Voice Call...")
                    .setContentIntent(openPI)
                    .setFullScreenIntent(openPI, true)
                    .setPriority(NotificationCompat.PRIORITY_MAX)
                    .setCategory(NotificationCompat.CATEGORY_CALL)
                    .setOngoing(true)
                    .setAutoCancel(false)
                    .setTimeoutAfter(35000)
                    .setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE))
                    .setVibrate(pattern30s)
                    .addAction(R.drawable.ic_stat_shinzi, "Decline", declinePI)
                    .addAction(R.drawable.ic_stat_shinzi, "Accept", answerPI);

            if (avatar != null) {
                builder.setLargeIcon(avatar);
            }

            NotificationManagerCompat.from(context).notify(CALL_NOTIFICATION_ID, builder.build());

            // If remote avatar not yet cached, fetch in background thread and update
            final String fAvatarUrl = safeAvatar;
            final String fCallerName = safeCaller;
            final String fConvId = safeConv;
            if (fAvatarUrl != null && fAvatarUrl.startsWith("http") && !cachedAvatars.containsKey(fConvId)) {
                new Thread(() -> {
                    try {
                        Bitmap netAvatar = fetchCircularAvatar(context, fAvatarUrl, fCallerName, fConvId);
                        if (netAvatar != null) {
                            builder.setLargeIcon(netAvatar);
                            NotificationManagerCompat.from(context).notify(CALL_NOTIFICATION_ID, builder.build());
                        }
                    } catch (Throwable ignored) {}
                }).start();
            }
        } catch (Throwable t) {
            android.util.Log.e("ShinziNotif", "Error showing incoming call notification", t);
        }
    }

    public static void clearCallNotificationNative(Context context) {
        hasActiveCall = false;
        lastIncomingCallId = "";
        lastIncomingCallTime = 0;
        stopCallVibrationNative(context);
        stopCallRingtoneNative(context);
        if (context != null) {
            CallForegroundService.stop(context);
            try {
                NotificationManagerCompat.from(context).cancel(CALL_NOTIFICATION_ID);
            } catch (Exception ignored) {}
        }
    }

    @PluginMethod
    public void startNativeScreenCapture(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Activity not available");
            return;
        }
        MediaProjectionManager mpm = (MediaProjectionManager) activity.getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        if (mpm == null) {
            call.reject("MediaProjectionManager not available");
            return;
        }
        Intent intent = mpm.createScreenCaptureIntent();
        startActivityForResult(call, intent, "nativeScreenCaptureCallback");
    }

    @ActivityCallback
    private void nativeScreenCaptureCallback(PluginCall call, ActivityResult result) {
        if (result != null && result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
            Context context = getContext();
            if (context != null) {
                Intent serviceIntent = new Intent(context, ScreenCaptureService.class);
                serviceIntent.setAction(ScreenCaptureService.ACTION_START);
                serviceIntent.putExtra("resultCode", result.getResultCode());
                serviceIntent.putExtra("resultData", result.getData());
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(serviceIntent);
                } else {
                    context.startService(serviceIntent);
                }
            }
            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
        } else {
            call.reject("User cancelled screen capture");
        }
    }

    @PluginMethod
    public void stopNativeScreenCapture(PluginCall call) {
        Context context = getContext();
        if (context != null) {
            Intent intent = new Intent(context, ScreenCaptureService.class);
            intent.setAction(ScreenCaptureService.ACTION_STOP);
            context.startService(intent);
        }
        call.resolve();
    }

    @PluginMethod
    public void getLatestScreenFrame(PluginCall call) {
        byte[] frame = ScreenCaptureService.latestJpegFrame;
        boolean capturing = ScreenCaptureService.isCapturing;
        JSObject ret = new JSObject();
        ret.put("capturing", capturing);
        if (frame != null && frame.length > 0) {
            String b64 = android.util.Base64.encodeToString(frame, android.util.Base64.NO_WRAP);
            ret.put("frame", "data:image/jpeg;base64," + b64);
        } else {
            ret.put("frame", "");
        }
        call.resolve(ret);
    }

    public static void createCallNotificationChannel(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                try {
                    manager.deleteNotificationChannel("shinzi_calls");
                    manager.deleteNotificationChannel("shinzi_call_incoming_v2");
                    manager.deleteNotificationChannel("shinzi_call_incoming_v3");
                } catch (Exception ignored) {}

                // 1. High priority incoming call channel with loud ringtone & vibration
                NotificationChannel incomingChannel = new NotificationChannel(
                        CALL_INCOMING_CHANNEL_ID,
                        "Incoming Calls",
                        NotificationManager.IMPORTANCE_HIGH
                );
                incomingChannel.setDescription("Incoming voice and video calls");
                incomingChannel.enableVibration(true);
                incomingChannel.setVibrationPattern(new long[]{
                    0, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000,
                    1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000,
                    1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000
                });
                AudioAttributes audioAttributes = new AudioAttributes.Builder()
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                        .build();
                incomingChannel.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE), audioAttributes);
                incomingChannel.setLockscreenVisibility(NotificationCompat.VISIBILITY_PUBLIC);
                manager.createNotificationChannel(incomingChannel);

                // 2. Ongoing call channel (DEFAULT importance for foreground VoIP call with chronometer)
                NotificationChannel ongoingChannel = new NotificationChannel(
                        CALL_ONGOING_CHANNEL_ID,
                        "Active Call Status",
                        NotificationManager.IMPORTANCE_DEFAULT
                );
                ongoingChannel.setDescription("Ongoing active call indicator");
                ongoingChannel.setSound(null, null);
                ongoingChannel.enableVibration(false);
                ongoingChannel.setLockscreenVisibility(NotificationCompat.VISIBILITY_PUBLIC);
                manager.createNotificationChannel(ongoingChannel);
            }
        }
    }

    public static void setPendingNotificationChat(String convId, String senderUid) {
        pendingConvId = convId;
        pendingSenderUid = senderUid;
        notifyNotificationClicked(convId, senderUid);
    }

    public static void notifyNotificationClicked(String convId, String senderUid) {
        if (instance != null) {
            JSObject data = new JSObject();
            data.put("convId", convId != null ? convId : "");
            data.put("senderUid", senderUid != null ? senderUid : "");
            instance.notifyListeners("onNotificationClicked", data);
        }
    }

    @PluginMethod
    public void getPendingNotificationChat(PluginCall call) {
        JSObject res = new JSObject();
        res.put("convId", pendingConvId != null ? pendingConvId : "");
        res.put("senderUid", pendingSenderUid != null ? pendingSenderUid : "");
        // Consume pending
        pendingConvId = null;
        pendingSenderUid = null;
        call.resolve(res);
    }

    @PluginMethod
    public void downloadFile(PluginCall call) {
        String fileUrl = call.getString("url");
        String fileName = call.getString("fileName", "download");
        String mimeType = call.getString("mimeType", "*/*");

        if (fileUrl == null || fileUrl.isEmpty()) {
            call.reject("Missing download URL");
            return;
        }

        try {
            android.app.DownloadManager dm = (android.app.DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
            if (dm != null) {
                android.app.DownloadManager.Request request = new android.app.DownloadManager.Request(Uri.parse(fileUrl));
                request.setTitle(fileName);
                request.setDescription("Downloading " + fileName);
                if (mimeType != null && !mimeType.isEmpty() && !mimeType.equals("*/*")) {
                    request.setMimeType(mimeType);
                }
                request.setNotificationVisibility(android.app.DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                request.setDestinationInExternalPublicDir(android.os.Environment.DIRECTORY_DOWNLOADS, fileName);
                request.allowScanningByMediaScanner();
                dm.enqueue(request);

                android.os.Handler handler = new android.os.Handler(android.os.Looper.getMainLooper());
                handler.post(() -> android.widget.Toast.makeText(getContext(), "Downloading " + fileName, android.widget.Toast.LENGTH_SHORT).show());

                call.resolve(new JSObject().put("success", true));
                return;
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
        call.reject("DownloadManager failed");
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
        if (context == null) return null;
        if (convId == null || convId.isEmpty()) convId = "default";
        if (senderName == null || senderName.isEmpty()) senderName = "Shinzi";

        if (avatarUrl != null && !avatarUrl.isEmpty()) {
            if (avatarUrl.startsWith("/")) {
                avatarUrl = "https://shinzi.vercel.app" + avatarUrl;
            }
        }

        // Check memory cache
        if (cachedAvatars.containsKey(convId)) {
            Bitmap mem = cachedAvatars.get(convId);
            if (mem != null) return mem;
        }

        // Check local disk cache
        try {
            File diskCache = new File(context.getCacheDir(), "avatar_" + Math.abs(convId.hashCode()) + ".png");
            if (diskCache.exists()) {
                Bitmap cached = BitmapFactory.decodeFile(diskCache.getAbsolutePath());
                if (cached != null) {
                    cachedAvatars.put(convId, cached);
                    return cached;
                }
            }
        } catch (Exception ignored) {}

        // Never perform network operations on the main UI thread!
        if (android.os.Looper.myLooper() == android.os.Looper.getMainLooper()) {
            Bitmap initial = createInitialAvatar(senderName);
            if (initial != null) cachedAvatars.put(convId, initial);
            return initial;
        }

        File diskCache = null;
        try {
            diskCache = new File(context.getCacheDir(), "avatar_" + Math.abs(convId.hashCode()) + ".png");
        } catch (Exception ignored) {}

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
                            if (diskCache != null) {
                                try (FileOutputStream fos = new FileOutputStream(diskCache)) {
                                    avatarBitmap.compress(Bitmap.CompressFormat.PNG, 95, fos);
                                } catch (Exception ignored) {}
                            }
                        }
                    }
                }
            } catch (Exception ignored) {}
        }

        if (avatarBitmap == null) {
            avatarBitmap = createInitialAvatar(senderName);
        }

        if (avatarBitmap != null) {
            cachedAvatars.put(convId, avatarBitmap);
        }
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
        if (bitmap == null) return null;
        int width = bitmap.getWidth();
        int height = bitmap.getHeight();
        int size = Math.min(width, height);
        int x = (width - size) / 2;
        int y = (height - size) / 2;

        int targetSize = Math.min(size, 256);
        if (targetSize < 128) targetSize = size;

        Bitmap output = Bitmap.createBitmap(targetSize, targetSize, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(output);

        final Paint paint = new Paint();
        paint.setAntiAlias(true);
        paint.setFilterBitmap(true);
        paint.setDither(true);

        final Rect srcRect = new Rect(x, y, x + size, y + size);
        final Rect dstRect = new Rect(0, 0, targetSize, targetSize);

        canvas.drawARGB(0, 0, 0, 0);
        paint.setColor(Color.WHITE);
        canvas.drawCircle(targetSize / 2f, targetSize / 2f, targetSize / 2f, paint);
        paint.setXfermode(new PorterDuffXfermode(PorterDuff.Mode.SRC_IN));
        canvas.drawBitmap(bitmap, srcRect, dstRect, paint);
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
