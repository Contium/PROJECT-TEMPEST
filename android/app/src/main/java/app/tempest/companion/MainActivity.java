package app.tempest.companion;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Typeface;
import android.os.Bundle;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.codescanner.GmsBarcodeScanner;
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions;
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning;

/**
 * Setup: pair with TEMPEST on the GM's PC by scanning one of its QR codes (the GM window's, or
 * the player screen's), pasting its link, or going back to the last one. A TEMPEST link opened
 * from elsewhere (the camera app, a chat) lands here too and goes straight in. With a table
 * remembered, opening the app goes straight to it.
 */
public class MainActivity extends Activity {
    /** Set when the player screen sends the player back here on purpose: don't bounce straight back. */
    static final String STAY = "stay";

    private EditText paste;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        if (state == null && handle(getIntent())) return;
        String saved = Table.saved(this);
        if (state == null && saved != null && !getIntent().getBooleanExtra(STAY, false)) {
            open(saved);
            return;
        }
        build(saved);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handle(intent);
    }

    /** A player-screen link opened from outside the app: join that table. */
    private boolean handle(Intent intent) {
        if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction()) || intent.getData() == null) return false;
        String link = Table.check(intent.getDataString());
        if (link == null) {
            Toast.makeText(this, R.string.bad_link, Toast.LENGTH_LONG).show();
            return false;
        }
        join(link);
        return true;
    }

    private void join(String link) {
        Table.save(this, link);
        open(link);
    }

    private void open(String link) {
        startActivity(new Intent(this, ScreenActivity.class).putExtra(ScreenActivity.LINK, link));
        finish();
    }

    private void scan() {
        GmsBarcodeScannerOptions options = new GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build();
        GmsBarcodeScanner scanner = GmsBarcodeScanning.getClient(this, options);
        scanner.startScan()
            .addOnSuccessListener((code) -> {
                String link = Table.check(code.getRawValue());
                if (link == null) Toast.makeText(this, R.string.bad_link, Toast.LENGTH_LONG).show();
                else join(link);
            })
            .addOnFailureListener((e) -> Toast.makeText(this, R.string.no_scanner, Toast.LENGTH_LONG).show());
    }

    private void connectPasted() {
        String link = Table.check(paste.getText().toString());
        if (link == null) paste.setError(getString(R.string.bad_link));
        else join(link);
    }

    // --- the screen, built in code: a logo, a few words, three ways in -------------------------------

    private int dp(int v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
    }

    private TextView text(String s, int sp, int color, boolean bold) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(sp);
        t.setTextColor(getColor(color));
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setLineSpacing(0, 1.2f);
        return t;
    }

    private Button button(String s, boolean primary, View.OnClickListener onClick) {
        Button b = new Button(this);
        b.setText(s);
        b.setAllCaps(true);
        b.setTextColor(getColor(primary ? R.color.bg : R.color.text));
        b.setBackgroundColor(getColor(primary ? R.color.accent : R.color.surface));
        b.setOnClickListener(onClick);
        return b;
    }

    private void build(String saved) {
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setPadding(dp(24), dp(40), dp(24), dp(24));
        col.setGravity(Gravity.CENTER_HORIZONTAL);

        ImageView logo = new ImageView(this);
        logo.setImageResource(R.mipmap.ic_launcher);
        col.addView(logo, new LinearLayout.LayoutParams(dp(96), dp(96)));

        TextView title = text("TEMPEST", 34, R.color.accent, true);
        title.setLetterSpacing(0.15f);
        col.addView(title);
        TextView sub = text(getString(R.string.title).toUpperCase(), 13, R.color.muted, true);
        sub.setLetterSpacing(0.2f);
        col.addView(sub);

        TextView lead = text(getString(R.string.lead), 16, R.color.text, false);
        lead.setPadding(0, dp(24), 0, dp(20));
        col.addView(lead);

        LinearLayout.LayoutParams wide = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        wide.bottomMargin = dp(12);

        if (saved != null) {
            String what = getString(Table.isGm(saved) ? R.string.as_gm : R.string.as_player).toLowerCase();
            col.addView(button(getString(R.string.reconnect, what, Table.where(saved)), true, (v) -> open(saved)), wide);
        }
        col.addView(button(getString(R.string.scan), saved == null, (v) -> scan()), wide);

        paste = new EditText(this);
        paste.setHint(R.string.paste_hint);
        paste.setHintTextColor(getColor(R.color.muted));
        paste.setTextColor(getColor(R.color.text));
        paste.setSingleLine(true);
        paste.setInputType(InputType.TYPE_TEXT_VARIATION_URI);
        paste.setImeOptions(EditorInfo.IME_ACTION_GO);
        paste.setOnEditorActionListener((v, action, e) -> {
            connectPasted();
            return true;
        });
        col.addView(paste, wide);
        col.addView(button(getString(R.string.connect), false, (v) -> connectPasted()), wide);

        if (saved != null) {
            TextView forget = text(getString(R.string.forget), 14, R.color.muted, false);
            forget.setPadding(0, dp(16), 0, 0);
            forget.setOnClickListener((v) -> {
                Table.forget(this);
                recreate();
            });
            col.addView(forget);
        }

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.addView(col);
        setContentView(scroll);
    }
}
