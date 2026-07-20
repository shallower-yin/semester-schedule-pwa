package io.github.shalloweryin.semesterschedule;

import android.os.Bundle;
import android.webkit.WebView;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private Insets safeInsets = Insets.NONE;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(FocusOverlayPlugin.class);
        super.onCreate(savedInstanceState);

        // Android 15+ enforces edge-to-edge for apps targeting SDK 35+. OEM skins (e.g. ColorOS)
        // draw the WebView behind the status bar while others reserve it, and Android WebView does
        // not reliably expose the status-bar height through CSS env(safe-area-inset-*). To behave
        // identically everywhere we opt into edge-to-edge explicitly and forward the true window
        // insets to the web layer as CSS variables, which the stylesheet combines with env().
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        WindowInsetsControllerCompat controller =
            new WindowInsetsControllerCompat(getWindow(), getWindow().getDecorView());
        // App surfaces are light in every skin, so keep the bar icons dark for contrast.
        controller.setAppearanceLightStatusBars(true);
        controller.setAppearanceLightNavigationBars(true);

        WebView webView = getBridge().getWebView();
        if (webView == null) {
            return;
        }

        ViewCompat.setOnApplyWindowInsetsListener(webView, (view, insets) -> {
            safeInsets = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            applySafeAreaVariables(webView);
            return insets;
        });
        ViewCompat.requestApplyInsets(webView);

        // The first inset dispatch happens before the SPA document is ready, so re-apply for a few
        // seconds to make sure the loaded document receives the variables. CSS var() updates live,
        // so once a value lands it takes effect and repeated identical writes are no-ops.
        webView.post(new Runnable() {
            private int attempts = 0;

            @Override
            public void run() {
                applySafeAreaVariables(webView);
                if (++attempts < 12) {
                    webView.postDelayed(this, 500);
                }
            }
        });
    }

    private void applySafeAreaVariables(WebView webView) {
        float density = getResources().getDisplayMetrics().density;
        int top = Math.round(safeInsets.top / density);
        int right = Math.round(safeInsets.right / density);
        int bottom = Math.round(safeInsets.bottom / density);
        int left = Math.round(safeInsets.left / density);
        String js = "(function(){var s=document.documentElement&&document.documentElement.style;"
            + "if(!s)return;"
            + "s.setProperty('--android-safe-top','" + top + "px');"
            + "s.setProperty('--android-safe-right','" + right + "px');"
            + "s.setProperty('--android-safe-bottom','" + bottom + "px');"
            + "s.setProperty('--android-safe-left','" + left + "px');})();";
        webView.evaluateJavascript(js, null);
    }
}
