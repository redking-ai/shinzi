package com.shinzi.app;

import android.Manifest;
import android.app.DownloadManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.Toast;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import java.util.ArrayList;
import java.util.List;

import com.getcapacitor.BridgeActivity;
import com.google.firebase.messaging.FirebaseMessaging;

public class MainActivity extends BridgeActivity {
    private static final int PERMISSION_REQUEST_NOTIFICATIONS = 101;
    private static final int PERMISSION_REQUEST_AUDIO = 102;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ShinziNotificationPlugin.class);
        super.onCreate(savedInstanceState);

        // 1. Explicitly enable DomStorage, Database, and CookieManager + DownloadListener
        try {
            WebView webView = getBridge().getWebView();
            if (webView != null) {
                WebSettings settings = webView.getSettings();
                settings.setDomStorageEnabled(true);
                settings.setDatabaseEnabled(true);
                settings.setJavaScriptEnabled(true);
                settings.setMediaPlaybackRequiresUserGesture(false);
                CookieManager cookieManager = CookieManager.getInstance();
                cookieManager.setAcceptCookie(true);
                cookieManager.setAcceptThirdPartyCookies(webView, true);

                // Native DownloadManager Listener
                webView.setDownloadListener((url, userAgent, contentDisposition, mimetype, contentLength) -> {
                    try {
                        DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
                        if (dm != null && url != null) {
                            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                            String fileName = URLUtil.guessFileName(url, contentDisposition, mimetype);
                            request.setTitle(fileName);
                            request.setDescription("Downloading " + fileName);
                            if (mimetype != null && !mimetype.isEmpty()) {
                                request.setMimeType(mimetype);
                            }
                            String cookies = CookieManager.getInstance().getCookie(url);
                            if (cookies != null) {
                                request.addRequestHeader("cookie", cookies);
                            }
                            request.addRequestHeader("User-Agent", userAgent);
                            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);
                            request.allowScanningByMediaScanner();
                            dm.enqueue(request);
                            Toast.makeText(getApplicationContext(), "Downloading " + fileName, Toast.LENGTH_SHORT).show();
                        }
                    } catch (Exception e) {
                        try {
                            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                            startActivity(intent);
                        } catch (Exception ignored) {}
                    }
                });
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

        // 3. Request RECORD_AUDIO & CAMERA Permission for Calls and Voice Notes
        List<String> neededPermissions = new ArrayList<>();
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            neededPermissions.add(Manifest.permission.RECORD_AUDIO);
            neededPermissions.add(Manifest.permission.MODIFY_AUDIO_SETTINGS);
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            neededPermissions.add(Manifest.permission.CAMERA);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
                neededPermissions.add(Manifest.permission.BLUETOOTH_CONNECT);
            }
        }
        if (!neededPermissions.isEmpty()) {
            ActivityCompat.requestPermissions(
                    this,
                    neededPermissions.toArray(new String[0]),
                    PERMISSION_REQUEST_AUDIO
            );
        }

        // 4. Request Battery Optimization Exemption so Android OEM never kills background push
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                android.os.PowerManager pm = (android.os.PowerManager) getSystemService(POWER_SERVICE);
                if (pm != null && !pm.isIgnoringBatteryOptimizations(getPackageName())) {
                    Intent bIntent = new Intent();
                    bIntent.setAction(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                    bIntent.setData(Uri.parse("package:" + getPackageName()));
                    startActivity(bIntent);
                }
            }
        } catch (Exception ignored) {}

        // 5. Retrieve and cache current FCM Registration Token
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

        // 6. Handle Intent if app launched directly by tapping notification
        handleChatIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleChatIntent(intent);
    }

    private void handleChatIntent(Intent intent) {
        if (intent == null) return;
        Uri uri = intent.getData();
        if (uri != null) {
            String convId = uri.getQueryParameter("conv");
            String userUid = uri.getQueryParameter("user");
            if ((convId != null && !convId.isEmpty()) || (userUid != null && !userUid.isEmpty())) {
                ShinziNotificationPlugin.setPendingNotificationChat(convId, userUid);

                // Dispatch custom event to Webview if already active
                new Handler(Looper.getMainLooper()).postDelayed(() -> {
                    try {
                        WebView webView = getBridge().getWebView();
                        if (webView != null) {
                            String safeConv = convId != null ? convId.replace("'", "\\'") : "";
                            String safeUser = userUid != null ? userUid.replace("'", "\\'") : "";
                            String js = "window.dispatchEvent(new CustomEvent('shinzi:openChat', { detail: { convId: '" + safeConv + "', userUid: '" + safeUser + "' } }));";
                            webView.evaluateJavascript(js, null);
                        }
                    } catch (Exception ignored) {}
                }, 300);
            }
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        ShinziNotificationPlugin.isAppForeground = true;
    }

    @Override
    public void onPause() {
        super.onPause();
        ShinziNotificationPlugin.isAppForeground = false;
    }
}
