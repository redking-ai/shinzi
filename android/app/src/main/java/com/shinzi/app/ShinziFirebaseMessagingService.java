package com.shinzi.app;

import androidx.annotation.NonNull;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

public class ShinziFirebaseMessagingService extends FirebaseMessagingService {

    @Override
    public void onNewToken(@NonNull String token) {
        super.onNewToken(token);
        getSharedPreferences("shinzi_prefs", MODE_PRIVATE)
                .edit()
                .putString("fcm_token", token)
                .apply();
        ShinziNotificationPlugin.notifyTokenRefresh(token);
    }

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        super.onMessageReceived(remoteMessage);

        Map<String, String> data = remoteMessage.getData();
        String type = data.get("type");

        // 1. Handle incoming voice/video calls even when the app is completely DEAD or closed!
        if ("incoming_call".equals(type) || "call".equals(type)) {
            String senderName = data.get("senderName");
            if (senderName == null || senderName.isEmpty()) {
                if (remoteMessage.getNotification() != null && remoteMessage.getNotification().getTitle() != null) {
                    senderName = remoteMessage.getNotification().getTitle();
                } else {
                    senderName = "Friend";
                }
            }
            String avatarUrl = data.get("avatarUrl");
            String convId = data.get("convId");
            String callId = data.get("callId");
            String callType = data.get("callType");

            ShinziNotificationPlugin.showIncomingCallNotificationNative(
                    this,
                    senderName,
                    avatarUrl,
                    convId != null ? convId : "default",
                    callId != null ? callId : "call_default",
                    callType != null ? callType : "voice"
            );
            return;
        }

        if ("call_ended".equals(type) || "call_declined".equals(type)) {
            ShinziNotificationPlugin.clearCallNotificationNative(this);
            return;
        }

        // If the app is currently running in the foreground, do NOT display an Android system
        // status bar notification for chat messages. The web app's in-app floating toast handles it.
        if (ShinziNotificationPlugin.isAppForeground) {
            return;
        }
        String senderName = data.get("senderName");
        if (senderName == null || senderName.isEmpty()) {
            if (remoteMessage.getNotification() != null && remoteMessage.getNotification().getTitle() != null) {
                senderName = remoteMessage.getNotification().getTitle();
            } else {
                senderName = "Friend";
            }
        }

        String text = data.get("text");
        if (text == null || text.isEmpty()) {
            if (remoteMessage.getNotification() != null && remoteMessage.getNotification().getBody() != null) {
                text = remoteMessage.getNotification().getBody();
            } else {
                text = "New message";
            }
        }

        String avatarUrl = data.get("avatarUrl");
        String convId = data.get("convId");
        if (convId == null || convId.isEmpty()) {
            convId = data.get("tag");
        }
        if (convId == null || convId.isEmpty()) {
            convId = "default";
        }
        String senderUid = data.get("senderUid");

        ShinziNotificationPlugin.showNotificationNative(
                this,
                senderName,
                text,
                avatarUrl,
                convId,
                senderUid != null ? senderUid : ""
        );
    }
}
