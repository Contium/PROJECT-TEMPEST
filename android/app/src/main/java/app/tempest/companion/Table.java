package app.tempest.companion;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;

/**
 * The table this device joins, from one of TEMPEST's QR codes (Project settings on the GM's PC):
 *   http://<the GM's PC>:<port>/gm?k=<key>     GM on your network: the whole GM window
 *   http://<the GM's PC>:<port>/join?k=<key>   the player screen
 * Remembered, so the app goes straight back to it.
 */
final class Table {
    private static final String PREFS = "tempest";
    private static final String KEY_LINK = "link";

    private Table() {}

    /** The link tidied up, or null if it isn't one of TEMPEST's links. */
    static String check(String raw) {
        if (raw == null) return null;
        Uri uri = Uri.parse(raw.trim());
        String key = uri.getQueryParameter("k");
        String path = uri.getPath();
        if (!"http".equals(uri.getScheme()) || uri.getHost() == null || uri.getHost().isEmpty()) return null;
        if (!("/join".equals(path) || "/gm".equals(path)) || key == null || key.isEmpty()) return null;
        return new Uri.Builder().scheme("http").encodedAuthority(uri.getEncodedAuthority()).path(path).appendQueryParameter("k", key).build().toString();
    }

    /** A GM link (the whole GM window), rather than a player screen's. */
    static boolean isGm(String link) {
        return "/gm".equals(Uri.parse(link).getPath());
    }

    /** "192.168.1.20:4078", for buttons and titles. */
    static String where(String link) {
        return Uri.parse(link).getEncodedAuthority();
    }

    /** Where the app opens once paired (the key then lives in a cookie): the GM window, or the player screen. */
    static String screen(String link) {
        Uri.Builder b = new Uri.Builder().scheme("http").encodedAuthority(where(link)).path("/");
        if (!isGm(link)) b.fragment("/player");
        return b.build().toString();
    }

    static String saved(Context c) {
        return prefs(c).getString(KEY_LINK, null);
    }

    static void save(Context c, String link) {
        prefs(c).edit().putString(KEY_LINK, link).apply();
    }

    static void forget(Context c) {
        prefs(c).edit().remove(KEY_LINK).apply();
    }

    private static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
