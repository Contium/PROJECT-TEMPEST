package app.tempest.companion;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.window.OnBackInvokedDispatcher;
import android.content.ActivityNotFoundException;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.provider.Settings;
import android.webkit.ValueCallback;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

/**
 * TEMPEST's own pages from the GM's PC, kept awake, exactly as a browser would show them:
 *   GM link       the whole GM window (GM on your network), in a normal window that makes room
 *                 for the keyboard, with Android's picker for picture uploads
 *   player link   the player screen (#/player), full screen, so everything the GM pushes (the
 *                 turn bar, the Codex, maps) just works
 *
 * The first visit opens the link, which sets the key cookie and lands on the page; later visits
 * go straight there. If the GM's PC can't be reached, a panel offers to try again or join another
 * table. Links that lead off the table open in the browser.
 */
public class ScreenActivity extends Activity {
    static final String LINK = "link";

    private static final int PICK_FILE = 7;
    private static final int ASK_LAN = 8;
    private static final String LOCAL_NETWORK = "android.permission.ACCESS_LOCAL_NETWORK";

    private WebView web;
    private View lost; // the GM's PC can't be reached
    private View lan;  // Android hasn't let the app reach the local network
    private boolean fresh;
    private String link;
    private boolean gm;
    private long backAt;
    private ValueCallback<Uri[]> picking; // a file chooser the page opened (picture uploads)

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        link = getIntent().getStringExtra(LINK);
        if (link == null) link = Table.saved(this);
        if (link == null) {
            back();
            return;
        }
        gm = Table.isGm(link);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (gm) {
            // The GM types (names, notes, damage): a normal window, which shrinks for the keyboard.
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
            getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
            // The GM window is laid out for wide screens: landscape (either way up) fits it.
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
        }

        web = new WebView(this);
        web.setBackgroundColor(getColor(R.color.bg));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true); // the screen's name, the Codex's "seen" marks
        s.setMediaPlaybackRequiresUserGesture(false);
        CookieManager.getInstance().setAcceptCookie(true);
        web.setWebChromeClient(new WebChromeClient() {
            // Picture uploads (portraits, maps, ads): Android's own picker.
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (picking != null) picking.onReceiveValue(null);
                picking = callback;
                try {
                    startActivityForResult(params.createIntent(), PICK_FILE);
                } catch (ActivityNotFoundException e) {
                    picking = null;
                    Toast.makeText(ScreenActivity.this, R.string.upload_failed, Toast.LENGTH_LONG).show();
                    return false;
                }
                return true;
            }
        });
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri url = req.getUrl();
                // Same table: stay. Anywhere else: the browser.
                if (Table.where(link).equals(url.getEncodedAuthority())) return false;
                startActivity(new Intent(Intent.ACTION_VIEW, url));
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError error) {
                if (req.isForMainFrame()) lost.setVisibility(View.VISIBLE);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                CookieManager.getInstance().flush();
            }
        });

        FrameLayout root = new FrameLayout(this);
        root.addView(web);
        lost = panel(getString(R.string.lost_title), getString(R.string.lost_text) + "\n\n" + Table.where(link),
            getString(R.string.retry), (v) -> {
                // The link again: it lands on the page. (If the GM has since made a new link,
                // TEMPEST says this one has expired, and the player rescans the QR code.)
                lost.setVisibility(View.GONE);
                web.loadUrl(link);
            });
        lan = panel(getString(R.string.lan_title), getString(R.string.lan_text),
            getString(R.string.lan_settings), (v) -> startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", getPackageName(), null))));
        root.addView(lost);
        root.addView(lan);
        setContentView(root);
        if (!gm) immersive();
        // Android 13+: back gestures come here (with predictive back, onBackPressed is never called).
        if (android.os.Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::goBack);
        }
        fresh = state == null;
        go();
    }

    /** Open the page, once Android lets this app reach the local network. */
    private void go() {
        if (needsLan()) {
            requestPermissions(new String[] { LOCAL_NETWORK }, ASK_LAN);
            return;
        }
        lan.setVisibility(View.GONE);
        // Joined before on this device: the cookie's there, go straight to the page.
        boolean joined = CookieManager.getInstance().getCookie("http://" + Table.where(link)) != null;
        web.loadUrl(joined && fresh ? Table.screen(link) : link);
    }

    /** Android 17+ keeps apps off the home network until the user allows it. */
    private boolean needsLan() {
        return android.os.Build.VERSION.SDK_INT >= 37 && checkSelfPermission(LOCAL_NETWORK) != PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(request, permissions, results);
        if (request != ASK_LAN) return;
        if (needsLan()) lan.setVisibility(View.VISIBLE); // refused: say why, and where to allow it
        else go();
    }

    private void immersive() {
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus && !gm) immersive();
    }

    @Override
    @SuppressWarnings("deprecation")
    protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != PICK_FILE || picking == null) return;
        picking.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
        picking = null;
    }

    /** Back on Android 12 and older (newer ones call goBack() through the back callback). */
    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        goBack();
    }

    /** Back: the page's own back first (a Codex entry, say); then twice to leave the screen. */
    private void goBack() {
        if (web != null && web.canGoBack()) {
            web.goBack();
            return;
        }
        if (System.currentTimeMillis() - backAt < 2500) {
            back();
            return;
        }
        backAt = System.currentTimeMillis();
        Toast.makeText(this, R.string.leave_hint, Toast.LENGTH_SHORT).show();
    }

    /** To the setup screen, staying there (not straight back here). */
    private void back() {
        startActivity(new Intent(this, MainActivity.class).putExtra(MainActivity.STAY, true));
        finish();
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (web != null) web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
        // Back from Android's settings with the network allowed: carry on.
        if (lan != null && lan.getVisibility() == View.VISIBLE && !needsLan()) go();
    }

    @Override
    protected void onDestroy() {
        if (web != null) web.destroy();
        super.onDestroy();
    }

    private int dp(int v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
    }

    /** A panel over the page (hidden until needed): a title, a few words, an action, and "Join another table". */
    private View panel(String titleText, String bodyText, String action, View.OnClickListener onAction) {
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setGravity(Gravity.CENTER);
        col.setPadding(dp(32), dp(32), dp(32), dp(32));
        col.setBackgroundColor(getColor(R.color.bg));
        col.setVisibility(View.GONE);

        TextView title = new TextView(this);
        title.setText(titleText);
        title.setTextSize(22);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setTextColor(getColor(R.color.accent));
        title.setGravity(Gravity.CENTER);
        col.addView(title);

        TextView body = new TextView(this);
        body.setText(bodyText);
        body.setTextSize(15);
        body.setTextColor(getColor(R.color.text));
        body.setGravity(Gravity.CENTER);
        body.setPadding(0, dp(12), 0, dp(20));
        col.addView(body);

        LinearLayout.LayoutParams wide = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        wide.bottomMargin = dp(12);
        Button primary = new Button(this);
        primary.setText(action);
        primary.setTextColor(getColor(R.color.bg));
        primary.setBackgroundColor(getColor(R.color.accent));
        primary.setOnClickListener(onAction);
        col.addView(primary, wide);
        Button change = new Button(this);
        change.setText(R.string.change);
        change.setTextColor(getColor(R.color.text));
        change.setBackgroundColor(getColor(R.color.surface));
        change.setOnClickListener((v) -> back());
        col.addView(change, wide);
        return col;
    }
}
