package io.github.shalloweryin.semesterschedule;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.regex.*;

/** Verified APK transfers. Each origin owns its validator and partial file. */
final class ApkDownloader {
    interface Progress { void update(int percent); }
    interface Connections { HttpURLConnection open(URL url) throws IOException; }
    private final Connections connections;
    ApkDownloader() { this(url -> (HttpURLConnection) url.openConnection()); }
    ApkDownloader(Connections connections) { this.connections = connections; }

    File download(List<String> sources, String sha256, File directory, Progress progress) throws Exception {
        if (!sha256.matches("[a-fA-F0-9]{64}")) throw new IOException("缺少有效的安装包校验信息，请重新检查更新。");
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("无法创建更新缓存目录。");
        File complete = new File(directory, sha256.toLowerCase(Locale.ROOT) + ".apk");
        if (complete.isFile() && sha256.equalsIgnoreCase(sha256Hex(complete))) return complete;
        IOException last = new IOException("缺少 APK 下载地址。");
        for (String source : new LinkedHashSet<>(sources)) {
            URL url = new URL(source);
            if (!"https".equals(url.getProtocol())) throw new IOException("安装包必须使用 HTTPS 下载。");
            String identity = sha256Hex(source.getBytes(StandardCharsets.UTF_8)).substring(0, 16);
            File partial = new File(directory, sha256 + "-" + identity + ".part");
            File metadata = new File(partial.getPath() + ".properties");
            for (int attempt = 0; attempt < 2; attempt++) {
                try {
                    if (!partial.isFile() || !sha256.equalsIgnoreCase(sha256Hex(partial))) {
                        transfer(url, partial, metadata, progress);
                    }
                    if (!sha256.equalsIgnoreCase(sha256Hex(partial))) {
                        reset(partial, metadata);
                        throw new IOException("更新包校验失败，已停止安装。");
                    }
                    try (InputStream in = new FileInputStream(partial); OutputStream out = new FileOutputStream(complete)) {
                        byte[] buffer = new byte[8192];
                        int read;
                        while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read);
                    }
                    reset(partial, metadata);
                    progress.update(100);
                    return complete;
                } catch (IOException error) {
                    last = error;
                }
            }
        }
        throw new IOException("更新下载未完成，已保留可续传进度。请检查网络后重试。", last);
    }

    private void transfer(URL source, File partial, File metadata, Progress progress) throws IOException {
        Properties saved = new Properties();
        if (metadata.isFile()) {
            try (InputStream in = new FileInputStream(metadata)) { saved.load(in); }
        }
        String validator = saved.getProperty("etag", "");
        long offset = partial.isFile() ? partial.length() : 0;
        if (!strongEtag(validator)) { reset(partial, metadata); offset = 0; }
        HttpURLConnection connection = null;
        try {
            URL target = source;
            for (int redirect = 0; redirect <= 5; redirect++) {
                if (!"https".equals(target.getProtocol())) throw new IOException("拒绝不安全的下载重定向。");
                connection = connections.open(target);
                connection.setConnectTimeout(15_000);
                connection.setReadTimeout(30_000);
                connection.setInstanceFollowRedirects(false);
                connection.setUseCaches(false);
                connection.setRequestProperty("Cache-Control", "no-cache");
                connection.setRequestProperty("Accept-Encoding", "identity");
                if (offset > 0) {
                    connection.setRequestProperty("Range", "bytes=" + offset + "-");
                    connection.setRequestProperty("If-Range", validator);
                }
                int status = connection.getResponseCode();
                if (status == 301 || status == 302 || status == 303 || status == 307 || status == 308) {
                    String location = connection.getHeaderField("Location");
                    if (location == null || redirect == 5) throw new IOException("下载重定向无效。");
                    target = new URL(target, location);
                    connection.disconnect();
                    connection = null;
                    continue;
                }
                break;
            }
            if (connection == null) throw new IOException("无法连接下载地址。");
            int status = connection.getResponseCode();
            long total = connection.getContentLengthLong();
            String etag = connection.getHeaderField("ETag");
            if (status == 206 && offset > 0) {
                String range = connection.getHeaderField("Content-Range");
                Matcher match = Pattern.compile("bytes (\\d+)-(\\d+)/(\\d+)").matcher(range == null ? "" : range);
                if (!match.matches() || !validator.equals(etag)) {
                    reset(partial, metadata);
                    throw new IOException("安装包续传信息已变化，正在重新下载。");
                }
                long start = Long.parseLong(match.group(1)), end = Long.parseLong(match.group(2));
                long full = Long.parseLong(match.group(3));
                if (start != offset || end < start || full <= end || (total >= 0 && total != end - start + 1)) {
                    reset(partial, metadata);
                    throw new IOException("安装包续传范围无效。");
                }
                total = full;
            } else if (status == 200) {
                if (offset > 0) reset(partial, metadata);
                offset = 0; // If-Range mismatch or server without Range support: overwrite, never append.
            } else {
                if (status == 416 || status == 206) reset(partial, metadata);
                throw new IOException("下载更新失败（HTTP " + status + "）。");
            }
            Properties next = new Properties();
            if (strongEtag(etag)) next.setProperty("etag", etag);
            try (OutputStream out = new FileOutputStream(metadata)) { next.store(out, null); }
            long loaded = offset;
            try (InputStream in = connection.getInputStream(); OutputStream out = new FileOutputStream(partial, offset > 0)) {
                byte[] buffer = new byte[8192];
                int read, lastPercent = -1;
                while ((read = in.read(buffer)) != -1) {
                    out.write(buffer, 0, read);
                    loaded += read;
                    if (total > 0) {
                        int percent = (int) Math.min(99, loaded * 100 / total);
                        if (percent != lastPercent && percent - lastPercent >= 2) { progress.update(percent); lastPercent = percent; }
                    }
                }
            }
            if (total >= 0 && loaded != total) throw new IOException("安装包传输中断。");
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static boolean strongEtag(String value) {
        return value != null && value.length() >= 2 && value.startsWith("\"") && value.endsWith("\"");
    }
    private static void reset(File partial, File metadata) throws IOException {
        if (partial.exists() && !partial.delete()) throw new IOException("无法重置安装包缓存。");
        if (metadata.exists() && !metadata.delete()) throw new IOException("无法重置下载信息。");
    }
    static String sha256Hex(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new FileInputStream(file)) {
            byte[] buffer = new byte[8192]; int read;
            while ((read = in.read(buffer)) != -1) digest.update(buffer, 0, read);
        }
        return hex(digest.digest());
    }
    static String sha256Hex(byte[] bytes) throws Exception {
        return hex(MessageDigest.getInstance("SHA-256").digest(bytes));
    }
    private static String hex(byte[] bytes) {
        StringBuilder result = new StringBuilder();
        for (byte value : bytes) result.append(String.format("%02x", value));
        return result.toString();
    }
}
