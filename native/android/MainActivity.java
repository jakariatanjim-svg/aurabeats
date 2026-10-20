package dev.pages.aurabeats;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

/** Copied over Capacitor's generated MainActivity by the APK workflows. */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // native/android: in-app downloads + songs already on the phone.
        registerPlugin(VideoSaverPlugin.class);
        registerPlugin(DeviceMusicPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
