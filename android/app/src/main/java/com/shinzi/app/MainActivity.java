package com.shinzi.app;

import android.Manifest;
import android.app.DownloadManager;
import android.app.KeyguardManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.URLUtil;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.Toast;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import java.io.File;
import java.io.FileInputStream;
import java.util.ArrayList;
import java.util.List;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import com.google.firebase.messaging.FirebaseMessaging;

public class MainActivity extends BridgeActivity {
    private static final int PERMISSION_REQUEST_NOTIFICATIONS = 101;
    private static final int PERMISSION_REQUEST_AUDIO = 102;
    private volatile boolean isShowingOfflineError = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ShinziNotificationPlugin.class);
        super.onCreate(savedInstanceState);

        // If launched to answer a call in the background, keep the activity in the background
        if (getIntent() != null) {
            Uri data = getIntent().getData();
            boolean isAutoAnswer = (data != null && "true".equalsIgnoreCase(data.getQueryParameter("autoAnswer"))) ||
                                   getIntent().getBooleanExtra("backgroundAutoAnswer", false);
            if (isAutoAnswer) {
                moveTaskToBack(true);
            }
        }

        // Turn screen on and show over lock screen ONLY for incoming calls
        applyLockScreenFlagsIfNeeded(getIntent());

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

                // Custom BridgeWebViewClient to catch offline cold start and inject restored auth sessions
                webView.setWebViewClient(new BridgeWebViewClient(getBridge()) {
                    @Override
                    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                        if (request != null && request.getUrl() != null) {
                            String url = request.getUrl().toString();
                            if (url.startsWith("https://accounts.spotify.com") ||
                                url.contains("spotify.com") ||
                                url.startsWith("https://shinzi.vercel.app") ||
                                url.startsWith("capacitor://") ||
                                url.startsWith("shinzi://")) {
                                return false;
                            }
                        }
                        return super.shouldOverrideUrlLoading(view, request);
                    }

                    @Override
                    public boolean shouldOverrideUrlLoading(WebView view, String url) {
                        if (url != null) {
                            if (url.startsWith("https://accounts.spotify.com") ||
                                url.contains("spotify.com") ||
                                url.startsWith("https://shinzi.vercel.app") ||
                                url.startsWith("capacitor://") ||
                                url.startsWith("shinzi://")) {
                                return false;
                            }
                        }
                        return super.shouldOverrideUrlLoading(view, url);
                    }

                    @Override
                    public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                        if (request != null && request.isForMainFrame()) {
                            showOfflineError(view);
                            return;
                        }
                        super.onReceivedError(view, request, error);
                    }

                    @Override
                    public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                        showOfflineError(view);
                    }

                    @Override
                    public void onPageFinished(WebView view, String url) {
                        super.onPageFinished(view, url);
                        if (url != null && url.startsWith("https://shinzi.vercel.app")) {
                            isShowingOfflineError = false;
                            restoreAuthSessionIfPresent(view, MainActivity.this);
                        }
                    }
                });

                // Auto-reconnect when internet becomes available
                try {
                    ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
                    if (cm != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                        cm.registerDefaultNetworkCallback(new ConnectivityManager.NetworkCallback() {
                            @Override
                            public void onAvailable(Network network) {
                                runOnUiThread(() -> {
                                    WebView wv = getBridge().getWebView();
                                    if (wv != null && isShowingOfflineError) {
                                        isShowingOfflineError = false;
                                        wv.loadUrl("https://shinzi.vercel.app");
                                    }
                                });
                            }
                        });
                    }
                } catch (Exception ignored) {}

                // Auto-grant WebRTC Camera & Microphone in WebView WebChromeClient
                webView.setWebChromeClient(new com.getcapacitor.BridgeWebChromeClient(getBridge()) {
                    @Override
                    public void onPermissionRequest(final PermissionRequest request) {
                        runOnUiThread(() -> {
                            try {
                                request.grant(request.getResources());
                            } catch (Exception e) {
                                super.onPermissionRequest(request);
                            }
                        });
                    }
                });

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

        // 2. Request Android Runtime Permissions in ONE unified batch (Notifications, Microphone, Camera, Bluetooth)
        List<String> neededPermissions = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                neededPermissions.add(Manifest.permission.POST_NOTIFICATIONS);
            }
        }
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

        // 5. Handle Intent if app launched directly by tapping notification or call
        handleChatIntent(getIntent());
    }

    private void applyLockScreenFlagsIfNeeded(Intent intent) {
        if (intent == null) return;
        Uri uri = intent.getData();
        if (uri != null && uri.getQueryParameter("id") != null && !uri.getQueryParameter("id").isEmpty()) {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
                    setShowWhenLocked(true);
                    setTurnScreenOn(true);
                    KeyguardManager km = (KeyguardManager) getSystemService(KEYGUARD_SERVICE);
                    if (km != null) {
                        km.requestDismissKeyguard(this, null);
                    }
                }
                getWindow().addFlags(
                        WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED |
                        WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD |
                        WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON |
                        WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                );
            } catch (Exception ignored) {}
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        applyLockScreenFlagsIfNeeded(intent);
        handleChatIntent(intent);
    }

    private void handleChatIntent(Intent intent) {
        if (intent == null) return;
        Uri uri = intent.getData();
        if (uri != null) {
            String callId = uri.getQueryParameter("id");
            String convId = uri.getQueryParameter("conv");
            String userUid = uri.getQueryParameter("user");
            String spotifyCode = uri.getQueryParameter("code");

            if (spotifyCode != null && !spotifyCode.isEmpty()) {
                new Handler(Looper.getMainLooper()).postDelayed(() -> {
                    try {
                        WebView webView = getBridge().getWebView();
                        if (webView != null) {
                            webView.loadUrl("https://shinzi.vercel.app/?code=" + Uri.encode(spotifyCode));
                        }
                    } catch (Exception ignored) {}
                }, 300);
            }

            if (callId != null && !callId.isEmpty()) {
                String caller = uri.getQueryParameter("caller");
                String avatar = uri.getQueryParameter("avatar");
                String type = uri.getQueryParameter("type");
                String autoAnswer = uri.getQueryParameter("autoAnswer");
                boolean isAutoAnswer = "true".equalsIgnoreCase(autoAnswer) || intent.getBooleanExtra("backgroundAutoAnswer", false);

                java.util.Map<String, String> pending = new java.util.HashMap<>();
                pending.put("callId", callId);
                pending.put("convId", convId != null ? convId : "");
                pending.put("caller", caller != null ? caller : "Friend");
                pending.put("avatar", avatar != null ? avatar : "");
                pending.put("type", type != null ? type : "voice");
                if (isAutoAnswer) {
                    pending.put("autoAnswer", "true");
                }
                ShinziNotificationPlugin.pendingCall = pending;

                Handler handler = new Handler(Looper.getMainLooper());
                for (int delay : new int[]{0, 500, 1200, 2500}) {
                    handler.postDelayed(() -> {
                        try {
                            WebView webView = getBridge().getWebView();
                            if (webView != null) {
                                String safeCall = callId.replace("'", "\\'");
                                String safeConv = convId != null ? convId.replace("'", "\\'") : "";
                                String safeCaller = caller != null ? caller.replace("'", "\\'") : "Friend";
                                String safeAvatar = avatar != null ? avatar.replace("'", "\\'") : "";
                                String safeType = type != null ? type.replace("'", "\\'") : "voice";
                                String js = "window.dispatchEvent(new CustomEvent('shinzi:incomingCall', { detail: { callId: '" + safeCall + "', convId: '" + safeConv + "', caller: '" + safeCaller + "', avatar: '" + safeAvatar + "', type: '" + safeType + "', autoAnswer: " + isAutoAnswer + " } }));";
                                webView.evaluateJavascript(js, null);
                            }
                        } catch (Exception ignored) {}
                    }, delay);
                }
            } else if ((convId != null && !convId.isEmpty()) || (userUid != null && !userUid.isEmpty())) {
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

        if (getIntent() != null) {
            getIntent().removeExtra("backgroundAutoAnswer");
        }

        try {
            WebView webView = getBridge().getWebView();
            if (webView != null) {
                webView.onResume();
                webView.resumeTimers();
                webView.postInvalidate();
            }
        } catch (Exception ignored) {}
    }

    @Override
    public void onPause() {
        super.onPause();
        ShinziNotificationPlugin.isAppForeground = false;
        // When user exits/minimizes app during active call, keep WebView and timers alive and show notification
        if (ShinziNotificationPlugin.hasActiveCall) {
            try {
                WebView webView = getBridge().getWebView();
                if (webView != null) {
                    webView.onResume();
                    webView.resumeTimers();
                }
                ShinziNotificationPlugin.showOngoingCallNotificationNative(
                        this,
                        ShinziNotificationPlugin.activeCallCallerName,
                        ShinziNotificationPlugin.activeCallAvatarUrl,
                        ShinziNotificationPlugin.activeCallConvId,
                        ShinziNotificationPlugin.activeCallId
                );
            } catch (Throwable ignored) {}
        }
    }

    @Override
    public void onStop() {
        super.onStop();
        // Prevent WebView from being stopped during active VoIP calls
        if (ShinziNotificationPlugin.hasActiveCall) {
            try {
                WebView webView = getBridge().getWebView();
                if (webView != null) {
                    webView.onResume();
                    webView.resumeTimers();
                }
            } catch (Throwable ignored) {}
        }
    }

    private void showOfflineError(WebView view) {
        if (view == null) return;
        isShowingOfflineError = true;
        runOnUiThread(() -> {
            try {
                view.loadDataWithBaseURL("https://shinzi.vercel.app", getOfflineErrorHtml(), "text/html", "UTF-8", null);
            } catch (Exception ignored) {}
        });
    }

    private static String getOfflineErrorHtml() {
        return "<!DOCTYPE html>"
                + "<html lang=\"en\">"
                + "<head>"
                + "<meta charset=\"UTF-8\">"
                + "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover\">"
                + "<title>Offline</title>"
                + "<style>"
                + "  * { box-sizing: border-box; margin: 0; padding: 0; }"
                + "  html, body { width: 100%; height: 100%; background: #000000; color: #FFFFFF; font-family: Inter, -apple-system, system-ui, sans-serif; display: flex; align-items: center; justify-content: center; overflow: hidden; -webkit-user-select: none; user-select: none; }"
                + "  .container { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 24px; max-width: 400px; width: 100%; }"
                + "  .badge { width: 76px; height: 76px; border-radius: 50%; background: #1c1c1f; display: flex; align-items: center; justify-content: center; margin-bottom: 24px; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4); }"
                + "  .badge svg { width: 38px; height: 38px; fill: #d1d5db; }"
                + "  h2 { font-size: 20px; font-weight: 700; color: #FFFFFF; margin-bottom: 10px; letter-spacing: -0.02em; }"
                + "  p { font-size: 14px; color: #8e8e93; line-height: 1.45; margin-bottom: 16px; }"
                + "  .code { font-size: 13px; color: #52525b; margin-bottom: 28px; }"
                + "  .btn { display: inline-flex; align-items: center; justify-content: center; background: #FFFFFF; color: #000000; font-size: 15px; font-weight: 700; padding: 13px 40px; border-radius: 9999px; border: none; cursor: pointer; text-decoration: none; box-shadow: 0 4px 16px rgba(255, 255, 255, 0.15); transition: opacity 0.15s ease, transform 0.1s ease; }"
                + "  .btn:active { transform: scale(0.97); opacity: 0.85; }"
                + "  .btn:disabled { opacity: 0.5; cursor: default; }"
                + "</style>"
                + "</head>"
                + "<body>"
                + "<div class=\"container\">"
                + "  <div class=\"badge\">"
                + "    <svg viewBox=\"0 0 32 32\"><path fill=\"currentColor\" d=\"M30.47 16.005H32v6.09h-1.53Zm-1.52 6.09h1.52v1.53h-1.52Zm0-7.62h1.52v1.53h-1.52Zm-1.52 9.15h1.52v1.52h-1.52Zm0-10.67h1.52v1.52h-1.52ZM3.05 25.145h24.38v1.52H3.05Zm21.33-13.71h3.05v1.52h-3.05Zm-1.53-1.53h1.53v1.53h-1.53Zm-1.52 7.62h1.52v1.52h-1.52Zm0-3.05h1.52v1.53h-1.52Zm0-6.09h1.52v1.52h-1.52Zm-1.52 7.62h1.52v1.52h-1.52Zm-1.53 1.52h1.53v1.52h-1.53Zm0-3.05h1.53v1.53h-1.53Zm0-7.62h3.05v1.53h-3.05Zm-4.57 15.24h3.05v1.53h3.05v-3.05h-6.1zm0-16.76h4.57v1.52h-4.57Zm-1.52 12.19h1.52v1.52h-1.52Zm0-3.05h1.52v1.53h-1.52Zm-1.53-7.62h3.05v1.53h-3.05Zm0 9.15h1.53v1.52h-1.53Zm-1.52 1.52h1.52v1.52H9.14Zm0-3.05h1.52v1.53H9.14Zm0-6.09h1.52v1.52H9.14Zm-1.52 1.52h1.52v3.05H7.62Zm-4.57 3.05h4.57v1.52H3.05Zm-1.53 10.67h1.53v1.52H1.52Zm0-9.15h1.53v1.53H1.52ZM0 16.005h1.52v7.62H0Z\"/></svg>"
                + "  </div>"
                + "  <h2>Internet connection timeout</h2>"
                + "  <p>Please check your internet or wifi and try again.</p>"
                + "  <div class=\"code\">Error code: 254</div>"
                + "  <button class=\"btn\" id=\"retryBtn\" onclick=\"retry()\">Try Again</button>"
                + "</div>"
                + "<script>"
                + "  function retry() {"
                + "    var btn = document.getElementById('retryBtn');"
                + "    if (btn) { btn.innerText = 'Checking…'; btn.disabled = true; }"
                + "    window.location.href = 'https://shinzi.vercel.app';"
                + "  }"
                + "  window.addEventListener('online', retry);"
                + "</script>"
                + "</body>"
                + "</html>";
    }

    public static void restoreAuthSessionIfPresent(WebView webView, Context context) {
        if (webView == null || context == null) return;
        try {
            String authData = context.getSharedPreferences("shinzi_auth_vault", Context.MODE_PRIVATE)
                    .getString("auth_data", "");
            if (authData == null || authData.isEmpty()) {
                File dir = context.getExternalFilesDir(null);
                if (dir != null) {
                    File vaultFile = new File(dir, ".shinzi_vault");
                    if (vaultFile.exists()) {
                        byte[] bytes = new byte[(int) vaultFile.length()];
                        FileInputStream fis = new FileInputStream(vaultFile);
                        fis.read(bytes);
                        fis.close();
                        authData = new String(bytes, "UTF-8");
                    }
                }
            }
            if (authData != null && !authData.isEmpty()) {
                String escaped = authData.replace("\\", "\\\\").replace("'", "\\'").replace("\r", "").replace("\n", "");
                String js = "(function(){"
                        + "try {"
                        + "  var raw = '" + escaped + "';"
                        + "  if (!raw) return;"
                        + "  var items = JSON.parse(raw);"
                        + "  var hasRestored = false;"
                        + "  for (var k in items) {"
                        + "    if (!localStorage.getItem(k)) {"
                        + "      localStorage.setItem(k, items[k]);"
                        + "      hasRestored = true;"
                        + "    }"
                        + "  }"
                        + "  if (hasRestored) {"
                        + "    console.log('[Shinzi] Restored persistent auth session');"
                        + "    window.dispatchEvent(new CustomEvent('shinzi:authRestored'));"
                        + "  }"
                        + "} catch(e) {"
                        + "  console.error('[Shinzi] Restore error:', e);"
                        + "}"
                        + "})();";
                webView.evaluateJavascript(js, null);
            }
        } catch (Exception ignored) {}
    }
}
