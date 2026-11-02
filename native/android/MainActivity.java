package dev.pages.aurabeats;

import android.content.Intent;
import android.content.res.Configuration;
import android.os.Bundle;

import androidx.lifecycle.Lifecycle;

import com.getcapacitor.BridgeActivity;

/** Copied over Capacitor's generated MainActivity by the APK workflows. */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // native/android: in-app downloads, songs already on the phone and
        // the floating video window, YouTube account sign-in, the player's
        // brightness / sound swipes.
        registerPlugin(VideoSaverPlugin.class);
        registerPlugin(DeviceMusicPlugin.class);
        registerPlugin(PipPlugin.class);
        registerPlugin(YtLoginPlugin.class);
        registerPlugin(ShareTargetPlugin.class);
        registerPlugin(PlayerScreenPlugin.class);
        super.onCreate(savedInstanceState);
        // opened by "Share → AuraBeats" or a YouTube link
        ShareTargetPlugin.handle(getIntent());
    }

    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        ShareTargetPlugin.handle(intent);
    }

    @Override
    protected void onUserLeaveHint() {
        super.onUserLeaveHint();
        PipPlugin.onUserLeaveHint(this);
    }

    @Override
    public void onPictureInPictureModeChanged(boolean isInPictureInPictureMode, Configuration newConfig) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig);
        // Closed with ✕ / swiped away: the activity is already stopped.
        // Expanded back to the app: it is started again.
        boolean dismissed = !isInPictureInPictureMode && getLifecycle().getCurrentState() == Lifecycle.State.CREATED;
        PipPlugin.onModeChanged(isInPictureInPictureMode, dismissed);
    }
}
