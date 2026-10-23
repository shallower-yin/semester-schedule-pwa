package io.github.shalloweryin.semesterschedule;

import org.junit.Test;
import org.junit.Rule;
import org.junit.rules.TemporaryFolder;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.*;
import static org.junit.Assert.*;

public class ApkDownloaderTest {
    @Rule public TemporaryFolder temporary = new TemporaryFolder();
    private static final String FIRST = "https://static.test/v38.apk", SECOND = "https://backup.test/v38.apk";
    private static final byte[] BYTES = "verified-apk-bytes".getBytes(StandardCharsets.UTF_8);
    private final List<Fake> opened = new ArrayList<>();
    private ApkDownloader downloader(Fake... responses) {
        Queue<Fake> queue = new ArrayDeque<>(Arrays.asList(responses));
        return new ApkDownloader(url -> {
            Fake response = queue.remove(); opened.add(response); return response;
        });
    }
    private String sha() throws Exception { return ApkDownloader.sha256Hex(BYTES); }
    private Fake response(int status, byte[] body) throws Exception { return new Fake(status, body); }
    private byte[] slice(int start, int end) { return Arrays.copyOfRange(BYTES, start, end); }

    @Test public void interruptedTransferResumesWithExactRangeAndEtag() throws Exception {
        Fake first = response(200, slice(0, 4)); first.length = BYTES.length;
        Fake next = response(206, slice(4, BYTES.length));
        next.headers.put("Content-Range", "bytes 4-" + (BYTES.length - 1) + "/" + BYTES.length);
        File result = downloader(first, next).download(List.of(FIRST), sha(), temporary.newFolder(), value -> {});
        assertArrayEquals(BYTES, Files.readAllBytes(result.toPath()));
        assertEquals("bytes=4-", next.getRequestProperty("Range"));
        assertEquals("\"same\"", next.getRequestProperty("If-Range"));
    }

    @Test public void serverReturning200RestartsInsteadOfAppending() throws Exception {
        Fake first = response(200, slice(0, 4)); first.length = BYTES.length;
        Fake restarted = response(200, BYTES); restarted.headers.put("ETag", "\"new\"");
        File result = downloader(first, restarted).download(List.of(FIRST), sha(), temporary.newFolder(), value -> {});
        assertArrayEquals(BYTES, Files.readAllBytes(result.toPath()));
    }

    @Test public void failedOriginUsesBackupAndRequestsAreBounded() throws Exception {
        File result = downloader(response(503, new byte[0]), response(503, new byte[0]), response(200, BYTES))
            .download(List.of(FIRST, SECOND), sha(), temporary.newFolder(), value -> {});
        assertEquals(3, opened.size());
        assertArrayEquals(BYTES, Files.readAllBytes(result.toPath()));
    }

    @Test public void manualRetryPreservesPartialAfterNetworkFailure() throws Exception {
        File directory = temporary.newFolder();
        Fake first = response(200, slice(0, 4)); first.length = BYTES.length;
        Fake unavailable = response(503, new byte[0]);
        try { downloader(first, unavailable).download(List.of(FIRST), sha(), directory, value -> {}); fail(); }
        catch (IOException expected) { assertTrue(expected.getMessage().contains("续传")); }
        assertTrue(Arrays.stream(directory.listFiles()).anyMatch(file -> file.getName().endsWith(".part") && file.length() == 4));
        Fake next = response(206, slice(4, BYTES.length));
        next.headers.put("Content-Range", "bytes 4-" + (BYTES.length - 1) + "/" + BYTES.length);
        File result = downloader(next).download(List.of(FIRST), sha(), directory, value -> {});
        assertArrayEquals(BYTES, Files.readAllBytes(result.toPath()));
        assertEquals("bytes=4-", next.getRequestProperty("Range"));
    }

    @Test public void changedValidatorOrWrongRangeNeverAppendsUnverifiedBytes() throws Exception {
        for (boolean changedEtag : List.of(true, false)) {
            File directory = temporary.newFolder();
            Fake first = response(200, slice(0, 4)); first.length = BYTES.length;
            Fake next = response(206, slice(4, BYTES.length));
            next.headers.put("Content-Range", "bytes " + (changedEtag ? 4 : 3) + "-" + (BYTES.length - 1) + "/" + BYTES.length);
            if (changedEtag) next.headers.put("ETag", "\"changed\"");
            try { downloader(first, next).download(List.of(FIRST), sha(), directory, value -> {}); fail(); }
            catch (IOException expected) { assertFalse(new File(directory, sha() + ".apk").exists()); }
            File result = downloader(response(200, BYTES)).download(List.of(FIRST), sha(), directory, value -> {});
            assertArrayEquals(BYTES, Files.readAllBytes(result.toPath()));
        }
    }

    @Test public void weakEtagDoesNotPermitResume() throws Exception {
        Fake first = response(200, slice(0, 4)); first.length = BYTES.length;
        first.headers.put("ETag", "W/\"same\"");
        Fake next = response(200, BYTES);
        downloader(first, next).download(List.of(FIRST), sha(), temporary.newFolder(), value -> {});
        assertNull(next.getRequestProperty("Range"));
    }

    @Test public void badHashCannotCreateInstallableFile() throws Exception {
        File directory = temporary.newFolder();
        try {
            downloader(response(200, BYTES), response(200, BYTES)).download(List.of(FIRST), "ab".repeat(32), directory, value -> {});
            fail();
        } catch (IOException expected) {
            assertFalse(Arrays.stream(directory.listFiles()).anyMatch(file -> file.getName().endsWith(".apk")));
        }
    }

    @Test public void missingHashAndInsecureUrlAreRejectedBeforeNetwork() throws Exception {
        for (String hash : List.of("", "abc")) {
            try { downloader().download(List.of(FIRST), hash, temporary.newFolder(), value -> {}); fail(); }
            catch (IOException expected) { assertTrue(opened.isEmpty()); }
        }
        try { downloader().download(List.of("http://static.test/a.apk"), sha(), temporary.newFolder(), value -> {}); fail(); }
        catch (IOException expected) { assertTrue(opened.isEmpty()); }
    }

    private static final class Fake extends HttpURLConnection {
        final int status; final byte[] body; final Map<String, String> headers = new HashMap<>();
        long length;
        Fake(int status, byte[] body) throws Exception {
            super(new URL(FIRST)); this.status = status; this.body = body; length = body.length;
            headers.put("ETag", "\"same\"");
        }
        public int getResponseCode() { return status; }
        public long getContentLengthLong() { return length; }
        public String getHeaderField(String name) { return headers.get(name); }
        public InputStream getInputStream() { return new ByteArrayInputStream(body); }
        public void connect() {}
        public void disconnect() {}
        public boolean usingProxy() { return false; }
    }
}
