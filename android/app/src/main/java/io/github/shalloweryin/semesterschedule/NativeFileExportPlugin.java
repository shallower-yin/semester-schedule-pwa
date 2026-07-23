package io.github.shalloweryin.semesterschedule;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.OutputStream;

/** Saves WebView-generated text and images through Android's system document picker. */
@CapacitorPlugin(name = "NativeFileExport")
public class NativeFileExportPlugin extends Plugin {

    @PluginMethod
    public void saveFile(PluginCall call) {
        String fileName = call.getString("fileName", "export.bin");
        String mimeType = call.getString("mimeType", "application/octet-stream");
        String base64 = call.getString("base64");
        if (base64 == null || base64.isEmpty()) {
            call.reject("导出内容为空。");
            return;
        }

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mimeType.split(";")[0]);
        intent.putExtra(Intent.EXTRA_TITLE, fileName);
        startActivityForResult(call, intent, "saveFileResult");
    }

    @ActivityCallback
    private void saveFileResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        Uri uri = data != null ? data.getData() : null;
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) {
            JSObject response = new JSObject();
            response.put("saved", false);
            call.resolve(response);
            return;
        }

        try {
            byte[] bytes = Base64.decode(call.getString("base64", ""), Base64.DEFAULT);
            try (OutputStream output = getContext().getContentResolver().openOutputStream(uri, "w")) {
                if (output == null) throw new IllegalStateException("无法打开保存位置。");
                output.write(bytes);
                output.flush();
            }
            JSObject response = new JSObject();
            response.put("saved", true);
            response.put("uri", uri.toString());
            call.resolve(response);
        } catch (Exception error) {
            call.reject("保存文件失败：" + (error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage()), error);
        }
    }
}
