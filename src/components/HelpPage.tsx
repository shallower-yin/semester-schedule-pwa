import {
  Bell,
  Bot,
  CalendarDays,
  CheckCircle2,
  Cloud,
  Database,
  FileText,
  GraduationCap,
  NotebookText,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Target
} from "lucide-react";

const guideSections = [
  {
    title: "首次使用",
    icon: <GraduationCap size={18} />,
    items: [
      "可以直接在今天或日程里添加普通事项、习惯、纪念日和备忘录。",
      "学期是学生课程功能，可按需要再创建，不影响普通日程使用。",
      "创建学期后可以手动新增课程，也可以用天津大学课表提取器导入。"
    ]
  },
  {
    title: "今天",
    icon: <CalendarDays size={18} />,
    items: [
      "今天页优先显示接下来要处理的课程、事项和逾期未完成事项。",
      "当天事项完成后，顶部会显示休息提示。",
      "近 10 天的生日、节日和纪念日会在顶部轻量提醒。"
    ]
  },
  {
    title: "日程",
    icon: <FileText size={18} />,
    items: [
      "课程和普通事项都在日程里统一管理。",
      "普通事项支持日期范围、全天、重复、提醒、分类和完成状态。",
      "快速录入按“日期 时间 内容”输入，字段之间用空格分隔。"
    ]
  },
  {
    title: "习惯与专注",
    icon: <Target size={18} />,
    items: [
      "习惯可以设置执行时间段和提醒，并按日期打卡。",
      "专注支持正计时、倒计时、番茄钟和锁机模式。",
      "专注页会汇总每日、每周和任务分类的专注记录。"
    ]
  },
  {
    title: "备忘录",
    icon: <NotebookText size={18} />,
    items: [
      "备忘录支持文件夹、搜索、置顶、自动编号和待办圆圈。",
      "正文可使用自动编号和待办圆圈，待办项可直接点击切换完成。",
      "删除备忘录会直接彻底删除，重要内容建议先导出 JSON 备份。"
    ]
  },
  {
    title: "提醒与同步",
    icon: <Bell size={18} />,
    items: [
      "提醒需要浏览器通知权限、系统通知权限和当前设备订阅。",
      "登录后会在手机和电脑之间同步课程、事项、习惯、备忘录和专注记录。",
      "重要调整前可以在设置里主动导出 JSON 备份。"
    ]
  },
  {
    title: "隐私与数据",
    icon: <ShieldCheck size={18} />,
    items: [
      "日程数据优先保存在当前设备，登录后会同步到你的账号云端。",
      "账号密码由登录服务处理，应用不会保存或展示你的密码。",
      "AI 助手只读取当前账号的日程摘要、纪念日、备忘录预览、专注统计和你输入的问题。",
      "删除操作会彻底删除对应数据；跨设备数据会在同步后一起删除。"
    ]
  },
  {
    title: "安装与更新",
    icon: <Smartphone size={18} />,
    items: [
      "安卓 Chrome 可通过浏览器菜单添加到主屏幕，之后从桌面图标打开。",
      "Windows Edge 或 Chrome 可通过安装入口保存为独立应用，通常可在开始菜单找到。",
      "更新没生效时，在设置里使用应用版本或清缓存重载。"
    ]
  },
  {
    title: "AI 与权限",
    icon: <Bot size={18} />,
    items: [
      "AI 助手可以根据当前账号的日程摘要回答安排、冲突和未完成事项。",
      "会员和管理员可直接使用 AI 助手，访问口令只用于临时体验。",
      "AI 助手有每日和每月使用次数保护，达到上限后会提示稍后再用。",
      "管理员可在管理后台为指定账号开通会员或管理员权限。"
    ]
  },
  {
    title: "常见处理",
    icon: <Cloud size={18} />,
    items: [
      "手机和电脑数据不一致时，先打开账号与同步，查看待上传和异常项。",
      "PWA 更新后未生效时，在设置里使用清缓存重载。",
      "通知不响时，先重新检查系统提醒，再确认浏览器通知权限。"
    ]
  }
];

export function HelpPage() {
  return (
    <section className="help-page">
      <div className="page-heading">
        <div>
          <h1>使用说明</h1>
          <p>按日常使用顺序整理，遇到问题时可以直接查对应模块。</p>
        </div>
      </div>

      <div className="help-quick-start">
        <Sparkles size={20} />
        <div>
          <strong>建议顺序</strong>
          <span>先添加普通事项或使用快速录入；学生用户再创建学期、导入课程和配置节次；最后登录同步。</span>
        </div>
      </div>

      <div className="help-section-grid">
        {guideSections.map((section) => (
          <article key={section.title} className="help-card">
            <h2>{section.icon}{section.title}</h2>
            <ul>
              {section.items.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </article>
        ))}
      </div>

      <section className="help-footer-note">
        <ShieldCheck size={18} />
        <div>
          <strong>数据优先保存在本机</strong>
          <span>联网并登录后会自动同步。长期使用建议偶尔主动导出备份文件。</span>
        </div>
        <Database size={18} />
        <CheckCircle2 size={18} />
        <RefreshCw size={18} />
      </section>
    </section>
  );
}
