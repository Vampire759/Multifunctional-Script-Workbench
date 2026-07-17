import { useState, useEffect, useRef } from "react";
import { Activity, Terminal, Play, Square, Clock, RefreshCw } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import PageHeader from "../components/PageHeader";
import { listScripts, listScreens, executeScript, type Script, type ScreenTask } from "../lib/api";
import { useNavigate } from "react-router-dom";

interface LogLine {
  text: string;
  ts: number;
  isInput?: boolean;
  level?: string;
  progress?: number;
  message?: string;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [scripts, setScripts] = useState<Script[]>([]);
  const [screens, setScreens] = useState<ScreenTask[]>([]);
  const [selectedScript, setSelectedScript] = useState<Script | null>(null);
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

  const loadScripts = async () => {
    try {
      const data = await listScripts();
      setScripts(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
      setScripts([]);
    }
  };

  useEffect(() => {
    loadScripts();
  }, []);

  const handleExecute = async (script: Script) => {
    try {
      const result = await executeScript(script.id);
      setSelectedScript(script);
      await loadScreens();
      const sessionName = result?.session_name || `script_${script.name}`;
      const screens = await listScreens();
      const target = screens.find((s) => s.name === sessionName);
      if (target) {
        setSelectedScreen(target);
      } else if (screens.length > 0) {
        const latest = screens.find((s) => s.name.startsWith("script_"));
        if (latest) setSelectedScreen(latest);
      }
    } catch (e: any) {
      alert(e?.response?.data?.detail || "执行失败");
    }
  };

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
    if (status.includes("running") || status.includes("detached")) return "text-neon-cyan";
    if (status === "stopped") return "text-muted-dim";
    return "text-neon-rose";
  };

  const statusText = (status: string) => {
    if (status.includes("running") || status.includes("detached")) return "运行中";
    if (status === "stopped") return "已停止";
    return "失败";
  };

  const scriptScreens = screens.filter((s) => s.name.startsWith("script_"));

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="任务台"
        subtitle="选中脚本执行并查看实时监控"
        icon={<Activity size={20} />}
        actions={
          <>
            <button onClick={loadScripts} className="btn-ghost flex items-center gap-1">
              <RefreshCw size={14} /> 刷新脚本
            </button>
            <button onClick={() => navigate("/scripts")} className="btn-amber flex items-center gap-2">
              <Terminal size={14} /> 脚本管理
            </button>
          </>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <div className="glass-card">
            <div className="p-4 border-b border-ink-700/60">
              <h3 className="text-sm font-mono text-muted-dim uppercase tracking-wider">脚本列表</h3>
            </div>
            <div className="max-h-[calc(100vh-300px)] overflow-y-auto">
              {scripts.length === 0 && (
                <div className="p-8 text-center text-muted-dim font-mono">
                  暂无脚本
                  <p className="text-xs mt-2">前往「脚本管理」创建或上传</p>
                </div>
              )}
              {scripts.map((script) => (
                <motion.div
                  key={script.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className={`p-4 border-b border-ink-800/40 ${
                    selectedScript?.id === script.id ? "bg-ink-800/40" : "hover:bg-ink-800/30"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-mono text-sm text-gray-100">{script.name}</span>
                    <span className={`text-xs font-mono ${script.status === "active" ? "text-neon-cyan" : "text-muted-dim"}`}>
                      {script.status === "active" ? "可用" : "草稿"}
                    </span>
                  </div>
                  <div className="text-xs text-muted-dim truncate">{script.filename}</div>
                  <button
                    onClick={() => handleExecute(script)}
                    className="mt-2 w-full py-1.5 bg-neon-cyan/10 text-neon-cyan rounded text-xs font-mono hover:bg-neon-cyan/20 transition-colors"
                  >
                    <Play size={12} className="inline mr-1" /> 执行脚本
                  </button>
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
                    <div className="text-center text-muted-dim py-8">等待日志...</div>
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
              </motion.div>
            ) : (
              <div className="glass-card h-full flex flex-col">
                <div className="p-4 border-b border-ink-700/60">
                  <h3 className="text-sm font-mono text-muted-dim uppercase tracking-wider">运行中的任务</h3>
                </div>
                <div className="flex-1 p-4 overflow-y-auto">
                  {scriptScreens.length === 0 && (
                    <div className="h-full flex items-center justify-center text-center">
                      <div>
                        <Activity size={48} className="text-muted-dim mx-auto mb-3" />
                        <p className="text-muted-dim font-mono">暂无运行中的任务</p>
                        <p className="text-xs text-muted-dim mt-2">从左侧选择脚本开始执行</p>
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
