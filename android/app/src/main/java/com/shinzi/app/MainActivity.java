package com.shinzi.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;
import com.google.firebase.messaging.FirebaseMessaging;

public class MainActivity extends BridgeActivity {
    private static final int PERMISSION_REQUEST_NOTIFICATIONS = 101;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ShinziNotificationPlugin.class);
        super.onCreate(savedInstanceState);

        // 1. Explicitly enable DomStorage, Database, and CookieManager
        try {
            WebView webView = getBridge().getWebView();
            if (webView != null) {
                WebSettings settings = webView.getSettings();
                settings.setDomStorageEnabled(true);
                settings.setDatabaseEnabled(true);
                settings.setJavaScriptEnabled(true);
                CookieManager cookieManager = CookieManager.getInstance();
                cookieManager.setAcceptCookie(true);
                cookieManager.setAcceptThirdPartyCookies(webView, true);
            }
        } catch (Exception ignored) {}

        // 2. Request Android 13+ (API 33+) Runtime POST_NOTIFICATIONS Permission
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(
                        this,
                        new String[]{Manifest.permission.POST_NOTIFICATIONS},
                        PERMISSION_REQUEST_NOTIFICATIONS
                );
            }
        }

        // 3. Request Battery Optimization Exemption so Android OEM never kills background push
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                android.os.PowerManager pm = (android.os.PowerManager) getSystemService(POWER_SERVICE);
                if (pm != null && !pm.isIgnoringBatteryOptimizations(getPackageName())) {
                    android.content.Intent bIntent = new android.content.Intent();
                    bIntent.setAction(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                    bIntent.setData(android.net.Uri.parse("package:" + getPackageName()));
                    startActivity(bIntent);
                }
            }
        } catch (Exception ignored) {}

        // 4. Retrieve and cache current FCM Registration Token
        FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
            if (task.isSuccessful() && task.getResult() != null) {
                String token = task.getResult();
                getSharedPreferences("shinzi_prefs", MODE_PRIVATE)
                        .edit()
                        .putString("fcm_token", token)
                        .apply();
                ShinziNotificationPlugin.notifyTokenRefresh(token);
            } else if (task.getException() != null) {
                android.util.Log.e("ShinziFCM", "getToken failed: " + task.getException().getMessage());
            }
        });
    }
}
