package io.github.shalloweryin.semesterschedule;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

import javax.xml.parsers.DocumentBuilderFactory;

import org.junit.Test;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

public class TodayScheduleWidgetProviderTest {
    @Test
    public void standardHeightUsesTwoRowsAndExpandedHeightUsesThree() {
        assertEquals(2, TodayScheduleWidgetProvider.rowsForHeight(180));
        assertEquals(2, TodayScheduleWidgetProvider.rowsForHeight(229));
        assertEquals(3, TodayScheduleWidgetProvider.rowsForHeight(230));
        assertEquals(3, TodayScheduleWidgetProvider.rowsForHeight(320));
    }

    @Test
    public void titleTruncationCountsUnicodeCodePoints() {
        String truncated = TodayScheduleWidgetProvider.truncate("📚📚📚📚", 3, "待办");
        assertEquals("📚📚…", truncated);
        assertEquals(3, truncated.codePointCount(0, truncated.length()));
    }

    @Test
    public void titleTruncationUsesFallbackForWhitespace() {
        assertEquals("未命名待办", TodayScheduleWidgetProvider.truncate("   ", 10, "未命名待办"));
    }

    @Test
    public void todoAddKeepsThirtyDpVisualInsideAccessibleTouchTarget() throws Exception {
        Element addView = findElementByAndroidId(
            parseResource("layout/widget_today_schedule.xml"),
            "@+id/widget_todo_add"
        );
        assertNotNull(addView);

        int touchWidth = dp(addView.getAttributeNS(androidNamespace(), "layout_width"));
        int touchHeight = dp(addView.getAttributeNS(androidNamespace(), "layout_height"));
        assertEquals(44, touchWidth);
        assertEquals(44, touchHeight);
        assertEquals("@drawable/widget_add_background",
            addView.getAttributeNS(androidNamespace(), "background"));

        Document background = parseResource("drawable/widget_add_background.xml");
        Element inset = firstElementChild(background.getDocumentElement());
        assertNotNull(inset);
        int horizontalInset = dp(inset.getAttributeNS(androidNamespace(), "left"))
            + dp(inset.getAttributeNS(androidNamespace(), "right"));
        int verticalInset = dp(inset.getAttributeNS(androidNamespace(), "top"))
            + dp(inset.getAttributeNS(androidNamespace(), "bottom"));
        assertEquals(30, touchWidth - horizontalInset);
        assertEquals(30, touchHeight - verticalInset);
    }

    private static Document parseResource(String relativePath) throws Exception {
        Path resource = findResource(relativePath);
        try (InputStream input = Files.newInputStream(resource)) {
            DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
            factory.setNamespaceAware(true);
            return factory.newDocumentBuilder().parse(input);
        }
    }

    private static Path findResource(String relativePath) throws IOException {
        Path current = Paths.get("").toAbsolutePath();
        while (current != null) {
            Path fromApp = current.resolve("src/main/res").resolve(relativePath);
            if (Files.isRegularFile(fromApp)) return fromApp;
            Path fromAndroid = current.resolve("app/src/main/res").resolve(relativePath);
            if (Files.isRegularFile(fromAndroid)) return fromAndroid;
            Path fromRepo = current.resolve("android/app/src/main/res").resolve(relativePath);
            if (Files.isRegularFile(fromRepo)) return fromRepo;
            current = current.getParent();
        }
        throw new IOException("Android resource not found: " + relativePath);
    }

    private static Element findElementByAndroidId(Document document, String id) {
        NodeList elements = document.getElementsByTagName("*");
        for (int index = 0; index < elements.getLength(); index++) {
            Element element = (Element) elements.item(index);
            if (id.equals(element.getAttributeNS(androidNamespace(), "id"))) return element;
        }
        return null;
    }

    private static Element firstElementChild(Element parent) {
        NodeList children = parent.getChildNodes();
        for (int index = 0; index < children.getLength(); index++) {
            Node child = children.item(index);
            if (child instanceof Element) return (Element) child;
        }
        return null;
    }

    private static int dp(String value) {
        return Integer.parseInt(value.substring(0, value.length() - 2));
    }

    private static String androidNamespace() {
        return "http://schemas.android.com/apk/res/android";
    }
}
