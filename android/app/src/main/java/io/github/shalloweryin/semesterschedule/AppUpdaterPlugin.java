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
import com.getcapacitor.JSArray;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.ArrayList;
import java.util.List;

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
        final int versionCode = call.getInt("versionCode", 0);
        final List<String> sources = new ArrayList<>();
        JSArray urls = call.getArray("urls");
        if (urls != null) for (int i = 0; i < urls.length(); i++) {
            String candidate = urls.optString(i, "");
            if (!candidate.isEmpty()) sources.add(candidate);
        }
        if (sources.isEmpty() && url != null && !url.trim().isEmpty()) sources.add(url.trim());
        if (sha256 == null || !sha256.matches("[a-fA-F0-9]{64}") || versionCode <= 0) {
            call.reject("缺少有效的安装包校验信息，请重新检查更新。");
            return;
        }
        if (sources.isEmpty()) {
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
                apkFile = new ApkDownloader().download(sources, sha256, dir,
                    percent -> notifyListeners("apkDownloadProgress", new JSObject().put("percent", percent)));
                if (!sha256.equalsIgnoreCase(ApkDownloader.sha256Hex(apkFile))) {
                    throw new Exception("更新包校验失败，已停止安装。");
                }
                verifyPackage(apkFile, versionCode);
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
                android.util.Log.w("AppUpdater", "APK download or verification failed", error);
                if (apkFile != null) {
                    //noinspection ResultOfMethodCallIgnored
                    apkFile.delete();
                }
                rejectOnMain(call, error.getMessage() != null ? error.getMessage() : "下载更新失败。");
            }
        });
    }

    @SuppressWarnings("deprecation")
    private void verifyPackage(File file, int expectedCode) throws Exception {
        PackageManager pm = getContext().getPackageManager();
        int flags = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        PackageInfo archive = pm.getPackageArchiveInfo(file.getPath(), flags);
        PackageInfo installed = pm.getPackageInfo(getContext().getPackageName(), 0);
        if (archive == null || !getContext().getPackageName().equals(archive.packageName)) {
            throw new Exception("更新包与当前应用不匹配，已停止安装。");
        }
        long archiveCode = Build.VERSION.SDK_INT >= 28 ? archive.getLongVersionCode() : archive.versionCode;
        long installedCode = Build.VERSION.SDK_INT >= 28 ? installed.getLongVersionCode() : installed.versionCode;
        if (archiveCode != expectedCode || archiveCode <= installedCode) {
            throw new Exception("安装包版本不正确，请重新检查更新。");
        }
        android.content.pm.Signature[] signatures = Build.VERSION.SDK_INT >= 28 && archive.signingInfo != null
            ? archive.signingInfo.getApkContentsSigners() : archive.signatures;
        String expected = "98e610edcfa3d9e4f34752da158ea48e48592f08481543ad0ac26f85294a3e24";
        if (signatures == null || signatures.length != 1
            || !expected.equals(ApkDownloader.sha256Hex(signatures[0].toByteArray()))) {
            throw new Exception("安装包签名不正确，已停止安装。");
        }
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
