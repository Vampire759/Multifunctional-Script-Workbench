import { NavLink, useLocation } from "react-router-dom";
import { LayoutDashboard, Clock, Database, Settings, Terminal, Download, ScrollText, LogOut, Code2, Monitor, Package } from "lucide-react";
import { motion } from "framer-motion";

const navItems = [
  { to: "/dashboard", label: "任务台", icon: LayoutDashboard },
  { to: "/scheduler", label: "定时任务", icon: Clock },
  { to: "/downloads", label: "下载管理", icon: Download },
  { to: "/logs", label: "日志中心", icon: ScrollText },
  { to: "/scripts", label: "脚本管理", icon: Code2 },
  { to: "/packages", label: "脚本库", icon: Package },
  { to: "/local-screen", label: "本地Screen", icon: Monitor },
  { to: "/tasks", label: "任务管理", icon: Settings },
  { to: "/profile", label: "个人设置", icon: Database },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();

  return (
    <div className="flex h-screen overflow-hidden">
      {/* 侧边栏 */}
      <aside className="w-20 flex-shrink-0 bg-ink-950/80 border-r border-ink-800/60 flex flex-col items-center py-6 z-10">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center">
          <div className="w-10 h-10 rounded-lg border border-neon-cyan/60 flex items-center justify-center shadow-neon-cyan">
            <Terminal size={20} className="text-neon-cyan" />
          </div>
          <span className="mt-2 text-[10px] font-mono text-muted-dim tracking-widest">SCP</span>
        </div>

        {/* 导航项 */}
        <nav className="flex-1 flex flex-col items-center gap-2">
          {navItems.map((item) => {
            const active = location.pathname.startsWith(item.to);
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className="relative group flex flex-col items-center justify-center w-14 h-14 rounded-lg transition-all duration-200"
              >
                {active && (
                  <motion.div
                    layoutId="nav-active"
                    className="absolute inset-0 rounded-lg border border-neon-cyan/50 bg-neon-cyan/5 shadow-neon-cyan"
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                  />
                )}
                <Icon
                  size={20}
                  className={`relative z-10 transition-colors ${active ? "text-neon-cyan" : "text-muted group-hover:text-neon-cyan"}`}
                />
                <span
                  className={`relative z-10 mt-1 text-[10px] font-mono transition-colors ${active ? "text-neon-cyan" : "text-muted-dim group-hover:text-neon-cyan"}`}
                >
                  {item.label}
                </span>
              </NavLink>
            );
          })}
        </nav>

        {/* 底部状态指示 */}
        <div className="mt-auto flex flex-col items-center gap-3">
          <button
            onClick={() => {
              localStorage.removeItem("token");
              localStorage.removeItem("username");
              window.location.href = "/login";
            }}
            className="flex flex-col items-center justify-center w-14 h-14 rounded-lg text-muted hover:text-neon-rose hover:bg-ink-800/30 transition-all"
            title="退出登录"
          >
            <LogOut size={20} />
            <span className="mt-1 text-[10px] font-mono">退出</span>
          </button>
          <div className="w-2 h-2 rounded-full bg-neon-green shadow-[0_0_8px_rgba(16,245,160,0.8)] animate-pulse-slow" />
          <span className="text-[9px] font-mono text-muted-dim">ONLINE</span>
        </div>
      </aside>

      {/* 主内容区 */}
      <main className="flex-1 flex flex-col min-h-0">
        <motion.div
          key={location.pathname}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className="flex-1 min-h-0"
        >
          {children}
        </motion.div>
      </main>
    </div>
  );
}
