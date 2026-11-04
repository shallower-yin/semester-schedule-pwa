import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface ParsedRule {
  selector: string;
  media: string[];
  style: CSSStyleDeclaration;
}

function readStyles(file: string): string {
  return readFileSync(resolve(process.cwd(), "src", file), "utf8");
}

function parseRules(css: string): ParsedRule[] {
  const element = document.createElement("style");
  element.textContent = css;
  document.head.append(element);
  try {
    const result: ParsedRule[] = [];
    const visit = (rules: CSSRuleList, media: string[]) => {
      for (const rule of Array.from(rules)) {
        if (rule.type === CSSRule.STYLE_RULE) {
          const styleRule = rule as CSSStyleRule;
          result.push({ selector: styleRule.selectorText, media, style: styleRule.style });
        } else if (rule.type === CSSRule.MEDIA_RULE) {
          const mediaRule = rule as CSSMediaRule;
          visit(mediaRule.cssRules, [...media, mediaRule.conditionText]);
        }
      }
    };
    if (!element.sheet) throw new Error("CSS stylesheet did not parse");
    visit(element.sheet.cssRules, []);
    return result;
  } finally {
    element.remove();
  }
}

const controls = parseRules(readStyles("styles/calendar-controls.css"));
const controlsSelector = /\.(?:calendar-toolbar|calendar-title-actions|calendar-control-panel|calendar-[\w-]*disclosure|calendar-disclosure-content|snapshot-toolbar-actions|schedule-filter-bar|week-title)(?![\w-])/;

// Inspect matching declarations in stylesheet order. Browser computed-style
// equivalence is checked separately; this protects the actual selector targets.
function declarations(element: Element, property: string, width: number): string[] {
  return controls.flatMap((rule) => {
    if (!rule.media.every((condition) => {
      const maximum = /^\(max-width:\s*(\d+(?:\.\d+)?)px\)$/.exec(condition);
      if (!maximum) throw new Error(`Unhandled calendar control media condition: ${condition}`);
      return width <= Number(maximum[1]);
    })) return [];
    const matches = rule.selector.split(",").some((selector) => !selector.includes("::") && element.matches(selector.trim()));
    const value = rule.style.getPropertyValue(property);
    return matches && value ? [value] : [];
  });
}

function lastDeclaration(element: Element, property: string, width: number): string | undefined {
  return declarations(element, property, width).at(-1);
}

function fixture() {
  const root = document.createElement("section");
  root.className = "calendar-control-panel";
  root.innerHTML = `
    <section class="calendar-toolbar">
      <div class="calendar-title-actions">
        <div class="week-title"><h1>第 1 周</h1><span>日期</span></div>
        <div class="snapshot-toolbar-actions"><button class="button">日快照</button></div>
      </div>
      <div class="toolbar-actions calendar-week-actions">
        <button class="button">上一周</button><button class="button" id="current-week">回到本周</button>
        <button class="button">下一周</button>
        <details class="calendar-toolbar-disclosure calendar-more-disclosure" open>
          <summary>更多</summary><div class="calendar-disclosure-content">
            <button class="button" id="courses">课程管理</button><button class="button" id="batch-events">批量事项</button>
          </div>
        </details>
        <button class="button primary">新增日程</button>
      </div>
    </section>
    <details class="calendar-toolbar-disclosure calendar-filter-disclosure" open>
      <summary>筛选</summary><div class="calendar-disclosure-content">
        <section class="schedule-filter-bar"><input><select></select><select></select><button>清除</button></section>
      </div>
    </details>`;
  const find = (selector: string) => {
    const element = root.querySelector(selector);
    if (!element) throw new Error(`Missing fixture selector: ${selector}`);
    return element;
  };
  return { root, find };
}

describe("日程工具栏响应式布局", () => {
  it("工具栏/标题/快照/筛选披露规则只由calendar-controls持有", () => {
    expect(controls.length).toBeGreaterThan(0);
    expect(controls.every((rule) => controlsSelector.test(rule.selector))).toBe(true);
    for (const file of ["01-core-schedule.css", "06-responsive.css", "09-mobile-week.css"]) {
      const remaining = parseRules(readStyles(`styles/${file}`));
      expect(remaining.filter((rule) => controlsSelector.test(rule.selector)), file).toEqual([]);
    }
    expect(controls.some((rule) => rule.selector.includes(".page-heading"))).toBe(false);
  });

  it("归属文件在主题层之后、移动周视图之前导入一次", () => {
    const imports = [...readStyles("styles.css").matchAll(/@import\s+"([^"]+)"/g)].map((match) => match[1]);
    expect(imports.filter((file) => file === "./styles/calendar-controls.css")).toHaveLength(1);
    expect(imports.indexOf("./styles/calendar-controls.css")).toBe(imports.indexOf("./styles/08-macaron.css") + 1);
    expect(imports.indexOf("./styles/09-mobile-week.css")).toBe(imports.indexOf("./styles/calendar-controls.css") + 1);
  });

  it.each([320, 390, 420, 421, 580, 581, 900])("%ipx使用当前四列周导航而非失效六列规则", (width) => {
    const { root, find } = fixture();
    expect(lastDeclaration(root, "display", width)).toBe("grid");
    expect(lastDeclaration(find(".calendar-toolbar"), "display", width)).toBe("contents");
    expect(lastDeclaration(find(".calendar-week-actions"), "grid-template-columns", width))
      .toBe("36px minmax(64px, 1fr) 36px auto");
    expect(lastDeclaration(find(".calendar-week-actions"), "overflow", width)).toBe("visible");
    expect(lastDeclaration(find(".calendar-more-disclosure > summary"), "display", width)).toBe("flex");
    expect(controls.some((rule) => rule.style.getPropertyValue("grid-template-columns") === "repeat(6, minmax(0, 1fr))"))
      .toBe(false);
  });

  it("桌面保留横向工具栏与直接展示的管理操作", () => {
    const { find } = fixture();
    expect(lastDeclaration(find(".calendar-toolbar"), "display", 901)).toBe("flex");
    expect(lastDeclaration(find(".calendar-more-disclosure > summary"), "display", 901)).toBe("none");
    expect(lastDeclaration(find(".calendar-more-disclosure"), "display", 901)).toBe("contents");
    expect(lastDeclaration(find(".calendar-more-disclosure > .calendar-disclosure-content"), "display", 901)).toBe("contents");
  });

  it("窄屏直接按钮恢复auto列，但保留更多菜单嵌套按钮的后代nth-child规则", () => {
    const { find } = fixture();
    expect(declarations(find("#current-week"), "grid-column", 390)).toEqual(["span 4", "auto"]);
    expect(declarations(find("#batch-events"), "grid-column", 390)).toEqual(["span 4"]);
    expect(declarations(find("#courses"), "grid-column", 390)).toEqual(["span 1"]);
    expect(lastDeclaration(find("#batch-events"), "width", 390)).toBe("100%");
    expect(declarations(find("#batch-events"), "grid-column", 421)).toEqual([]);
  });

  it("移动端更多菜单、筛选浮层与输入仍保持原来的定位和可操作尺寸", () => {
    const { find } = fixture();
    const more = find(".calendar-more-disclosure > .calendar-disclosure-content");
    const filter = find(".calendar-filter-disclosure > .calendar-disclosure-content");
    expect(lastDeclaration(more, "position", 390)).toBe("absolute");
    expect(lastDeclaration(more, "display", 390)).toBe("grid");
    expect(lastDeclaration(more, "min-width", 390)).toBe("150px");
    expect(lastDeclaration(filter, "position", 390)).toBe("absolute");
    expect(lastDeclaration(filter, "left", 390)).toBe("0");
    expect(lastDeclaration(filter, "right", 390)).toBe("0");
    expect(lastDeclaration(find(".schedule-filter-bar"), "grid-template-columns", 390)).toBe("1fr 1fr");
    expect(lastDeclaration(find(".schedule-filter-bar > input"), "grid-column", 390)).toBe("1 / -1");
    expect(lastDeclaration(find(".schedule-filter-bar > input"), "min-height", 390)).toBe("38px");
    expect(lastDeclaration(find(".schedule-filter-bar > button"), "grid-column", 390)).toBe("1 / -1");
  });

  it("标题和快照断点仍有效，共享page-heading规则留在原层", () => {
    const { find } = fixture();
    expect(lastDeclaration(find(".snapshot-toolbar-actions"), "display", 580)).toBe("grid");
    expect(lastDeclaration(find(".snapshot-toolbar-actions"), "display", 581)).toBe("flex");
    expect(lastDeclaration(find(".week-title h1"), "font-size", 900)).toBe("18px");
    expect(lastDeclaration(find(".week-title h1"), "font-size", 901)).toBe("1.5rem");
    const core = parseRules(readStyles("styles/01-core-schedule.css"));
    expect(core.find((rule) => rule.selector === ".page-heading h1")?.style.getPropertyValue("font-size")).toBe("1.5rem");
    const responsive = parseRules(readStyles("styles/06-responsive.css"));
    expect(responsive.find((rule) => rule.selector === ".page-heading h1" && rule.media.includes("(max-width: 580px)"))
      ?.style.getPropertyValue("font-size")).toBe("1.3125rem");
  });
});
