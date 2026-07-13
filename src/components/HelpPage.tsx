import {
  Bell,
  Bot,
  Cloud,
  GraduationCap,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Trash2
} from "lucide-react";

const faqSections = [
  {
    title: "第一次打开先做什么？",
    icon: <GraduationCap size={18} />,
    items: [
      "可以直接新增事项、习惯、纪念日或备忘录，不需要先创建学期。",
      "学期只服务课程表；学生用户需要课程功能时再创建或导入。"
    ]
  },
  {
    title: "快速录入怎么写？",
    icon: <Sparkles size={18} />,
    items: [
      "按“日期 时间 内容”输入，字段之间用空格分隔。",
      "例如：明天 9:00 交作业；这周五 14:30 开组会。"
    ]
  },
  {
    title: "手机和电脑怎么同步？",
    icon: <Cloud size={18} />,
    items: [
      "登录同一个账号后，课程、事项、习惯、纪念日、备忘录和专注记录会同步。",
      "如果两端不一致，先打开设置里的账号与同步，查看状态并重试。"
    ]
  },
  {
    title: "提醒不响怎么办？",
    icon: <Bell size={18} />,
    items: [
      "先确认系统通知、浏览器通知、当前设备订阅都已允许。",
      "应用打开时会本地检查提醒；应用关闭后依赖系统推送。"
    ]
  },
  {
    title: "数据保存在哪里？",
    icon: <ShieldCheck size={18} />,
    items: [
      "数据优先保存在当前设备；登录后会同步到当前账号的云端。",
      "应用不会保存或展示账号密码。重要调整前建议在设置里导出备份。"
    ]
  },
  {
    title: "AI 助手和日程助手有什么区别？",
    icon: <Bot size={18} />,
    items: [
      "日程助手只在本机按固定规则查询日程，不需要 AI 权限，也不消耗 AI 额度；适合查今天、逾期、冲突、完成率和专注统计。",
      "AI 助手使用云端模型理解自由表达，可综合问答并创建事项、纪念日或备忘录；需要登录和 AI 权限，并计入日、周额度。"
    ]
  },
  {
    title: "安卓和 Windows 怎么安装？",
    icon: <Smartphone size={18} />,
    items: [
      "安卓 Edge 或 Chrome 可通过浏览器菜单添加到主屏幕。",
      "Windows Edge 或 Chrome 可通过安装入口保存为独立应用。"
    ]
  },
  {
    title: "删除后还能恢复吗？",
    icon: <Trash2 size={18} />,
    items: [
      "应用内删除是彻底删除，同步后其他设备也会删除。",
      "误删前若导出过 JSON 备份，可以通过备份导入找回。"
    ]
  }
];

export function HelpPage() {
  return (
    <section className="help-page">
      <div className="help-faq-list">
        {faqSections.map((section) => (
          <article key={section.title} className="help-card help-faq-item">
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
          <span>联网并登录后自动同步。长期使用建议偶尔主动导出备份文件。</span>
        </div>
      </section>
    </section>
  );
}
