package dev.pages.aurabeats;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;

/**
 * Writes iTunes-style tags into an MP4 / M4A file without touching the
 * audio or video: title (©nam), artist (©ART) and the cover picture (covr).
 * Android's media scanner, music players, file managers, VLC and Windows all
 * read these, so the download shows its thumbnail everywhere.
 *
 * Works whether the index (moov) sits before or after the media data: when it
 * sits before, every chunk offset (stco / co64) is shifted by the growth.
 * Pure Java — no Android classes — so it can be unit-tested on a desktop JVM.
 */
public final class Mp4Tagger {
    private Mp4Tagger() {}

    /** Writes the tagged copy to {@code out}; {@code in} is left as is. */
    public static void tag(File in, File out, String title, String artist, byte[] jpeg) throws IOException {
        long len = in.length();
        long moovOff = -1, moovSize = 0, mdatOff = -1;
        try (RandomAccessFile f = new RandomAccessFile(in, "r")) {
            long pos = 0;
            byte[] h = new byte[16];
            while (pos + 8 <= len) {
                f.seek(pos);
                f.readFully(h, 0, 8);
                long size = u32(h, 0);
                String type = new String(h, 4, 4, StandardCharsets.ISO_8859_1);
                if (size == 1) {
                    f.readFully(h, 8, 8);
                    size = u64(h, 8);
                } else if (size == 0) {
                    size = len - pos;
                }
                if (size < 8 || pos + size > len) throw new IOException("bad box " + type);
                if (type.equals("moov")) {
                    moovOff = pos;
                    moovSize = size;
                } else if (type.equals("mdat") && mdatOff < 0) {
                    mdatOff = pos;
                }
                pos += size;
            }
            if (moovOff < 0) throw new IOException("no moov");
            if (moovSize > 256L * 1024 * 1024) throw new IOException("moov too large");

            byte[] moov = new byte[(int) moovSize];
            f.seek(moovOff);
            f.readFully(moov);
            int hdr = u32(moov, 0) == 1 ? 16 : 8;

            // moov children, minus any old udta; then our udta at the end.
            ByteArrayOutputStream body = new ByteArrayOutputStream(moov.length + jpeg.length + 512);
            int p = hdr;
            while (p + 8 <= moov.length) {
                long s = u32(moov, p);
                if (s < 8 || p + s > moov.length) throw new IOException("bad moov child");
                String t = new String(moov, p + 4, 4, StandardCharsets.ISO_8859_1);
                if (!t.equals("udta")) body.write(moov, p, (int) s);
                p += (int) s;
            }
            body.write(udta(title, artist, jpeg));
            byte[] kids = body.toByteArray();
            byte[] newMoov = new byte[8 + kids.length];
            put32(newMoov, 0, newMoov.length);
            ascii(newMoov, 4, "moov");
            System.arraycopy(kids, 0, newMoov, 8, kids.length);

            long delta = newMoov.length - moovSize;
            if (mdatOff > moovOff && delta != 0) shiftOffsets(newMoov, 8, newMoov.length, delta);

            try (OutputStream os = new FileOutputStream(out)) {
                copyRange(f, 0, moovOff, os);
                os.write(newMoov);
                copyRange(f, moovOff + moovSize, len, os);
            }
        }
    }

    /** Containers on the way to the chunk-offset tables. */
    private static boolean container(String t) {
        return t.equals("trak") || t.equals("mdia") || t.equals("minf") || t.equals("stbl");
    }

    private static void shiftOffsets(byte[] b, int from, int to, long delta) throws IOException {
        int p = from;
        while (p + 8 <= to) {
            long s = u32(b, p);
            if (s < 8 || p + s > to) throw new IOException("bad box in moov");
            String t = new String(b, p + 4, 4, StandardCharsets.ISO_8859_1);
            if (container(t)) {
                shiftOffsets(b, p + 8, p + (int) s, delta);
            } else if (t.equals("stco")) {
                int n = (int) u32(b, p + 12);
                for (int i = 0; i < n; i++) {
                    int at = p + 16 + i * 4;
                    long v = u32(b, at) + delta;
                    if (v < 0 || v > 0xFFFFFFFFL) throw new IOException("offset overflow");
                    put32(b, at, v);
                }
            } else if (t.equals("co64")) {
                int n = (int) u32(b, p + 12);
                for (int i = 0; i < n; i++) {
                    int at = p + 16 + i * 8;
                    put64(b, at, u64(b, at) + delta);
                }
            }
            p += (int) s;
        }
    }

    private static byte[] udta(String title, String artist, byte[] jpeg) throws IOException {
        ByteArrayOutputStream ilst = new ByteArrayOutputStream();
        if (title != null && !title.isEmpty()) ilst.write(item("\u00a9nam", 1, title.getBytes(StandardCharsets.UTF_8)));
        if (artist != null && !artist.isEmpty()) ilst.write(item("\u00a9ART", 1, artist.getBytes(StandardCharsets.UTF_8)));
        if (jpeg != null && jpeg.length > 0) ilst.write(item("covr", 13, jpeg));

        byte[] hdlr = new byte[33];
        put32(hdlr, 0, hdlr.length);
        ascii(hdlr, 4, "hdlr");
        // version/flags 0, pre_defined 0, handler "mdir", reserved "appl" 0 0, empty name
        ascii(hdlr, 16, "mdir");
        ascii(hdlr, 20, "appl");

        byte[] il = box("ilst", ilst.toByteArray());
        ByteArrayOutputStream meta = new ByteArrayOutputStream();
        meta.write(new byte[4]); // version + flags
        meta.write(hdlr);
        meta.write(il);
        return box("udta", box("meta", meta.toByteArray()));
    }

    private static byte[] item(String name, int type, byte[] payload) throws IOException {
        byte[] data = new byte[16 + payload.length];
        put32(data, 0, data.length);
        ascii(data, 4, "data");
        put32(data, 8, type);
        // locale 0
        System.arraycopy(payload, 0, data, 16, payload.length);
        byte[] nm = name.getBytes(StandardCharsets.ISO_8859_1);
        byte[] out = new byte[8 + data.length];
        put32(out, 0, out.length);
        System.arraycopy(nm, 0, out, 4, 4);
        System.arraycopy(data, 0, out, 8, data.length);
        return out;
    }

    private static byte[] box(String type, byte[] payload) {
        byte[] out = new byte[8 + payload.length];
        put32(out, 0, out.length);
        ascii(out, 4, type);
        System.arraycopy(payload, 0, out, 8, payload.length);
        return out;
    }

    private static void copyRange(RandomAccessFile f, long from, long to, OutputStream os) throws IOException {
        byte[] buf = new byte[1 << 17];
        f.seek(from);
        long left = to - from;
        while (left > 0) {
            int n = f.read(buf, 0, (int) Math.min(buf.length, left));
            if (n < 0) throw new IOException("short read");
            os.write(buf, 0, n);
            left -= n;
        }
    }

    private static long u32(byte[] b, int o) {
        return ((b[o] & 0xFFL) << 24) | ((b[o + 1] & 0xFFL) << 16) | ((b[o + 2] & 0xFFL) << 8) | (b[o + 3] & 0xFFL);
    }

    private static long u64(byte[] b, int o) {
        return (u32(b, o) << 32) | u32(b, o + 4);
    }

    private static void put32(byte[] b, int o, long v) {
        b[o] = (byte) (v >>> 24);
        b[o + 1] = (byte) (v >>> 16);
        b[o + 2] = (byte) (v >>> 8);
        b[o + 3] = (byte) v;
    }

    private static void put64(byte[] b, int o, long v) {
        put32(b, o, v >>> 32);
        put32(b, o + 4, v);
    }

    private static void ascii(byte[] b, int o, String s) {
        byte[] x = s.getBytes(StandardCharsets.ISO_8859_1);
        System.arraycopy(x, 0, b, o, x.length);
    }

    /** Desktop test entry: java Mp4Tagger in out title artist cover.jpg */
    public static void main(String[] a) throws IOException {
        ByteArrayOutputStream jpeg = new ByteArrayOutputStream();
        try (InputStream in = new FileInputStream(a[4])) {
            byte[] b = new byte[1 << 16];
            int n;
            while ((n = in.read(b)) != -1) jpeg.write(b, 0, n);
        }
        tag(new File(a[0]), new File(a[1]), a[2], a[3], jpeg.toByteArray());
    }
}
