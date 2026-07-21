package io.github.shalloweryin.semesterschedule;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Sideload APK updates without an app store: download a signed APK over HTTPS into app cache,
 * then hand it to the system package installer. The installed package must keep the same
 * applicationId and signing certificate, and the new versionCode must be higher.
 */
@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private PluginCall pendingInstallCall;

    @PluginMethod
    public void getNativeVersion(PluginCall call) {
        try {
            PackageManager pm = getContext().getPackageManager();
            PackageInfo info = pm.getPackageInfo(getContext().getPackageName(), 0);
            JSObject ret = new JSObject();
            ret.put("versionName", info.versionName != null ? info.versionName : "");
            long code = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                ? info.getLongVersionCode()
                : info.versionCode;
            ret.put("versionCode", code);
            call.resolve(ret);
        } catch (Exception error) {
            call.reject("无法读取应用版本：" + error.getMessage());
        }
    }

    @PluginMethod
    public void canRequestPackageInstalls(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", canInstallPackages());
        call.resolve(ret);
    }

    @PluginMethod
    public void requestPackageInstallPermission(PluginCall call) {
        if (canInstallPackages()) {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            call.resolve(ret);
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            call.resolve(ret);
            return;
        }
        pendingInstallCall = call;
        Intent intent = new Intent(
            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            Uri.parse("package:" + getContext().getPackageName())
        );
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getActivity().startActivity(intent);
        // Resolved in handleOnResume after the user returns from system settings.
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        if (pendingInstallCall != null) {
            PluginCall call = pendingInstallCall;
            pendingInstallCall = null;
            JSObject ret = new JSObject();
            ret.put("granted", canInstallPackages());
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        final String url = call.getString("url", "");
        final String sha256 = call.getString("sha256", "");
        if (url == null || url.trim().isEmpty()) {
            call.reject("缺少 APK 下载地址。");
            return;
        }
        if (!canInstallPackages()) {
            call.reject("需要允许“安装未知应用”权限后才能更新。");
            return;
        }
        executor.execute(() -> {
            File apkFile = null;
            try {
                File dir = new File(getContext().getCacheDir(), "apk-updates");
                if (!dir.exists() && !dir.mkdirs()) {
                    rejectOnMain(call, "无法创建更新缓存目录。");
                    return;
                }
                apkFile = new File(dir, "update.apk");
                downloadToFile(url.trim(), apkFile);
                if (sha256 != null && !sha256.trim().isEmpty()) {
                    String actual = sha256Hex(apkFile);
                    if (!sha256.trim().equalsIgnoreCase(actual)) {
                        //noinspection ResultOfMethodCallIgnored
                        apkFile.delete();
                        rejectOnMain(call, "更新包校验失败，请稍后重试。");
                        return;
                    }
                }
                final File installFile = apkFile;
                final Activity activity = getActivity();
                if (activity == null) {
                    rejectOnMain(call, "应用界面不可用，请重新打开后再更新。");
                    return;
                }
                activity.runOnUiThread(() -> {
                    try {
                        Uri contentUri = FileProvider.getUriForFile(
                            getContext(),
                            getContext().getPackageName() + ".fileprovider",
                            installFile
                        );
                        Intent intent = new Intent(Intent.ACTION_VIEW);
                        intent.setDataAndType(contentUri, "application/vnd.android.package-archive");
                        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        activity.startActivity(intent);
                        JSObject ret = new JSObject();
                        ret.put("started", true);
                        call.resolve(ret);
                    } catch (Exception error) {
                        call.reject("无法打开系统安装器：" + error.getMessage());
                    }
                });
            } catch (Exception error) {
                if (apkFile != null) {
                    //noinspection ResultOfMethodCallIgnored
                    apkFile.delete();
                }
                rejectOnMain(call, error.getMessage() != null ? error.getMessage() : "下载更新失败。");
            }
        });
    }

    private void downloadToFile(String url, File target) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setConnectTimeout(20_000);
        connection.setReadTimeout(60_000);
        connection.setInstanceFollowRedirects(true);
        connection.connect();
        int status = connection.getResponseCode();
        if (status < 200 || status >= 300) {
            throw new Exception("下载更新失败（HTTP " + status + "）。");
        }
        long total = connection.getContentLengthLong();
        long loaded = 0;
        int lastPercent = -1;
        try (InputStream input = connection.getInputStream();
             FileOutputStream output = new FileOutputStream(target)) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
                loaded += read;
                if (total > 0) {
                    int percent = (int) Math.min(100, (loaded * 100) / total);
                    if (percent != lastPercent && (percent == 100 || percent - lastPercent >= 2)) {
                        lastPercent = percent;
                        notifyListeners("apkDownloadProgress", new JSObject().put("percent", percent));
                    }
                }
            }
            output.flush();
        } finally {
            connection.disconnect();
        }
        if (!target.exists() || target.length() < 1024) {
            throw new Exception("更新包不完整，请检查网络后重试。");
        }
    }

    private String sha256Hex(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (FileInputStream input = new FileInputStream(file)) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) != -1) {
                digest.update(buffer, 0, read);
            }
        }
        StringBuilder builder = new StringBuilder();
        for (byte value : digest.digest()) {
            builder.append(String.format("%02x", value));
        }
        return builder.toString();
    }

    private boolean canInstallPackages() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true;
        return getContext().getPackageManager().canRequestPackageInstalls();
    }

    private void rejectOnMain(PluginCall call, String message) {
        final Activity activity = getActivity();
        if (activity != null) {
            activity.runOnUiThread(() -> call.reject(message));
        } else {
            call.reject(message);
        }
    }
}
