package dev.pages.aurabeats;

import android.content.Intent;
import android.net.Uri;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * "Share" → AuraBeats from YouTube (or any app), and YouTube links opened
 * with AuraBeats. MainActivity hands every incoming intent here; the text
 * goes to the web app, which opens the video inside the app.
 */
@CapacitorPlugin(name = "ShareTarget")
public class ShareTargetPlugin extends Plugin {
    private static String pending;
    private static ShareTargetPlugin instance;

    @Override
    public void load() {
        instance = this;
    }

    static void handle(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        String text = null;
        if (Intent.ACTION_SEND.equals(action)) {
            CharSequence cs = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
            if (cs != null) text = cs.toString();
        } else if (Intent.ACTION_VIEW.equals(action)) {
            Uri data = intent.getData();
            if (data != null) text = data.toString();
        }
        if (text == null || text.trim().isEmpty()) return;
        // handled: re-creating the screen (rotation) must not open it again
        intent.setAction(Intent.ACTION_MAIN);
        ShareTargetPlugin p = instance;
        if (p != null && p.hasListeners("shared")) {
            JSObject o = new JSObject();
            o.put("text", text);
            p.notifyListeners("shared", o);
        } else {
            pending = text; // the web app asks with take() once it has started
        }
    }

    @PluginMethod
    public void take(PluginCall call) {
        JSObject o = new JSObject();
        if (pending != null) o.put("text", pending);
        pending = null;
        call.resolve(o);
    }
}
