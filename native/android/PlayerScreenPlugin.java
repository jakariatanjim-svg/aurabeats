package dev.pages.aurabeats;

import android.app.Activity;
import android.content.Context;
import android.media.AudioManager;
import android.provider.Settings;
import android.view.Window;
import android.view.WindowManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Brightness and sound level for the video player's swipe gestures.
 *
 * Brightness changes only this app's window (no permission needed) and goes
 * back to the phone's own setting with reset(). Sound is the phone's media
 * volume, set without Android's volume popup (the player shows its own).
 *
 * JS: PlayerScreen.get() → { brightness 0..1, volume 0..1 }
 *     PlayerScreen.setBrightness({ value 0..1 })
 *     PlayerScreen.setVolume({ value 0..1 })
 *     PlayerScreen.reset()
 */
@CapacitorPlugin(name = "PlayerScreen")
public class PlayerScreenPlugin extends Plugin {
    private AudioManager audio() {
        return (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
    }

    private float systemBrightness() {
        try {
            int v = Settings.System.getInt(getContext().getContentResolver(), Settings.System.SCREEN_BRIGHTNESS);
            return Math.max(0f, Math.min(1f, v / 255f));
        } catch (Exception e) {
            return 0.5f;
        }
    }

    @PluginMethod
    public void get(PluginCall call) {
        Activity act = getActivity();
        float b = -1f;
        if (act != null) b = act.getWindow().getAttributes().screenBrightness;
        if (b < 0) b = systemBrightness();
        AudioManager am = audio();
        float vol = 1f;
        if (am != null) {
            int max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
            if (max > 0) vol = am.getStreamVolume(AudioManager.STREAM_MUSIC) / (float) max;
        }
        JSObject r = new JSObject();
        r.put("brightness", b);
        r.put("volume", vol);
        call.resolve(r);
    }

    private void applyBrightness(final float value) {
        final Activity act = getActivity();
        if (act == null) return;
        act.runOnUiThread(() -> {
            Window w = act.getWindow();
            WindowManager.LayoutParams lp = w.getAttributes();
            lp.screenBrightness = value;
            w.setAttributes(lp);
        });
    }

    @PluginMethod
    public void setBrightness(PluginCall call) {
        Double v = call.getDouble("value");
        if (v == null) {
            call.reject("value missing");
            return;
        }
        // never fully black: 1 % is the lowest
        applyBrightness((float) Math.max(0.01, Math.min(1.0, v)));
        call.resolve();
    }

    @PluginMethod
    public void setVolume(PluginCall call) {
        Double v = call.getDouble("value");
        AudioManager am = audio();
        if (v == null || am == null) {
            call.reject("unavailable");
            return;
        }
        try {
            int max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
            int idx = (int) Math.round(Math.max(0.0, Math.min(1.0, v)) * max);
            am.setStreamVolume(AudioManager.STREAM_MUSIC, idx, 0);
            call.resolve();
        } catch (Exception e) {
            // e.g. Do Not Disturb refuses the change
            call.reject("volume refused");
        }
    }

    /** Back to the phone's own brightness. */
    @PluginMethod
    public void reset(PluginCall call) {
        applyBrightness(WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE);
        call.resolve();
    }
}
