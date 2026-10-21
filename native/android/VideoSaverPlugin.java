package dev.pages.aurabeats;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.media.MediaMuxer;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * In-app video + song downloader. YouTube serves HD picture and sound as two
 * separate files; this downloads both (in 10 MB ranges, the way yt-dlp does,
 * so the server never throttles) and joins them with Android's own
 * MediaMuxer — no re-encoding, no ffmpeg, nothing added to the APK size.
 * The thumbnail, title and artist are written into the file (MP4 / M4A), and
 * the result goes to Download/AuraBeats/Music or …/Videos, where the gallery,
 * music players and file manager see it.
 *
 * JS: VideoSaver.download({ id, videoUrl, audioUrl?, fileName, mime, userAgent,
 *     thumbUrls?: string[], title?, artist?, folder?: "Music" | "Videos", squareCover? })
 * events: "progress" {id, phase, done, total}, "done" {id, uri, name}, "error" {id, message, cancelled}
 */
@CapacitorPlugin(name = "VideoSaver")
public class VideoSaverPlugin extends Plugin {
    private static final long CHUNK = 10L * 1024 * 1024;
    private final ExecutorService pool = Executors.newFixedThreadPool(2);
    private final Map<String, AtomicBoolean> cancels = new ConcurrentHashMap<>();

    private interface Progress {
        void add(long n);
    }

    @PluginMethod
    public void download(PluginCall call) {
        final String id = call.getString("id");
        final String videoUrl = call.getString("videoUrl");
        final String audioUrl = call.getString("audioUrl");
        final String fileName = call.getString("fileName", "video.mp4");
        final String mime = call.getString("mime", "video/mp4");
        final String ua = call.getString("userAgent", "Mozilla/5.0");
        final Meta meta = new Meta();
        meta.title = call.getString("title", "");
        meta.artist = call.getString("artist", "");
        meta.folder = call.getString("folder", "");
        meta.square = Boolean.TRUE.equals(call.getBoolean("squareCover", false));
        JSArray thumbs = call.getArray("thumbUrls", new JSArray());
        for (int i = 0; thumbs != null && i < thumbs.length(); i++) {
            String u = thumbs.optString(i, null);
            if (u != null && !u.isEmpty()) meta.thumbs.add(u);
        }
        if (id == null || videoUrl == null) {
            call.reject("id and videoUrl are required");
            return;
        }
        final AtomicBoolean cancel = new AtomicBoolean(false);
        cancels.put(id, cancel);
        call.resolve();
        pool.execute(() -> run(id, videoUrl, audioUrl, fileName, mime, ua, meta, cancel));
    }

    private static final class Meta {
        String title, artist, folder;
        boolean square;
        final List<String> thumbs = new ArrayList<>();
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        AtomicBoolean c = cancels.get(call.getString("id", ""));
        if (c != null) c.set(true);
        call.resolve();
    }

    @PluginMethod
    public void open(PluginCall call) {
        String uri = call.getString("uri");
        String mime = call.getString("mime", "video/mp4");
        if (uri == null) {
            call.reject("uri is required");
            return;
        }
        try {
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(Uri.parse(uri), mime);
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject(String.valueOf(e.getMessage()));
        }
    }

    private void run(String id, String videoUrl, String audioUrl, String fileName, String mime, String ua, Meta meta, AtomicBoolean cancel) {
        File dir = new File(getContext().getCacheDir(), "video-saver");
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        File v = new File(dir, id + ".v");
        File a = new File(dir, id + ".a");
        File out = new File(dir, id + ".out");
        File tagged = new File(dir, id + ".tag");
        try {
            long vSize = sizeOf(videoUrl, ua);
            long aSize = audioUrl != null ? sizeOf(audioUrl, ua) : 0;
            final long total = (vSize > 0 ? vSize : 0) + (aSize > 0 ? aSize : 0);
            final long[] done = {0};
            final long[] lastEmit = {0};
            Progress p = n -> {
                done[0] += n;
                long now = System.currentTimeMillis();
                if (now - lastEmit[0] > 350) {
                    lastEmit[0] = now;
                    emitProgress(id, "download", done[0], total);
                }
            };

            fetch(videoUrl, ua, v, vSize, p, cancel);
            File result = v;
            boolean plainMp4 = false; // written by MediaMuxer → safe to tag
            if (audioUrl != null) {
                fetch(audioUrl, ua, a, aSize, p, cancel);
                emitProgress(id, "merge", done[0], total);
                mux(v, a, out, mime);
                result = out;
                plainMp4 = !mime.contains("webm");
            } else if (mime.startsWith("audio/")) {
                // A song: YouTube's audio comes as a streaming (fragmented)
                // file; rewrite it as a plain .m4a so every player shows the
                // right length and can seek. Keep the original if that fails.
                emitProgress(id, "merge", done[0], total);
                try {
                    remux(v, out);
                    result = out;
                    plainMp4 = true;
                } catch (Exception ignored) {
                    result = v;
                }
            }
            if (cancel.get()) throw new IOException("cancelled");
            // Thumbnail + title + artist inside the file. Optional: any
            // problem here just leaves the file untagged.
            if (plainMp4) {
                try {
                    byte[] cover = cover(meta, ua);
                    Mp4Tagger.tag(result, tagged, meta.title, meta.artist, cover);
                    result = tagged;
                } catch (Exception ignored) {
                }
            }
            Uri uri = publish(result, fileName, mime, meta.folder);
            JSObject r = new JSObject();
            r.put("id", id);
            r.put("uri", uri != null ? uri.toString() : "");
            r.put("name", fileName);
            notifyListeners("done", r);
        } catch (Exception e) {
            JSObject r = new JSObject();
            r.put("id", id);
            r.put("cancelled", cancel.get());
            r.put("message", cancel.get() ? "cancelled" : String.valueOf(e.getMessage()));
            notifyListeners("error", r);
        } finally {
            //noinspection ResultOfMethodCallIgnored
            v.delete();
            //noinspection ResultOfMethodCallIgnored
            a.delete();
            //noinspection ResultOfMethodCallIgnored
            out.delete();
            //noinspection ResultOfMethodCallIgnored
            tagged.delete();
            cancels.remove(id);
        }
    }

    private void emitProgress(String id, String phase, long done, long total) {
        JSObject r = new JSObject();
        r.put("id", id);
        r.put("phase", phase);
        r.put("done", done);
        r.put("total", total);
        notifyListeners("progress", r);
    }

    /** YouTube stream URLs carry the byte size as "clen"; otherwise ask the server. */
    private long sizeOf(String url, String ua) {
        try {
            String clen = Uri.parse(url).getQueryParameter("clen");
            if (clen != null) return Long.parseLong(clen);
        } catch (Exception ignored) {
        }
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setRequestMethod("HEAD");
            c.setRequestProperty("User-Agent", ua);
            c.setConnectTimeout(15000);
            c.setReadTimeout(15000);
            if (c.getResponseCode() / 100 == 2) return c.getContentLengthLong();
        } catch (Exception ignored) {
        } finally {
            if (c != null) c.disconnect();
        }
        return -1;
    }

    private void fetch(String url, String ua, File f, long size, Progress p, AtomicBoolean cancel) throws Exception {
        byte[] buf = new byte[1 << 16];
        long[] pos = {0};
        int fails = 0;
        try (OutputStream os = new BufferedOutputStream(new FileOutputStream(f), 1 << 17)) {
            while (size <= 0 || pos[0] < size) {
                if (cancel.get()) throw new IOException("cancelled");
                long end = size > 0 ? Math.min(size - 1, pos[0] + CHUNK - 1) : pos[0] + CHUNK - 1;
                try {
                    boolean more = chunk(url, ua, pos, end, size, os, buf, p, cancel);
                    fails = 0;
                    if (!more) break;
                } catch (IOException e) {
                    if (cancel.get() || ++fails >= 6) throw e;
                    Thread.sleep(700L * fails);
                }
            }
        }
        if (size > 0 && pos[0] < size) throw new IOException("incomplete download");
    }

    /** One range request, appended to the file. Resumes from pos after a failure. */
    private boolean chunk(String url, String ua, long[] pos, long end, long size, OutputStream os, byte[] buf, Progress p, AtomicBoolean cancel) throws IOException {
        long start = pos[0];
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        try {
            c.setRequestProperty("User-Agent", ua);
            c.setRequestProperty("Range", "bytes=" + start + "-" + end);
            c.setConnectTimeout(15000);
            c.setReadTimeout(30000);
            int code = c.getResponseCode();
            if (code == 416) return false;
            if (code != 206 && !(code == 200 && start == 0)) throw new IOException("HTTP " + code);
            long read = 0;
            try (InputStream in = c.getInputStream()) {
                int n;
                while ((n = in.read(buf)) != -1) {
                    if (cancel.get()) throw new IOException("cancelled");
                    os.write(buf, 0, n);
                    pos[0] += n;
                    read += n;
                    p.add(n);
                }
            }
            if (code == 200) return false; // whole file in one go
            if (size > 0) return pos[0] < size;
            return read >= end - start + 1;
        } finally {
            c.disconnect();
        }
    }

    private static int pickTrack(MediaExtractor e, String prefix) {
        for (int i = 0; i < e.getTrackCount(); i++) {
            String m = e.getTrackFormat(i).getString(MediaFormat.KEY_MIME);
            if (m != null && m.startsWith(prefix)) return i;
        }
        return -1;
    }

    /** Join picture + sound without re-encoding, interleaved by timestamp. */
    private void mux(File v, File a, File out, String mime) throws IOException {
        MediaExtractor ve = new MediaExtractor();
        MediaExtractor ae = new MediaExtractor();
        MediaMuxer m = null;
        try {
            ve.setDataSource(v.getAbsolutePath());
            ae.setDataSource(a.getAbsolutePath());
            int vt = pickTrack(ve, "video/");
            int at = pickTrack(ae, "audio/");
            if (vt < 0 || at < 0) throw new IOException("missing audio or video track");
            ve.selectTrack(vt);
            ae.selectTrack(at);
            int format = mime.contains("webm") ? MediaMuxer.OutputFormat.MUXER_OUTPUT_WEBM : MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4;
            m = new MediaMuxer(out.getAbsolutePath(), format);
            int mv = m.addTrack(ve.getTrackFormat(vt));
            int ma = m.addTrack(ae.getTrackFormat(at));
            m.start();
            ByteBuffer buf = ByteBuffer.allocate(8 * 1024 * 1024);
            MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
            boolean vDone = false;
            boolean aDone = false;
            while (!vDone || !aDone) {
                boolean video = !vDone && (aDone || ve.getSampleTime() <= ae.getSampleTime());
                MediaExtractor e = video ? ve : ae;
                buf.clear();
                int n = e.readSampleData(buf, 0);
                if (n < 0) {
                    if (video) vDone = true;
                    else aDone = true;
                    continue;
                }
                info.offset = 0;
                info.size = n;
                info.presentationTimeUs = e.getSampleTime();
                info.flags = (e.getSampleFlags() & MediaExtractor.SAMPLE_FLAG_SYNC) != 0 ? MediaCodec.BUFFER_FLAG_KEY_FRAME : 0;
                m.writeSampleData(video ? mv : ma, buf, info);
                e.advance();
            }
            m.stop();
        } finally {
            if (m != null) {
                try {
                    m.release();
                } catch (Exception ignored) {
                }
            }
            ve.release();
            ae.release();
        }
    }

    /** Copy the single audio track into a fresh MP4 container (no re-encoding). */
    private void remux(File in, File out) throws IOException {
        MediaExtractor ex = new MediaExtractor();
        MediaMuxer m = null;
        try {
            ex.setDataSource(in.getAbsolutePath());
            int t = pickTrack(ex, "audio/");
            if (t < 0) throw new IOException("no audio track");
            ex.selectTrack(t);
            m = new MediaMuxer(out.getAbsolutePath(), MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
            int mt = m.addTrack(ex.getTrackFormat(t));
            m.start();
            ByteBuffer buf = ByteBuffer.allocate(1024 * 1024);
            MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
            while (true) {
                buf.clear();
                int n = ex.readSampleData(buf, 0);
                if (n < 0) break;
                info.offset = 0;
                info.size = n;
                info.presentationTimeUs = ex.getSampleTime();
                info.flags = (ex.getSampleFlags() & MediaExtractor.SAMPLE_FLAG_SYNC) != 0 ? MediaCodec.BUFFER_FLAG_KEY_FRAME : 0;
                m.writeSampleData(mt, buf, info);
                ex.advance();
            }
            m.stop();
        } finally {
            if (m != null) {
                try {
                    m.release();
                } catch (Exception ignored) {
                }
            }
            ex.release();
        }
    }

    /**
     * The video's thumbnail as JPEG — first URL that answers (largest first).
     * Songs get the centre square: YouTube Music art is a square inside a
     * 16:9 frame with bars.
     */
    private byte[] cover(Meta meta, String ua) throws IOException {
        for (String u : meta.thumbs) {
            HttpURLConnection c = null;
            try {
                c = (HttpURLConnection) new URL(u).openConnection();
                c.setRequestProperty("User-Agent", ua);
                c.setConnectTimeout(10000);
                c.setReadTimeout(15000);
                if (c.getResponseCode() != 200) continue;
                ByteArrayOutputStream bo = new ByteArrayOutputStream();
                try (InputStream in = c.getInputStream()) {
                    copy(in, bo);
                }
                byte[] raw = bo.toByteArray();
                Bitmap bmp = BitmapFactory.decodeByteArray(raw, 0, raw.length);
                if (bmp == null || bmp.getWidth() < 200) continue; // YouTube's grey placeholder is 120 px
                Bitmap pic = bmp;
                if (meta.square && bmp.getWidth() > bmp.getHeight()) {
                    int s = bmp.getHeight();
                    pic = Bitmap.createBitmap(bmp, (bmp.getWidth() - s) / 2, 0, s, s);
                }
                ByteArrayOutputStream jo = new ByteArrayOutputStream();
                pic.compress(Bitmap.CompressFormat.JPEG, 90, jo);
                return jo.toByteArray();
            } catch (Exception ignored) {
            } finally {
                if (c != null) c.disconnect();
            }
        }
        throw new IOException("no thumbnail");
    }

    private static void copy(InputStream in, OutputStream os) throws IOException {
        byte[] b = new byte[1 << 17];
        int n;
        while ((n = in.read(b)) != -1) os.write(b, 0, n);
    }

    /**
     * Android file names are limited to 255 BYTES, and MediaStore adds a
     * ".pending-<time>-" prefix while the file is written. Bengali / Hindi
     * titles take 3 bytes per letter, so a long title made the insert fail
     * with "Failed to create directory …/.pending-…". Trim by bytes, keep
     * the extension, never cut a character in half.
     */
    static String fitName(String name, int maxBytes) {
        String ext = "";
        int dot = name.lastIndexOf('.');
        if (dot > 0 && name.length() - dot <= 6) {
            ext = name.substring(dot);
            name = name.substring(0, dot);
        }
        int budget = maxBytes - ext.getBytes(java.nio.charset.StandardCharsets.UTF_8).length;
        StringBuilder sb = new StringBuilder();
        int used = 0;
        for (int i = 0; i < name.length(); ) {
            int cp = name.codePointAt(i);
            int n = new String(Character.toChars(cp)).getBytes(java.nio.charset.StandardCharsets.UTF_8).length;
            if (used + n > budget) break;
            sb.appendCodePoint(cp);
            used += n;
            i += Character.charCount(cp);
        }
        String base = sb.toString().trim();
        // A dot-leading name would be hidden; an empty one is useless.
        while (base.startsWith(".")) base = base.substring(1);
        if (base.isEmpty()) base = "AuraBeats " + System.currentTimeMillis();
        return base + ext;
    }

    private Uri publish(File f, String name, String mime, String folder) throws Exception {
        // Songs and videos in their own folders: Download/AuraBeats/Music, …/Videos.
        String sub = folder != null && folder.matches("[A-Za-z]+") ? "/" + folder : "";
        String safe = fitName(name, 150);
        if (Build.VERSION.SDK_INT >= 29) {
            String base = Environment.DIRECTORY_DOWNLOADS + "/AuraBeats";
            String shortName = fitName(name, 60);
            // Same file, progressively simpler places — the download itself is
            // done, so saving must not be the step that loses it.
            String[][] tries = {
                { base + sub, safe },
                { base + sub, shortName },
                { base, shortName },
                { Environment.DIRECTORY_DOWNLOADS, shortName },
            };
            Exception last = null;
            for (String[] t : tries) {
                try {
                    return insertDownload(f, t[1], mime, t[0]);
                } catch (Exception e) {
                    last = e;
                }
            }
            // Last resort: the app's own folder (Android/data/…/files/Download).
            try {
                return saveToAppFolder(f, shortName, mime, sub);
            } catch (Exception e) {
                throw last != null ? last : e;
            }
        }
        // Android 7–9: the app's own Download folder needs no permission.
        return saveToAppFolder(f, safe, mime, sub);
    }

    private Uri insertDownload(File f, String name, String mime, String relPath) throws Exception {
        ContentResolver cr = getContext().getContentResolver();
        ContentValues cv = new ContentValues();
        cv.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
        cv.put(MediaStore.MediaColumns.MIME_TYPE, mime);
        cv.put(MediaStore.MediaColumns.RELATIVE_PATH, relPath);
        cv.put(MediaStore.MediaColumns.IS_PENDING, 1);
        Uri uri = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
        if (uri == null) throw new IOException("could not create the file in Downloads");
        try (InputStream in = new FileInputStream(f); OutputStream os = cr.openOutputStream(uri)) {
            if (os == null) throw new IOException("could not write to Downloads");
            copy(in, os);
        } catch (Exception e) {
            try {
                cr.delete(uri, null, null);
            } catch (Exception ignored) {
            }
            throw e;
        }
        cv.clear();
        cv.put(MediaStore.MediaColumns.IS_PENDING, 0);
        cr.update(uri, cv, null, null);
        return uri;
    }

    private Uri saveToAppFolder(File f, String name, String mime, String sub) throws Exception {
        File dir = new File(getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "AuraBeats" + sub);
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        File dest = new File(dir, name);
        try (InputStream in = new FileInputStream(f); OutputStream os = new FileOutputStream(dest)) {
            copy(in, os);
        }
        final Uri[] res = {null};
        final CountDownLatch latch = new CountDownLatch(1);
        MediaScannerConnection.scanFile(getContext(), new String[] { dest.getAbsolutePath() }, new String[] { mime }, (path, uri) -> {
            res[0] = uri;
            latch.countDown();
        });
        latch.await(6, TimeUnit.SECONDS);
        if (res[0] != null) return res[0];
        // Saved but not indexed yet: no openable uri (file:// is blocked on
        // Android 7+). The job still reports "Saved".
        return null;
    }
}
