package dev.pages.aurabeats;

import android.app.Activity;
import android.app.Dialog;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.text.TextUtils;
import android.util.Base64;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.CookieManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.lang.reflect.Method;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.zip.GZIPInputStream;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * YouTube account sign-in (youtube.com's own Google sign-in page).
 *
 * signIn() opens Google's real sign-in page in a separate full-screen
 * WebView. Once youtube.com is reached with a signed-in session, its cookies
 * are taken, stored ONLY here (encrypted with a key kept in the Android
 * Keystore) and wiped from the WebView, so the next "Add account" starts
 * clean. The page (JS) never sees them: it asks request() to make YouTube
 * calls and this plugin adds the session.
 *
 * JS: YtLogin.signIn() → { account }       (rejects "cancelled")
 *     YtLogin.list() → { accounts: [id] }
 *     YtLogin.remove({ account })
 *     YtLogin.request({ account, url, method, body, headers, pageId }) → { status, body }
 */
@CapacitorPlugin(name = "YtLogin")
public class YtLoginPlugin extends Plugin {
    private static final String PREFS = "aurabeats_ytlogin";
    private static final String KEY_ALIAS = "aurabeats_ytlogin";
    private static final String ORIGIN = "https://www.youtube.com";
    private static final String SIGN_IN_URL =
        "https://accounts.google.com/ServiceLogin?service=youtube&uilel=3&passive=true&hl=en"
            + "&continue=https%3A%2F%2Fwww.youtube.com%2Fsignin%3Faction_handle_signin%3Dtrue%26app%3Dm%26hl%3Den"
            + "%26next%3Dhttps%253A%252F%252Fm.youtube.com%252F";
    private static final String DESKTOP_UA =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

    private final ExecutorService io = Executors.newFixedThreadPool(3);
    private final Object lock = new Object();
    private Dialog dialog;

    /* ------------------------------ sign in ------------------------------ */

    @PluginMethod
    public void signIn(final PluginCall call) {
        final Activity a = getActivity();
        if (a == null) {
            call.reject("no screen");
            return;
        }
        a.runOnUiThread(() -> openSignIn(a, call));
    }

    private void openSignIn(final Activity a, final PluginCall call) {
        if (dialog != null) {
            try {
                dialog.dismiss();
            } catch (Exception ignored) {
            }
            dialog = null;
        }
        final CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.removeAllCookies(null); // a clean start: only the new account
        cm.flush();

        final boolean[] done = { false };
        final Dialog d = new Dialog(a, android.R.style.Theme_DeviceDefault_NoActionBar);
        d.requestWindowFeature(Window.FEATURE_NO_TITLE);

        LinearLayout root = new LinearLayout(a);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);

        LinearLayout bar = new LinearLayout(a);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setBackgroundColor(Color.parseColor("#0F0F0F"));
        int pad = dp(a, 8);
        bar.setPadding(pad * 2, pad, pad, pad);
        TextView title = new TextView(a);
        title.setText("Sign in to YouTube");
        title.setTextColor(Color.WHITE);
        title.setTextSize(16);
        bar.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        Button close = new Button(a);
        close.setText("Close");
        close.setAllCaps(false);
        bar.addView(close, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        root.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        final WebView web = new WebView(a);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        // A normal mobile Chrome (Google refuses sign-in in "embedded" browsers).
        String ua = WebSettings.getDefaultUserAgent(a).replace("; wv", "").replaceAll("Version/[\\d.]+ ", "");
        s.setUserAgentString(ua);
        dropRequestedWithHeader(s);
        cm.setAcceptThirdPartyCookies(web, true);
        root.addView(web, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        final Runnable finishIfSignedIn = () -> {
            if (done[0]) return;
            String c = cm.getCookie(ORIGIN);
            if (c == null || !(c.contains("SAPISID=") || c.contains("__Secure-3PAPISID="))) return;
            done[0] = true;
            String id = UUID.randomUUID().toString();
            try {
                saveJar(id, parseCookieHeader(c));
                JSObject r = new JSObject();
                r.put("account", id);
                call.resolve(r);
            } catch (Exception e) {
                call.reject("Couldn't keep the sign-in: " + e.getMessage());
            }
            cm.removeAllCookies(null);
            cm.flush();
            try {
                d.dismiss();
            } catch (Exception ignored) {
            }
        };

        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                if (url != null && url.contains("youtube.com")) finishIfSignedIn.run();
            }

            @Override
            public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
                if (url != null && url.contains("youtube.com") && !url.contains("accounts.")) finishIfSignedIn.run();
            }
        });

        close.setOnClickListener(v -> d.cancel());
        d.setOnKeyListener((di, keyCode, event) -> {
            if (keyCode == KeyEvent.KEYCODE_BACK && event.getAction() == KeyEvent.ACTION_UP && web.canGoBack()) {
                web.goBack();
                return true;
            }
            return false;
        });
        d.setOnCancelListener(di -> {
            if (!done[0]) {
                done[0] = true;
                cm.removeAllCookies(null);
                call.reject("cancelled");
            }
        });
        d.setOnDismissListener(di -> {
            try {
                web.stopLoading();
                web.destroy();
            } catch (Exception ignored) {
            }
            if (dialog == d) dialog = null;
        });
        d.setContentView(root);
        Window w = d.getWindow();
        if (w != null) w.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
        dialog = d;
        d.show();
        web.loadUrl(SIGN_IN_URL);
    }

    /** Hide the "this is an app's WebView" header when the WebView supports it (androidx.webkit, via reflection). */
    private static void dropRequestedWithHeader(WebSettings s) {
        try {
            Class<?> feature = Class.forName("androidx.webkit.WebViewFeature");
            Method supported = feature.getMethod("isFeatureSupported", String.class);
            if (!Boolean.TRUE.equals(supported.invoke(null, "REQUESTED_WITH_HEADER_ALLOW_LIST"))) return;
            Class<?> compat = Class.forName("androidx.webkit.WebSettingsCompat");
            Method set = compat.getMethod("setRequestedWithHeaderOriginAllowList", WebSettings.class, java.util.Set.class);
            set.invoke(null, s, Collections.emptySet());
        } catch (Throwable ignored) {
        }
    }

    private static int dp(Context c, int v) {
        return Math.round(v * c.getResources().getDisplayMetrics().density);
    }

    /* ---------------------------- accounts ------------------------------- */

    @PluginMethod
    public void list(PluginCall call) {
        JSArray arr = new JSArray();
        synchronized (lock) {
            for (String id : ids()) arr.put(id);
        }
        JSObject r = new JSObject();
        r.put("accounts", arr);
        call.resolve(r);
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String id = call.getString("account", "");
        synchronized (lock) {
            List<String> list = ids();
            list.remove(id);
            prefs().edit().remove("jar_" + id).putString("ids", new JSONArray(list).toString()).apply();
        }
        call.resolve();
    }

    /* ----------------------------- requests ------------------------------ */

    @PluginMethod
    public void request(final PluginCall call) {
        final String id = call.getString("account", "");
        final String url = call.getString("url", "");
        final String method = call.getString("method", "POST");
        final String body = call.getString("body", null);
        final String pageId = call.getString("pageId", null);
        final JSObject headers = call.getObject("headers", new JSObject());
        // the session is only ever sent to youtube.com
        String host = "";
        try {
            host = new URL(url).getHost();
        } catch (Exception ignored) {
        }
        if (!url.startsWith("https://") || !(host.equals("youtube.com") || host.endsWith(".youtube.com"))) {
            call.reject("bad url");
            return;
        }
        io.execute(() -> {
            HttpURLConnection conn = null;
            try {
                Map<String, String> jar;
                synchronized (lock) {
                    jar = loadJar(id);
                }
                if (jar == null) {
                    call.reject("not signed in");
                    return;
                }
                conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(20000);
                conn.setRequestMethod(method);
                conn.setInstanceFollowRedirects(true);
                conn.setRequestProperty("User-Agent", DESKTOP_UA);
                conn.setRequestProperty("Accept-Language", "en-US,en;q=0.9");
                conn.setRequestProperty("Accept-Encoding", "gzip");
                conn.setRequestProperty("Cookie", cookieHeader(jar));
                conn.setRequestProperty("Origin", ORIGIN);
                conn.setRequestProperty("X-Origin", ORIGIN);
                conn.setRequestProperty("Referer", ORIGIN + "/");
                conn.setRequestProperty("X-Goog-AuthUser", "0");
                String auth = authHeader(jar);
                if (auth != null) conn.setRequestProperty("Authorization", auth);
                if (pageId != null && !pageId.isEmpty()) conn.setRequestProperty("X-Goog-PageId", pageId);
                Iterator<String> keys = headers.keys();
                while (keys.hasNext()) {
                    String k = keys.next();
                    conn.setRequestProperty(k, headers.getString(k));
                }
                if (body != null && !"GET".equals(method)) {
                    byte[] out = body.getBytes(StandardCharsets.UTF_8);
                    conn.setDoOutput(true);
                    if (!headers.has("Content-Type")) conn.setRequestProperty("Content-Type", "application/json");
                    OutputStream os = conn.getOutputStream();
                    os.write(out);
                    os.close();
                }
                int status = conn.getResponseCode();
                List<String> setCookies = new ArrayList<>();
                for (Map.Entry<String, List<String>> e : conn.getHeaderFields().entrySet()) {
                    if (e.getKey() != null && e.getKey().equalsIgnoreCase("Set-Cookie") && e.getValue() != null) setCookies.addAll(e.getValue());
                }
                if (!setCookies.isEmpty()) {
                    synchronized (lock) {
                        Map<String, String> fresh = loadJar(id);
                        if (fresh != null) {
                            applySetCookies(fresh, setCookies);
                            saveJar(id, fresh);
                        }
                    }
                }
                InputStream in = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
                String text = "";
                if (in != null) {
                    if ("gzip".equalsIgnoreCase(conn.getContentEncoding())) in = new GZIPInputStream(in);
                    ByteArrayOutputStream buf = new ByteArrayOutputStream();
                    byte[] b = new byte[16384];
                    int n;
                    while ((n = in.read(b)) > 0) buf.write(b, 0, n);
                    in.close();
                    text = new String(buf.toByteArray(), StandardCharsets.UTF_8);
                }
                JSObject r = new JSObject();
                r.put("status", status);
                r.put("body", text);
                call.resolve(r);
            } catch (Exception e) {
                call.reject(String.valueOf(e.getMessage()));
            } finally {
                if (conn != null) conn.disconnect();
            }
        });
    }

    /** SAPISIDHASH (+ 1P / 3P variants): how youtube.com proves the session on API calls. */
    private static String authHeader(Map<String, String> jar) throws Exception {
        String sapisid = jar.get("SAPISID");
        if (sapisid == null) sapisid = jar.get("__Secure-3PAPISID");
        if (sapisid == null) return null;
        long ts = System.currentTimeMillis() / 1000;
        List<String> parts = new ArrayList<>();
        parts.add("SAPISIDHASH " + ts + "_" + sha1(ts + " " + sapisid + " " + ORIGIN));
        String p1 = jar.get("__Secure-1PAPISID");
        if (p1 != null) parts.add("SAPISID1PHASH " + ts + "_" + sha1(ts + " " + p1 + " " + ORIGIN));
        String p3 = jar.get("__Secure-3PAPISID");
        if (p3 != null) parts.add("SAPISID3PHASH " + ts + "_" + sha1(ts + " " + p3 + " " + ORIGIN));
        return TextUtils.join(" ", parts);
    }

    private static String sha1(String s) throws Exception {
        byte[] d = MessageDigest.getInstance("SHA-1").digest(s.getBytes(StandardCharsets.UTF_8));
        StringBuilder sb = new StringBuilder();
        for (byte x : d) sb.append(String.format("%02x", x));
        return sb.toString();
    }

    /* ----------------------------- cookies ------------------------------- */

    private static Map<String, String> parseCookieHeader(String header) {
        Map<String, String> jar = new LinkedHashMap<>();
        for (String part : header.split(";")) {
            int eq = part.indexOf('=');
            if (eq <= 0) continue;
            jar.put(part.substring(0, eq).trim(), part.substring(eq + 1).trim());
        }
        return jar;
    }

    private static String cookieHeader(Map<String, String> jar) {
        List<String> out = new ArrayList<>();
        for (Map.Entry<String, String> e : jar.entrySet()) out.add(e.getKey() + "=" + e.getValue());
        return TextUtils.join("; ", out);
    }

    /** Keep the session fresh: YouTube rotates some cookies on API answers. */
    private static void applySetCookies(Map<String, String> jar, List<String> setCookies) {
        for (String sc : setCookies) {
            String first = sc.split(";", 2)[0];
            int eq = first.indexOf('=');
            if (eq <= 0) continue;
            String name = first.substring(0, eq).trim();
            String value = first.substring(eq + 1).trim();
            String lower = sc.toLowerCase();
            boolean gone = value.isEmpty() || value.equals("EXPIRED") || lower.contains("max-age=0") || lower.contains("expires=thu, 01 jan 1970") || lower.contains("expires=thu, 01-jan-1970");
            if (gone) {
                // never drop the sign-in itself because of one odd answer
                if (!name.contains("SID") && !name.contains("PAPISID")) jar.remove(name);
            } else jar.put(name, value);
        }
    }

    /* ----------------------- encrypted storage --------------------------- */

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private List<String> ids() {
        List<String> out = new ArrayList<>();
        try {
            JSONArray a = new JSONArray(prefs().getString("ids", "[]"));
            for (int i = 0; i < a.length(); i++) out.add(a.getString(i));
        } catch (Exception ignored) {
        }
        return out;
    }

    private void saveJar(String id, Map<String, String> jar) throws Exception {
        synchronized (lock) {
            String enc = encrypt(cookieHeader(jar));
            List<String> list = ids();
            if (!list.contains(id)) list.add(id);
            prefs().edit().putString("jar_" + id, enc).putString("ids", new JSONArray(list).toString()).apply();
        }
    }

    private Map<String, String> loadJar(String id) {
        String enc = prefs().getString("jar_" + id, null);
        if (enc == null) return null;
        try {
            return parseCookieHeader(decrypt(enc));
        } catch (Exception e) {
            return null;
        }
    }

    private static SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (ks.containsAlias(KEY_ALIAS)) return ((KeyStore.SecretKeyEntry) ks.getEntry(KEY_ALIAS, null)).getSecretKey();
        KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        kg.init(
            new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        );
        return kg.generateKey();
    }

    private static String encrypt(String plain) throws Exception {
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.ENCRYPT_MODE, key());
        byte[] ct = c.doFinal(plain.getBytes(StandardCharsets.UTF_8));
        return Base64.encodeToString(c.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(ct, Base64.NO_WRAP);
    }

    private static String decrypt(String stored) throws Exception {
        String[] p = stored.split(":", 2);
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(p[0], Base64.NO_WRAP)));
        return new String(c.doFinal(Base64.decode(p[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
    }
}
