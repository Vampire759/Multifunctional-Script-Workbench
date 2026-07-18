import { useState, useEffect, useRef, useCallback } from "react";
import { Activity, Terminal, Clock, RefreshCw, Save, RotateCcw } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import PageHeader from "../components/PageHeader";
import { listScreens, saveScreenLog, createScreen, type ScreenTask } from "../lib/api";

interface LogLine {
  text: string;
  ts: number;
  isInput?: boolean;
  level?: string;
  progress?: number;
  message?: string;
}

export default function Dashboard() {
  const [screens, setScreens] = useState<ScreenTask[]>([]);
  const [selectedScreen, setSelectedScreen] = useState<ScreenTask | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [currentProgress, setCurrentProgress] = useState<number | null>(null);
  const [progressMessage, setProgressMessage] = useState("");
  const [runningDuration, setRunningDuration] = useState(0);
  const [autoScroll, setAutoScroll] = useState(true);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<number | null>(null);

  const MAX_LOG_LINES = 2000;

  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, autoScroll]);

  const handleScroll = () => {
    if (!logContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = logContainerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 100;
    setAutoScroll(isAtBottom);
  };

  const parseLogLine = (line: string): LogLine => {
    const progressMatch = line.match(/^\[PROGRESS\]\s*(\{.*\})$/);
    if (progressMatch) {
      try {
        const data = JSON.parse(progressMatch[1]);
        if (data.type === "progress" || data.type === "log") {
          setCurrentProgress(data.progress ?? null);
          setProgressMessage(data.message ?? "");
          return {
            text: data.message || JSON.stringify(data),
            ts: Date.now(),
            level: data.level || "info",
            progress: data.progress,
            message: data.message,
          };
        }
      } catch {
        // ignore parse error
      }
    }
    return { text: line, ts: Date.now() };
  };

  const saveLogs = useCallback(async () => {
    if (!selectedScreen) return;
    try {
      await saveScreenLog(selectedScreen.name);
    } catch (e) {
      console.error("Failed to save log:", e);
    }
  }, [selectedScreen]);

  const retryScreen = async (screen: ScreenTask) => {
    try {
      await createScreen(screen.name, screen.command);
      loadScreens();
    } catch (e) {
      console.error("Failed to retry screen:", e);
    }
  };

  const loadScreens = async () => {
    try {
      const tasks = await listScreens();
      setScreens(Array.isArray(tasks) ? tasks : []);
    } catch (e) {
      console.error(e);
      setScreens([]);
    }
  };

  useEffect(() => {
    loadScreens();
    const t = setInterval(loadScreens, 5000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (selectedScreen) {
      setLogs([]);
      setAutoScroll(true);
      setCurrentProgress(null);
      setProgressMessage("");
      setRunningDuration(0);

      if (selectedScreen.started_at) {
        const started = new Date(selectedScreen.started_at);
        const now = new Date();
        setRunningDuration(Math.floor((now.getTime() - started.getTime()) / 1000));
      }

      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      timerRef.current = window.setInterval(() => {
        setRunningDuration((prev) => prev + 1);
      }, 1000);

      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${window.location.host}/api/screen/ws/${selectedScreen.name}`);
      wsRef.current = ws;

      ws.onopen = () => {
        setLogs([{ text: `[会话已连接] ${selectedScreen!.name}`, ts: Date.now(), level: "info" }]);
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === "log" && msg.payload?.log_line) {
            const logLine = parseLogLine(msg.payload.log_line);
            logLine.isInput = msg.payload.level === "input";
            setLogs((prev) => {
              const newLogs = [...prev, logLine];
              if (newLogs.length > MAX_LOG_LINES) {
                return newLogs.slice(-MAX_LOG_LINES);
              }
              return newLogs;
            });
          }
        } catch {
          // ignore
        }
      };

      ws.onerror = () => {
        setLogs((prev) => [...prev, { text: "[错误] WebSocket 连接异常", ts: Date.now(), level: "error" }]);
      };

      ws.onclose = () => {
        setLogs((prev) => [...prev, { text: "[会话已断开]", ts: Date.now(), level: "warning" }]);
      };

      return () => {
        ws.close();
        wsRef.current = null;
        if (timerRef.current) {
          clearInterval(timerRef.current);
        }
      };
    } else {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    }
  }, [selectedScreen?.name]);

  const formatDuration = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) {
      return `${h}h ${m}m ${s}s`;
    }
    if (m > 0) {
      return `${m}m ${s}s`;
    }
    return `${s}s`;
  };

  const levelColor = (level?: string) => {
    switch (level) {
      case "success": return "text-neon-green";
      case "error": return "text-neon-rose";
      case "warning": return "text-neon-amber";
      case "info": return "text-neon-cyan";
      default: return "text-gray-300";
    }
  };

  const statusColor = (status: string) => {
    const s = status.toLowerCase();
    if (s.includes("running") || s.includes("detached")) return "text-neon-cyan";
    if (s === "stopped") return "text-muted-dim";
    return "text-neon-rose";
  };

  const statusText = (status: string) => {
    const s = status.toLowerCase();
    if (s.includes("running") || s.includes("detached")) return "运行中";
    if (s === "stopped") return "已停止";
    return "失败";
  };

  const scriptScreens = screens.filter((s) => s.name.startsWith("script_"));

  return (
    <div className="p-6 max-w-7xl mx-auto flex flex-col h-[calc(100vh-2rem)]">
      <PageHeader
        title="任务台"
        subtitle="查看运行中的任务和实时日志"
        icon={<Activity size={20} />}
        actions={
          <button onClick={loadScreens} className="btn-ghost flex items-center gap-1">
            <RefreshCw size={14} /> 刷新
          </button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0">
        <div className="lg:col-span-1">
          <div className="glass-card h-full flex flex-col">
            <div className="p-4 border-b border-ink-700/60">
              <h3 className="text-sm font-mono text-muted-dim uppercase tracking-wider">任务列表</h3>
            </div>
            <div className="flex-1 overflow-y-auto">
              {screens.length === 0 && (
                <div className="p-8 text-center text-muted-dim font-mono">
                  暂无任务
                  <p className="text-xs mt-2">任务将在这里显示</p>
                </div>
              )}
              {screens.map((screen) => (
                <motion.div
                  key={screen.name}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  onClick={() => setSelectedScreen(screen)}
                  className={`p-4 border-b border-ink-800/40 cursor-pointer ${
                    selectedScreen?.name === screen.name ? "bg-ink-800/40" : "hover:bg-ink-800/30"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-mono text-sm text-gray-100">{screen.name}</span>
                    <span className={`text-xs font-mono ${statusColor(screen.status)}`}>
                      {statusText(screen.status)}
                    </span>
                  </div>
                  <div className="text-xs text-muted-dim truncate">{screen.command || "-"}</div>
                  <div className="flex items-center gap-2 mt-2">
                    {(statusText(screen.status) === "失败" || statusText(screen.status) === "已停止") && (
                      <button
                        onClick={(e) => { e.stopPropagation(); retryScreen(screen); }}
                        className="p-1.5 rounded text-neon-amber hover:bg-neon-amber/20 transition-all"
                        title="重新启动会话"
                      >
                        <RotateCcw size={14} />
                      </button>
                    )}
                    {screen.started_at && (
                      <span className="text-xs text-muted-dim flex items-center gap-1">
                        <Clock size={12} />
                        {formatDuration(Math.floor((new Date().getTime() - new Date(screen.started_at).getTime()) / 1000))}
                      </span>
                    )}
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </div>

        <div className="lg:col-span-2">
          <AnimatePresence>
            {selectedScreen ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="glass-card h-full flex flex-col"
              >
                <div className="p-4 border-b border-ink-700/60 flex items-center justify-between">
                  <div>
                    <h3 className="font-mono text-gray-100 flex items-center gap-2">
                      <Terminal size={16} className="text-neon-cyan" />
                      {selectedScreen.name}
                    </h3>
                    <div className="flex items-center gap-4 mt-1">
                      <span className={`text-xs font-mono ${statusColor(selectedScreen.status)}`}>
                        {statusText(selectedScreen.status)}
                      </span>
                      <span className="text-xs font-mono text-muted-dim flex items-center gap-1">
                        <Clock size={12} />
                        运行时长: {formatDuration(runningDuration)}
                      </span>
                      <span className="text-xs font-mono text-muted-dim">
                        {logs.length} 行
                        {!autoScroll && <span className="text-neon-amber ml-2">（已暂停滚动）</span>}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {!autoScroll && (
                      <button
                        onClick={() => {
                          setAutoScroll(true);
                          logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
                        }}
                        className="btn-ghost flex items-center gap-1 text-xs"
                        title="滚动到底部"
                      >
                        <RefreshCw size={12} /> 回到底部
                      </button>
                    )}
                  </div>
                </div>

                {currentProgress !== null && (
                  <div className="p-4 border-b border-ink-700/60 bg-ink-900/40">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-gray-300">{progressMessage}</span>
                      <span className="text-sm font-mono text-neon-cyan">{currentProgress}%</span>
                    </div>
                    <div className="h-2 bg-ink-800 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${currentProgress}%` }}
                        className="h-full bg-gradient-to-r from-neon-cyan to-neon-green"
                        transition={{ duration: 0.3 }}
                      />
                    </div>
                  </div>
                )}

                <div
                  className="flex-1 p-4 overflow-y-auto font-mono text-sm"
                  ref={logContainerRef}
                  onScroll={handleScroll}
                >
                  {logs.length === 0 && (
                    <div className="text-center text-muted-dim py-8">
                      <div className="flex items-center justify-center gap-2">
                        <RefreshCw size={16} className="animate-spin" />
                        连接中...
                      </div>
                    </div>
                  )}
                  {logs.map((log, idx) => (
                    <div key={idx} className={`break-all leading-relaxed ${
                      log.isInput ? "text-neon-amber" : levelColor(log.level)
                    }`}>
                      {log.text}
                    </div>
                  ))}
                  <div ref={logsEndRef} />
                </div>
                <div className="p-3 border-t border-ink-700/60 flex items-center justify-between bg-ink-900/50">
                  <div className="flex items-center gap-2">
                    {selectedScreen && (statusText(selectedScreen.status) === "失败" || statusText(selectedScreen.status) === "已停止") && (
                      <button
                        onClick={() => retryScreen(selectedScreen)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-neon-amber/20 text-neon-amber hover:bg-neon-amber/30 transition-all"
                        title="重新启动会话"
                      >
                        <RotateCcw size={14} />
                        重试
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={saveLogs}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-ink-800/30 text-muted hover:bg-ink-800/50 transition-all"
                      title="保存日志"
                    >
                      <Save size={14} />
                      保存日志
                    </button>
                  </div>
                </div>
              </motion.div>
            ) : (
              <div className="glass-card h-full flex flex-col">
                <div className="p-4 border-b border-ink-700/60">
                  <h3 className="text-sm font-mono text-muted-dim uppercase tracking-wider">实时日志</h3>
                </div>
                <div className="flex-1 p-4 overflow-y-auto">
                  {scriptScreens.length === 0 && (
                    <div className="h-full flex items-center justify-center text-center">
                      <div>
                        <Activity size={48} className="text-muted-dim mx-auto mb-3" />
                        <p className="text-muted-dim font-mono">暂无运行中的任务</p>
                        <p className="text-xs text-muted-dim mt-2">从左侧选择任务查看日志</p>
                      </div>
                    </div>
                  )}
                  {scriptScreens.map((screen) => (
                    <motion.div
                      key={screen.name}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      onClick={() => setSelectedScreen(screen)}
                      className={`p-4 border border-ink-700/40 rounded-lg cursor-pointer transition-all ${
                        selectedScreen?.name === screen.name
                          ? "border-neon-cyan/50 bg-neon-cyan/5"
                          : "hover:border-ink-600 hover:bg-ink-800/30"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-mono text-sm text-gray-100">{screen.name}</span>
                        <span className={`text-xs font-mono ${statusColor(screen.status)}`}>
                          {statusText(screen.status)}
                        </span>
                      </div>
                      <div className="text-xs text-muted-dim truncate">{screen.command}</div>
                      {screen.started_at && (
                        <div className="text-xs text-muted-dim mt-2 flex items-center gap-1">
                          <Clock size={12} />
                          {formatDuration(Math.floor((new Date().getTime() - new Date(screen.started_at).getTime()) / 1000))}
                        </div>
                      )}
                    </motion.div>
                  ))}
                </div>
              </div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
