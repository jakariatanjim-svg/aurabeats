package dev.pages.aurabeats;

import android.Manifest;
import android.content.ContentUris;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Songs already on the phone — Music folder, Chrome / WhatsApp downloads,
 * anything Android's media library knows. Read-only.
 *
 * JS: DeviceMusic.list() → { granted, tracks: [{ id, title, artist, album,
 *     duration (ms), uri, art, added, size, mime, folder }] }
 *     DeviceMusic.request() → asks for permission, then the same as list().
 */
@CapacitorPlugin(
    name = "DeviceMusic",
    permissions = {
        @Permission(strings = { "android.permission.READ_MEDIA_AUDIO" }, alias = "audio"),
        @Permission(strings = { Manifest.permission.READ_EXTERNAL_STORAGE }, alias = "storage"),
    }
)
public class DeviceMusicPlugin extends Plugin {
    private String alias() {
        return Build.VERSION.SDK_INT >= 33 ? "audio" : "storage";
    }

    private boolean granted() {
        return getPermissionState(alias()) == PermissionState.GRANTED;
    }

    @PluginMethod
    public void list(PluginCall call) {
        if (!granted()) {
            JSObject r = new JSObject();
            r.put("granted", false);
            r.put("tracks", new JSArray());
            call.resolve(r);
            return;
        }
        resolveList(call);
    }

    @PluginMethod
    public void request(PluginCall call) {
        if (granted()) {
            resolveList(call);
            return;
        }
        requestPermissionForAlias(alias(), call, "afterPermission");
    }

    @PermissionCallback
    private void afterPermission(PluginCall call) {
        list(call);
    }

    private void resolveList(PluginCall call) {
        final PluginCall c = call;
        new Thread(() -> {
            try {
                JSObject r = new JSObject();
                r.put("granted", true);
                r.put("tracks", query());
                c.resolve(r);
            } catch (Exception e) {
                c.reject(String.valueOf(e.getMessage()));
            }
        }).start();
    }

    private JSArray query() {
        Uri collection = Build.VERSION.SDK_INT >= 29
            ? MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL)
            : MediaStore.Audio.Media.EXTERNAL_CONTENT_URI;
        String folderCol = Build.VERSION.SDK_INT >= 29 ? MediaStore.Audio.Media.RELATIVE_PATH : MediaStore.Audio.Media.DATA;
        String[] cols = {
            MediaStore.Audio.Media._ID,
            MediaStore.Audio.Media.TITLE,
            MediaStore.Audio.Media.ARTIST,
            MediaStore.Audio.Media.ALBUM,
            MediaStore.Audio.Media.ALBUM_ID,
            MediaStore.Audio.Media.DURATION,
            MediaStore.Audio.Media.DATE_ADDED,
            MediaStore.Audio.Media.SIZE,
            MediaStore.Audio.Media.MIME_TYPE,
            folderCol,
        };
        // Songs, not ringtones / notification sounds / voice notes under 20 s.
        String where = MediaStore.Audio.Media.DURATION + " >= 20000 AND "
            + MediaStore.Audio.Media.IS_RINGTONE + " = 0 AND "
            + MediaStore.Audio.Media.IS_NOTIFICATION + " = 0 AND "
            + MediaStore.Audio.Media.IS_ALARM + " = 0";
        JSArray out = new JSArray();
        Uri artBase = Uri.parse("content://media/external/audio/albumart");
        try (Cursor cur = getContext().getContentResolver().query(collection, cols, where, null, MediaStore.Audio.Media.DATE_ADDED + " DESC")) {
            if (cur == null) return out;
            while (cur.moveToNext()) {
                long id = cur.getLong(0);
                long albumId = cur.getLong(4);
                JSObject t = new JSObject();
                t.put("id", String.valueOf(id));
                t.put("title", cur.getString(1));
                String artist = cur.getString(2);
                t.put("artist", artist == null || "<unknown>".equals(artist) ? "" : artist);
                t.put("album", cur.getString(3));
                t.put("duration", cur.getLong(5));
                t.put("added", cur.getLong(6));
                t.put("size", cur.getLong(7));
                t.put("mime", cur.getString(8));
                t.put("folder", cur.getString(9));
                t.put("uri", ContentUris.withAppendedId(collection, id).toString());
                t.put("art", ContentUris.withAppendedId(artBase, albumId).toString());
                out.put(t);
            }
        }
        return out;
    }
}
