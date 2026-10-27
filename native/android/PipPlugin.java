package dev.pages.aurabeats;

import android.app.Activity;
import android.app.PendingIntent;
import android.app.PictureInPictureParams;
import android.app.RemoteAction;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.graphics.drawable.Icon;
import android.os.Build;
import android.util.Rational;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.List;

/**
 * Floating video window (Android picture-in-picture, Android 8+).
 *
 * The page tells us whether a video is playing (configure). Leaving the app
 * then shrinks the whole app into a small window and the page shows only the
 * video (it listens for "change"). The window has a play / pause button
 * ("action" event).
 *
 * JS: Pip.isSupported() → { supported }
 *     Pip.configure({ auto, playing, width, height })
 *     Pip.enter()
 *     events: "change" { active, dismissed }, "action" { action: "toggle" }
 *
 * MainActivity forwards onUserLeaveHint (Android 8–11; 12+ enters on its
 * own via setAutoEnterEnabled) and onPictureInPictureModeChanged.
 */
@CapacitorPlugin(name = "Pip")
public class PipPlugin extends Plugin {
    static final String ACTION_TOGGLE = "dev.pages.aurabeats.PIP_TOGGLE";
    private static PipPlugin instance;

    private volatile boolean auto = false;
    private volatile boolean playing = false;
    private volatile int width = 16;
    private volatile int height = 9;
    private BroadcastReceiver receiver;

    @Override
    public void load() {
        instance = this;
        receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (!ACTION_TOGGLE.equals(intent.getAction())) return;
                JSObject r = new JSObject();
                r.put("action", "toggle");
                notifyListeners("action", r);
            }
        };
        IntentFilter filter = new IntentFilter(ACTION_TOGGLE);
        try {
            if (Build.VERSION.SDK_INT >= 33) getContext().registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED);
            else getContext().registerReceiver(receiver, filter);
        } catch (Exception ignored) {
            receiver = null;
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (receiver != null) {
            try {
                getContext().unregisterReceiver(receiver);
            } catch (Exception ignored) {
            }
            receiver = null;
        }
        if (instance == this) instance = null;
    }

    private static boolean supported(Activity a) {
        return a != null
            && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            && a.getPackageManager().hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE);
    }

    @PluginMethod
    public void isSupported(PluginCall call) {
        JSObject r = new JSObject();
        r.put("supported", supported(getActivity()));
        call.resolve(r);
    }

    @PluginMethod
    public void configure(PluginCall call) {
        auto = Boolean.TRUE.equals(call.getBoolean("auto", false));
        playing = Boolean.TRUE.equals(call.getBoolean("playing", false));
        Integer w = call.getInt("width", 16);
        Integer h = call.getInt("height", 9);
        width = w != null && w > 0 ? w : 16;
        height = h != null && h > 0 ? h : 9;
        final Activity a = getActivity();
        if (supported(a)) {
            a.runOnUiThread(() -> {
                try {
                    a.setPictureInPictureParams(build(a));
                } catch (Exception ignored) {
                }
            });
        }
        call.resolve();
    }

    @PluginMethod
    public void enter(PluginCall call) {
        final Activity a = getActivity();
        if (!supported(a)) {
            call.reject("Picture-in-picture is not available on this phone");
            return;
        }
        a.runOnUiThread(() -> {
            try {
                boolean ok = a.enterPictureInPictureMode(build(a));
                JSObject r = new JSObject();
                r.put("entered", ok);
                call.resolve(r);
            } catch (Exception e) {
                call.reject(String.valueOf(e.getMessage()));
            }
        });
    }

    private PictureInPictureParams build(Activity a) {
        PictureInPictureParams.Builder b = new PictureInPictureParams.Builder();
        b.setAspectRatio(ratio());
        b.setActions(actions(a));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            b.setAutoEnterEnabled(auto);
            b.setSeamlessResizeEnabled(true);
        }
        return b.build();
    }

    /** Android only accepts shapes between 1:2.39 and 2.39:1. */
    private Rational ratio() {
        double r = (double) width / (double) height;
        if (r > 2.39) return new Rational(239, 100);
        if (r < 1 / 2.39) return new Rational(100, 239);
        return new Rational(width, height);
    }

    private List<RemoteAction> actions(Activity a) {
        List<RemoteAction> list = new ArrayList<>();
        try {
            Intent intent = new Intent(ACTION_TOGGLE).setPackage(a.getPackageName());
            PendingIntent pi = PendingIntent.getBroadcast(
                a,
                7301,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
            String label = playing ? "Pause" : "Play";
            Icon icon = Icon.createWithResource(a, playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play);
            list.add(new RemoteAction(icon, label, label, pi));
        } catch (Exception ignored) {
        }
        return list;
    }

    /** Android 8–11: Home / Recents while a video plays → floating window. */
    static void onUserLeaveHint(Activity a) {
        PipPlugin p = instance;
        if (p == null || !p.auto || !supported(a) || Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) return;
        try {
            a.enterPictureInPictureMode(p.build(a));
        } catch (Exception ignored) {
        }
    }

    /** The window opened / closed. dismissed = closed with ✕ or swiped away (not expanded back). */
    static void onModeChanged(boolean active, boolean dismissed) {
        PipPlugin p = instance;
        if (p == null) return;
        JSObject r = new JSObject();
        r.put("active", active);
        r.put("dismissed", dismissed);
        p.notifyListeners("change", r);
    }
}
