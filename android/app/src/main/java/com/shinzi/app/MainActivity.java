package com.shinzi.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ShinziNotificationPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
