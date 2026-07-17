import { useState, useEffect, useRef } from "react";
import { Square, Terminal, RefreshCw, Plus, Send, Download } from "lucide-react";
import PageHeader from "../components/PageHeader";

interface ScreenSession {
  pid: string;
  name: string;
  status: string;
}

export default function LocalScreen() {
  const [screens, setScreens] = useState<ScreenSession[]>([]);
  const [selectedScreen, setSelectedScreen] = useState<string | null>(null);
  const [log, setLog] = useState("");
  const [inputCommand, setInputCommand] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);

  const MAX_LOG_LENGTH = 50000;
  const MAX_LOG_LINES = 2000;

  useEffect(() => {
    fetchScreens();
    const interval = setInterval(fetchScreens, 3000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (autoScroll && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [log, autoScroll]);

  const handleScroll = () => {
    if (!logContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = logContainerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 100;
    setAutoScroll(isAtBottom);
  };

  const saveLog = () => {
    if (!log || !selectedScreen) return;
    const blob = new Blob([log], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `screen_log_${selectedScreen}_${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    if (selectedScreen) {
      connectWebSocket(selectedScreen);
    }
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [selectedScreen]);

  const fetchScreens = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/local-screen/list");
      const data = await response.json();
      if (data.success) {
        setScreens(data.data || []);
        setError("");
      } else {
        setError(data.message || "无法连接到宿主机");
        setScreens([]);
      }
    } catch (err) {
      setError("网络错误");
      setScreens([]);
    } finally {
      setLoading(false);
    }
  };

  const connectWebSocket = (name: string) => {
    if (wsRef.current) {
      wsRef.current.close();
    }

    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${window.location.host}/api/local-screen/ws/${name}`);

    ws.onopen = () => {
      setIsConnected(true);
      setLog("=== 已连接到宿主机 Screen 会话 ===\n");
      setAutoScroll(true);
      // 不再调用 fetchLog，WebSocket 的 log_puller 会自动从 pos=0 推送全部日志
    };

    ws.onmessage = (event) => {
      const newData = event.data;
      if (typeof newData === "string" && newData.trim()) {
        setLog((prev) => {
          const newLog = prev + newData;
          let trimmedLog = newLog;
          if (trimmedLog.length > MAX_LOG_LENGTH) {
            trimmedLog = "..." + trimmedLog.slice(-MAX_LOG_LENGTH);
          }
          const lines = trimmedLog.split("\n");
          if (lines.length > MAX_LOG_LINES) {
            trimmedLog = "..." + lines.slice(-MAX_LOG_LINES).join("\n");
          }
          return trimmedLog;
        });
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      setLog((prev) => prev + "\n=== 连接已断开 ===\n");
    };

    ws.onerror = () => {
      setIsConnected(false);
      setLog((prev) => prev + "\n=== 连接错误 ===\n");
    };

    wsRef.current = ws;
  };

  const createScreen = async () => {
    const name = prompt("输入 Screen 会话名称：");
    if (!name) return;

    try {
      const response = await fetch(`/api/local-screen/create?name=${encodeURIComponent(name)}`, {
        method: "POST",
      });
      const data = await response.json();
      if (data.success) {
        await fetchScreens();
        alert("Screen 会话创建成功");
      } else {
        alert(`创建失败：${data.message}`);
      }
    } catch (err) {
      alert("创建失败：网络错误");
    }
  };

  const sendCommand = async (command: string) => {
    if (!selectedScreen || !command.trim()) return;

    setLog((prev) => prev + `> ${command}\n`);
    setInputCommand("");

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "command", payload: command.trim() }));
    } else {
      try {
        await fetch(
          `/api/local-screen/send/${selectedScreen}?command=${encodeURIComponent(command.trim())}`,
          { method: "POST" }
        );
      } catch (err) {
        console.error("Failed to send command:", err);
      }
    }
  };

  const stopScreen = async (name: string) => {
    if (!confirm(`确定要停止 Screen 会话 "${name}" 吗？`)) return;

    try {
      const response = await fetch(`/api/local-screen/stop/${name}`, { method: "POST" });
      const data = await response.json();
      if (data.success) {
        if (selectedScreen === name) {
          setSelectedScreen(null);
          setLog("");
        }
        await fetchScreens();
      } else {
        alert(`停止失败：${data.message}`);
      }
    } catch (err) {
      alert("停止失败：网络错误");
    }
  };

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="本地 Screen 监控" subtitle="监控宿主机上的 Screen 会话" />

      {error && (
        <div className="mx-4 mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400">
          <p>{error}</p>
          <p className="text-sm mt-1">请确保宿主机上已启动 host_screen_agent.py</p>
        </div>
      )}

      <div className="flex-1 flex gap-4 p-4 overflow-hidden">
        <div className="w-80 flex flex-col bg-ink-900 rounded-xl border border-ink-700/60">
          <div className="p-4 border-b border-ink-700/60 flex items-center justify-between">
            <h3 className="font-medium text-muted">宿主机 Screen 会话</h3>
            <button
              onClick={createScreen}
              className="p-1.5 rounded-lg bg-neon-cyan/10 text-neon-cyan hover:bg-neon-cyan/20 transition-colors"
              title="创建会话"
            >
              <Plus size={16} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {loading ? (
              <div className="flex items-center justify-center h-full text-muted-dim">
                <RefreshCw className="animate-spin" size={20} />
              </div>
            ) : screens.length === 0 ? (
              <div className="text-center py-8 text-muted-dim">
                <Terminal size={40} className="mx-auto mb-2 opacity-50" />
                <p>暂无 Screen 会话</p>
              </div>
            ) : (
              <div className="space-y-2">
                {screens.map((screen) => (
                  <div
                    key={screen.name}
                    onClick={() => setSelectedScreen(screen.name)}
                    className={`p-3 rounded-lg cursor-pointer transition-all ${
                      selectedScreen === screen.name
                        ? "bg-neon-cyan/20 border border-neon-cyan/50"
                        : "bg-ink-800/50 border border-transparent hover:bg-ink-800"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-2 h-2 rounded-full ${
                            screen.status === "running" || screen.status === "Detached" ? "bg-neon-green" : "bg-muted"
                          }`}
                        />
                        <span className="font-mono text-sm truncate max-w-[160px]">
                          {screen.name}
                        </span>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          stopScreen(screen.name);
                        }}
                        className="p-1 rounded text-muted hover:text-red-400 transition-colors"
                        title="停止会话"
                      >
                        <Square size={14} />
                      </button>
                    </div>
                    <div className="text-xs text-muted-dim mt-1">PID: {screen.pid}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="p-3 border-t border-ink-700/60">
            <button
              onClick={fetchScreens}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-ink-800/50 hover:bg-ink-800 text-muted transition-colors"
            >
              <RefreshCw size={14} />
              刷新列表
            </button>
          </div>
        </div>

        <div className="flex-1 flex flex-col bg-ink-900 rounded-xl border border-ink-700/60">
          {selectedScreen ? (
            <>
              <div className="p-4 border-b border-ink-700/60 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Terminal size={18} className="text-neon-cyan" />
                  <span className="font-mono font-medium">{selectedScreen}</span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs ${
                      isConnected
                        ? "bg-green-500/20 text-green-400"
                        : "bg-red-500/20 text-red-400"
                    }`}
                  >
                    {isConnected ? "已连接" : "未连接"}
                  </span>
                  <span className="text-xs text-muted-dim">
                    {log.split("\n").length} 行 / {log.length} 字符
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {!autoScroll && (
                    <button
                      onClick={() => {
                        setAutoScroll(true);
                        if (logContainerRef.current) {
                          logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
                        }
                      }}
                      className="px-2 py-1 rounded-lg bg-neon-amber/10 text-neon-amber hover:bg-neon-amber/20 transition-colors text-xs flex items-center gap-1"
                      title="滚动到底部"
                    >
                      <RefreshCw size={12} /> 回到底部
                    </button>
                  )}
                  <button
                    onClick={saveLog}
                    className="p-1.5 rounded-lg bg-neon-cyan/10 text-neon-cyan hover:bg-neon-cyan/20 transition-colors"
                    title="保存日志到本地"
                  >
                    <Download size={14} />
                  </button>
                  <button
                    onClick={() => {
                      setSelectedScreen(null);
                      setLog("");
                    }}
                    className="text-muted hover:text-white transition-colors"
                  >
                    关闭
                  </button>
                </div>
              </div>

              <div
                ref={logContainerRef}
                className="flex-1 p-4 overflow-y-auto font-mono text-sm whitespace-pre-wrap min-h-0"
                style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
                onScroll={handleScroll}
              >
                {log || "等待数据..."}
                <div ref={logEndRef} />
              </div>

              <div className="p-4 border-t border-ink-700/60">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={inputCommand}
                    onChange={(e) => setInputCommand(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && sendCommand(inputCommand)}
                    placeholder="输入命令..."
                    className="flex-1 px-4 py-2 bg-ink-800 border border-ink-600 rounded-lg text-sm focus:outline-none focus:border-neon-cyan transition-colors"
                  />
                  <button
                    onClick={() => sendCommand(inputCommand)}
                    disabled={!inputCommand.trim()}
                    className="px-4 py-2 bg-neon-cyan/20 text-neon-cyan rounded-lg hover:bg-neon-cyan/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                  >
                    <Send size={14} />
                    发送
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-dim">
              <div className="text-center">
                <Terminal size={64} className="mx-auto mb-4 opacity-30" />
                <p className="text-lg">选择一个 Screen 会话查看</p>
                <p className="text-sm mt-2">或创建新的会话</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
