package dev.pages.aurabeats;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

/** Copied over Capacitor's generated MainActivity by the APK workflows. */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // In-app video downloader (native/android/VideoSaverPlugin.java).
        registerPlugin(VideoSaverPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
