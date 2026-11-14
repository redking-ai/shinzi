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
            convId = "default";
        }

        ShinziNotificationPlugin.showNotificationNative(
                this,
                senderName,
                text,
                avatarUrl,
                convId
        );
    }
}
