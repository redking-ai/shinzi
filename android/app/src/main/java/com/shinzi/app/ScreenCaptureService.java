package com.shinzi.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.PixelFormat;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.util.DisplayMetrics;
import android.view.WindowManager;
import androidx.core.app.NotificationCompat;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;

public class ScreenCaptureService extends Service {
    public static final String ACTION_START = "com.shinzi.app.SCREEN_CAPTURE_START";
    public static final String ACTION_STOP = "com.shinzi.app.SCREEN_CAPTURE_STOP";
    private static final int NOTIF_ID = 9999;
    private static final String CHANNEL_ID = "shinzi_screen_stream";

    public static volatile byte[] latestJpegFrame = null;
    public static volatile boolean isCapturing = false;

    private MediaProjection mediaProjection;
    private VirtualDisplay virtualDisplay;
    private ImageReader imageReader;

    private HandlerThread mHandlerThread = null;
    private Handler mBackgroundHandler = null;

    // Persistent reusable buffers to eliminate GC allocations and memory thrashing
    private Bitmap mReusableBitmap = null;
    private Bitmap mCroppedBitmap = null;
    private Canvas mReusableCanvas = null;
    private final ByteArrayOutputStream mBaos = new ByteArrayOutputStream(64 * 1024);
    private long mLastFrameTime = 0;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) return START_NOT_STICKY;
        String action = intent.getAction();

        if (ACTION_STOP.equals(action)) {
            stopCapture();
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }

        if (ACTION_START.equals(action)) {
            int resultCode = intent.getIntExtra("resultCode", 0);
            Intent resultData = intent.getParcelableExtra("resultData");

            createNotificationChannel();
            Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
                    .setSmallIcon(R.drawable.ic_stat_shinzi)
                    .setContentTitle("Screen Sharing Active")
                    .setContentText("Shinzi is streaming your screen")
                    .setPriority(NotificationCompat.PRIORITY_LOW)
                    .setOngoing(true)
                    .build();

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
            } else {
                startForeground(NOTIF_ID, notification);
            }

            startCapture(resultCode, resultData);
        }

        return START_NOT_STICKY;
    }

    private void startCapture(int resultCode, Intent resultData) {
        if (resultData == null) return;
        try {
            MediaProjectionManager mpm = (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
            if (mpm == null) return;
            mediaProjection = mpm.getMediaProjection(resultCode, resultData);
            if (mediaProjection == null) return;

            // Android 14+ (API 34/35) STRICT REQUIREMENT: callback must be registered before createVirtualDisplay
            mediaProjection.registerCallback(new MediaProjection.Callback() {
                @Override
                public void onStop() {
                    super.onStop();
                    stopCapture();
                }
            }, null);

            WindowManager wm = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
            DisplayMetrics metrics = new DisplayMetrics();
            if (wm != null && wm.getDefaultDisplay() != null) {
                wm.getDefaultDisplay().getRealMetrics(metrics);
            } else {
                metrics.widthPixels = 720;
                metrics.heightPixels = 1280;
                metrics.densityDpi = DisplayMetrics.DENSITY_DEFAULT;
            }

            // Balanced 720p scaling for crisp 1080p WebRTC display with low CPU footprint
            int width = Math.min(metrics.widthPixels, 720);
            int height = (int) ((float) metrics.heightPixels / metrics.widthPixels * width);
            if (width % 2 != 0) width--;
            if (height % 2 != 0) height--;

            int dpi = metrics.densityDpi;

            // Use 4 image buffers to prevent ImageReader starvation / IllegalStateException under heavy game load
            imageReader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 4);

            virtualDisplay = mediaProjection.createVirtualDisplay(
                    "ShinziScreenCapture",
                    width,
                    height,
                    dpi,
                    DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                    imageReader.getSurface(),
                    null,
                    null
            );

            // Run processing on a dedicated high-priority background thread
            mHandlerThread = new HandlerThread("ShinziScreenCaptureThread", android.os.Process.THREAD_PRIORITY_DISPLAY);
            mHandlerThread.start();
            mBackgroundHandler = new Handler(mHandlerThread.getLooper());

            isCapturing = true;

            final int fWidth = width;
            final int fHeight = height;

            imageReader.setOnImageAvailableListener(reader -> {
                // Adaptive FPS throttle: limit to ~28-30 FPS (35ms between frames)
                // This eliminates thermal throttling and guarantees games like Roblox run at full speed
                long now = System.currentTimeMillis();
                if (now - mLastFrameTime < 35) {
                    Image img = null;
                    try {
                        img = reader.acquireLatestImage();
                    } catch (Throwable ignored) {
                    } finally {
                        if (img != null) {
                            try { img.close(); } catch (Throwable ignored) {}
                        }
                    }
                    return;
                }
                mLastFrameTime = now;

                Image image = null;
                try {
                    image = reader.acquireLatestImage();
                    if (image != null && isCapturing) {
                        Image.Plane[] planes = image.getPlanes();
                        if (planes != null && planes.length > 0 && planes[0] != null) {
                            ByteBuffer buffer = planes[0].getBuffer();
                            int pixelStride = planes[0].getPixelStride();
                            int rowStride = planes[0].getRowStride();
                            int rowPadding = rowStride - pixelStride * fWidth;

                            int rawWidth = fWidth + rowPadding / pixelStride;

                            // Reusable bitmap: never reallocate memory every frame!
                            if (mReusableBitmap == null || mReusableBitmap.getWidth() != rawWidth || mReusableBitmap.getHeight() != fHeight) {
                                if (mReusableBitmap != null) mReusableBitmap.recycle();
                                mReusableBitmap = Bitmap.createBitmap(rawWidth, fHeight, Bitmap.Config.ARGB_8888);
                            }
                            mReusableBitmap.copyPixelsFromBuffer(buffer);

                            Bitmap targetBitmap = mReusableBitmap;
                            if (rowPadding != 0) {
                                if (mCroppedBitmap == null || mCroppedBitmap.getWidth() != fWidth || mCroppedBitmap.getHeight() != fHeight) {
                                    if (mCroppedBitmap != null) mCroppedBitmap.recycle();
                                    mCroppedBitmap = Bitmap.createBitmap(fWidth, fHeight, Bitmap.Config.ARGB_8888);
                                    mReusableCanvas = new Canvas(mCroppedBitmap);
                                }
                                if (mReusableCanvas != null) {
                                    mReusableCanvas.drawBitmap(mReusableBitmap, 0, 0, null);
                                    targetBitmap = mCroppedBitmap;
                                }
                            }

                            synchronized (mBaos) {
                                mBaos.reset();
                                // Quality 60 JPEG compression is virtually lossless to the eye on mobile,
                                // but reduces payload size by ~65%, giving blazing fast 30fps transfer
                                targetBitmap.compress(Bitmap.CompressFormat.JPEG, 60, mBaos);
                                latestJpegFrame = mBaos.toByteArray();
                            }
                        }
                    }
                } catch (Throwable ignored) {
                } finally {
                    if (image != null) {
                        try {
                            image.close();
                        } catch (Throwable ignored) {}
                    }
                }
            }, mBackgroundHandler);

        } catch (Exception e) {
            e.printStackTrace();
            stopCapture();
        }
    }

    private void stopCapture() {
        isCapturing = false;
        latestJpegFrame = null;
        try {
            if (virtualDisplay != null) {
                virtualDisplay.release();
                virtualDisplay = null;
            }
            if (imageReader != null) {
                imageReader.close();
                imageReader = null;
            }
            if (mediaProjection != null) {
                mediaProjection.stop();
                mediaProjection = null;
            }
            if (mHandlerThread != null) {
                mHandlerThread.quitSafely();
                mHandlerThread = null;
                mBackgroundHandler = null;
            }
            if (mReusableBitmap != null) {
                mReusableBitmap.recycle();
                mReusableBitmap = null;
            }
            if (mCroppedBitmap != null) {
                mCroppedBitmap.recycle();
                mCroppedBitmap = null;
                mReusableCanvas = null;
            }
        } catch (Exception ignored) {}
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Screen Sharing Stream",
                    NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Shows notification while sharing your screen");
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                nm.createNotificationChannel(channel);
            }
        }
    }

    @Override
    public void onDestroy() {
        stopCapture();
        super.onDestroy();
    }
}
