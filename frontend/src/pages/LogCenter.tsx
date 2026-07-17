import { useState, useEffect, useRef, useCallback } from "react";
import { Terminal, Play, Square, Trash2, RefreshCw, LogIn, Send, AlertCircle, CheckCircle, Info, Monitor, Save, Clock, ToggleLeft, ToggleRight, FolderOpen, Folder, FileText, Download, Search, ChevronDown, ChevronRight as ChevronRightIcon, LayoutGrid, List } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import PageHeader from "../components/PageHeader";
import TerminalComponent from "../components/Terminal";
import { listScreens, createScreen, getScreenLog, stopScreen, deleteScreen, type ScreenTask, listLogFiles, listLogFilesGrouped, getLogFileContent, downloadLogFile, deleteLogFile, deleteSessionLogs, type LogFile, type SessionLogGroup } from "../lib/api";

interface LogLine {
  text: string;
  ts: number;
  isInput?: boolean;
  level?: string;
  progress?: number;
  message?: string;
}

type LeftPanelMode = "sessions" | "history";
type HistoryViewMode = "timeline" | "grouped";

export default function LogCenter() {
  const [tasks, setTasks] = useState<ScreenTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedTask, setSelectedTask] = useState<ScreenTask | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [newName, setNewName] = useState("");
  const [newCommand, setNewCommand] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [inputCommand, setInputCommand] = useState("");
  const [currentProgress, setCurrentProgress] = useState<number | null>(null);
  const [progressMessage, setProgressMessage] = useState("");
  const [terminalMode, setTerminalMode] = useState(false);
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(false);
  const [autoSaveInterval, setAutoSaveInterval] = useState(300);
  const [lastSaveTime, setLastSaveTime] = useState<string | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const saveTimerRef = useRef<number | null>(null);

  const [leftPanelMode, setLeftPanelMode] = useState<LeftPanelMode>("history");
  const [logFiles, setLogFiles] = useState<LogFile[]>([]);
  const [logGroups, setLogGroups] = useState<SessionLogGroup[]>([]);
  const [selectedLogFile, setSelectedLogFile] = useState<LogFile | null>(null);
  const [logFileContent, setLogFileContent] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [historyViewMode, setHistoryViewMode] = useState<HistoryViewMode>("grouped");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<{ type: "file" | "session"; name: string } | null>(null);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

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

  const connectWebSocket = useCallback(() => {
    if (!selectedTask) return;

    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${window.location.host}/api/screen/ws/${selectedTask.name}`);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log(`WebSocket connected to ${selectedTask.name}`);
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "log" && msg.payload?.log_line) {
          const logLine = parseLogLine(msg.payload.log_line);
          logLine.isInput = msg.payload.level === "input";
          setLogs((prev) => [...prev, logLine]);
        }
      } catch {
        // ignore
      }
    };

    ws.onerror = (error) => {
      console.error(`WebSocket error for ${selectedTask.name}:`, error);
    };

    ws.onclose = (event) => {
      console.log(`WebSocket closed for ${selectedTask.name}, code: ${event.code}, reason: ${event.reason}`);
      if (selectedTask && event.code !== 1000) {
        setTimeout(() => connectWebSocket(), 3000);
      }
      wsRef.current = null;
    };
  }, [selectedTask]);

  useEffect(() => {
    if (selectedTask) {
      setLogs([]);
      setCurrentProgress(null);
      setProgressMessage("");
      getScreenLog(selectedTask.name, 200).then((r: any) => {
        const existingLogs = r.log?.split("\n").filter(Boolean).map(parseLogLine) || [];
        setLogs(existingLogs);
      });

      connectWebSocket();

      return () => {
        if (wsRef.current) {
          wsRef.current.close(1000, "Component unmounted");
          wsRef.current = null;
        }
      };
    } else {
      if (wsRef.current) {
        wsRef.current.close(1000, "No task selected");
        wsRef.current = null;
      }
    }
  }, [selectedTask, connectWebSocket]);

  const sendCommand = () => {
    if (!inputCommand.trim() || !wsRef.current) return;
    wsRef.current.send(JSON.stringify({ type: "command", payload: inputCommand.trim() }));
    setInputCommand("");
  };

  const saveLogs = useCallback(() => {
    if (!selectedTask || logs.length === 0) return;
    
    const content = logs.map(log => {
      const prefix = log.isInput ? "> " : log.level ? `[${log.level.toUpperCase()}] ` : "";
      return `${new Date(log.ts).toLocaleString()} ${prefix}${log.text}`;
    }).join("\n");
    
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    a.download = `screen_${selectedTask.name}_${timestamp}.log`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    setLastSaveTime(new Date().toLocaleString());
  }, [selectedTask, logs]);

  const toggleAutoSave = () => {
    if (autoSaveEnabled) {
      if (saveTimerRef.current) {
        clearInterval(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    } else {
      saveLogs();
      saveTimerRef.current = window.setInterval(saveLogs, autoSaveInterval * 1000);
    }
    setAutoSaveEnabled(!autoSaveEnabled);
  };

  const loadSessions = async () => {
    setLoading(true);
    try {
      setTasks(await listScreens());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const loadHistoryLogs = async () => {
    try {
      setLogFiles(await listLogFiles());
      setLogGroups(await listLogFilesGrouped());
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadSessions();
    loadHistoryLogs();
    const t = setInterval(() => {
      loadSessions();
      loadHistoryLogs();
    }, 10000);
    return () => {
      clearInterval(t);
      if (saveTimerRef.current) {
        clearInterval(saveTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (autoSaveEnabled && saveTimerRef.current) {
      clearInterval(saveTimerRef.current);
      saveTimerRef.current = window.setInterval(saveLogs, autoSaveInterval * 1000);
    }
  }, [autoSaveInterval, autoSaveEnabled, saveLogs]);

  useEffect(() => {
    if (saveTimerRef.current) {
      clearInterval(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }, [selectedTask]);

  const handleCreate = async () => {
    if (!newName.trim()) {
      alert("请填写任务名称");
      return;
    }
    try {
      await createScreen(newName.trim(), newCommand.trim());
      setNewName("");
      setNewCommand("");
      setShowCreate(false);
      await loadSessions();
    } catch (e: any) {
      alert(e?.response?.data?.detail || "创建失败");
    }
  };

  const handleStop = async (task: ScreenTask) => {
    if (!confirm(`确认终止会话 "${task.name}"？`)) return;
    try {
      await stopScreen(task.name);
      await loadSessions();
    } catch (e: any) {
      alert(e?.response?.data?.detail || "操作失败");
    }
  };

  const handleDelete = async (task: ScreenTask) => {
    if (!confirm(`确认删除会话记录 "${task.name}"？`)) return;
    try {
      await deleteScreen(task.name);
      await loadSessions();
      if (selectedTask?.name === task.name) {
        setSelectedTask(null);
      }
    } catch (e: any) {
      alert(e?.response?.data?.detail || "删除失败");
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

  const levelColor = (level?: string) => {
    switch (level) {
      case "success": return "text-neon-green";
      case "error": return "text-neon-rose";
      case "warning": return "text-neon-amber";
      case "info": return "text-neon-cyan";
      default: return "text-gray-300";
    }
  };

  const levelIcon = (level?: string) => {
    switch (level) {
      case "success": return <CheckCircle size={14} className="inline mr-1" />;
      case "error": return <AlertCircle size={14} className="inline mr-1" />;
      case "warning": return <AlertCircle size={14} className="inline mr-1" />;
      case "info": return <Info size={14} className="inline mr-1" />;
      default: return null;
    }
  };

  const viewLogFile = async (file: LogFile) => {
    setSelectedLogFile(file);
    setLogFileContent("加载中...");
    try {
      const result = await getLogFileContent(file.name, 1000);
      setLogFileContent(result.content || "日志文件为空");
    } catch (e) {
      console.error(e);
      setLogFileContent("加载失败");
    }
  };

  const handleDeleteLogFile = async (filename: string) => {
    try {
      await deleteLogFile(filename);
      loadHistoryLogs();
      if (selectedLogFile?.name === filename) {
        setSelectedLogFile(null);
        setLogFileContent("");
      }
    } catch (e) {
      console.error(e);
    }
    setConfirmDelete(null);
  };

  const handleDeleteSessionLogs = async (sessionName: string) => {
    try {
      await deleteSessionLogs(sessionName);
      loadHistoryLogs();
      if (selectedLogFile?.session_name === sessionName) {
        setSelectedLogFile(null);
        setLogFileContent("");
      }
    } catch (e) {
      console.error(e);
    }
    setConfirmDelete(null);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  const filteredLogFiles = logFiles.filter((file) =>
    file.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (file.session_name && file.session_name.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const filteredLogGroups = logGroups.filter((group) =>
    group.session_name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const toggleGroup = (sessionName: string) => {
    const newExpanded = new Set(expandedGroups);
    if (newExpanded.has(sessionName)) {
      newExpanded.delete(sessionName);
    } else {
      newExpanded.add(sessionName);
    }
    setExpandedGroups(newExpanded);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="日志中心"
        subtitle="管理 Screen 会话，实时监控服务器端命令执行日志"
        icon={<Terminal size={20} />}
        actions={
          <>
            <button onClick={() => { loadSessions(); loadHistoryLogs(); }} className="btn-ghost flex items-center gap-1">
              <RefreshCw size={14} /> 刷新
            </button>
            {leftPanelMode === "sessions" && (
              <button onClick={() => setShowCreate(true)} className="btn-neon flex items-center gap-2">
                <LogIn size={14} /> 创建会话
              </button>
            )}
          </>
        }
      />

      <AnimatePresence>
        {showCreate && leftPanelMode === "sessions" && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="glass-card p-4 mb-4"
          >
            <div className="flex flex-wrap items-center gap-3">
              <div className="w-48">
                <label className="text-xs font-mono text-muted-dim">任务名称</label>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="input-cyber mt-1"
                  placeholder="task-name"
                />
              </div>
              <div className="flex-1 min-w-[300px]">
                <label className="text-xs font-mono text-muted-dim">执行命令</label>
                <input
                  value={newCommand}
                  onChange={(e) => setNewCommand(e.target.value)}
                  className="input-cyber mt-1"
                  placeholder="python scripts/my_script.py"
                  onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                />
              </div>
              <button onClick={handleCreate} className="btn-amber flex items-center gap-2 mt-5">
                <Play size={14} /> 创建
              </button>
              <button onClick={() => setShowCreate(false)} className="btn-ghost mt-5">取消</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 h-[calc(100vh-180px)]">
        <div className="lg:col-span-1">
          <div className="glass-card h-full flex flex-col">
            <div className="p-3 border-b border-ink-700/60">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setLeftPanelMode("sessions")}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-mono transition-all ${
                    leftPanelMode === "sessions" 
                      ? "bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/30" 
                      : "text-muted hover:text-gray-200 hover:bg-ink-800/30"
                  }`}
                >
                  <Terminal size={14} /> 会话
                </button>
                <button
                  onClick={() => setLeftPanelMode("history")}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-mono transition-all ${
                    leftPanelMode === "history" 
                      ? "bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/30" 
                      : "text-muted hover:text-gray-200 hover:bg-ink-800/30"
                  }`}
                >
                  <FolderOpen size={14} /> 历史日志
                </button>
              </div>
            </div>

            {leftPanelMode === "sessions" ? (
              <div className="flex-1 overflow-y-auto">
                {loading && (
                  <div className="p-8 text-center text-muted-dim font-mono">加载中...</div>
                )}
                {!loading && tasks.length === 0 && (
                  <div className="p-8 text-center text-muted-dim font-mono">
                    暂无会话
                    <p className="text-xs mt-2">点击上方「创建会话」开始</p>
                  </div>
                )}
                {tasks.map((task) => (
                  <motion.div
                    key={task.id || task.name}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    onClick={() => { setSelectedTask(task); setSelectedLogFile(null); }}
                    className={`p-4 border-b border-ink-800/40 cursor-pointer transition-colors ${
                      selectedTask?.name === task.name ? "bg-ink-800/40" : "hover:bg-ink-800/30"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono text-sm text-gray-100">{task.name}</span>
                      <span className={`text-xs font-mono ${statusColor(task.status)}`}>
                        {statusText(task.status)}
                      </span>
                    </div>
                    <div className="text-xs text-muted-dim truncate" title={task.command}>
                      {task.command || "-"}
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      {(task.status.includes("running") || task.status.includes("detached")) && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleStop(task); }}
                          className="p-1.5 rounded text-muted hover:text-neon-amber hover:bg-ink-800/60 transition-all"
                          title="终止"
                        >
                          <Square size={14} />
                        </button>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(task); }}
                        className="p-1.5 rounded text-muted hover:text-neon-rose hover:bg-ink-800/60 transition-all"
                        title="删除"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </motion.div>
                ))}
              </div>
            ) : (
              <div className="flex-1 flex flex-col">
                <div className="p-3 border-b border-ink-700/60">
                  <div className="relative">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-dim" />
                    <input
                      type="text"
                      placeholder="搜索日志文件..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-8 pr-3 py-1.5 bg-ink-800/40 border border-ink-700/60 rounded-lg text-xs text-gray-200 placeholder:text-muted-dim focus:outline-none focus:border-neon-cyan/60 transition-colors"
                    />
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <p className="text-xs text-muted-dim">
                      {historyViewMode === "timeline" ? `共 ${filteredLogFiles.length} 个日志文件` : `共 ${filteredLogGroups.length} 个会话分组`}
                    </p>
                    <div className="flex items-center gap-1 bg-ink-800/40 rounded p-0.5">
                      <button
                        onClick={() => setHistoryViewMode("timeline")}
                        className={`p-1 rounded transition-all ${historyViewMode === "timeline" ? "bg-neon-cyan/20 text-neon-cyan" : "text-muted hover:text-gray-200"}`}
                        title="时间线视图"
                      >
                        <List size={12} />
                      </button>
                      <button
                        onClick={() => setHistoryViewMode("grouped")}
                        className={`p-1 rounded transition-all ${historyViewMode === "grouped" ? "bg-neon-cyan/20 text-neon-cyan" : "text-muted hover:text-gray-200"}`}
                        title="分组视图"
                      >
                        <LayoutGrid size={12} />
                      </button>
                    </div>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-2">
                  {historyViewMode === "timeline" ? (
                    filteredLogFiles.length === 0 ? (
                      <div className="p-6 text-center">
                        <FileText size={32} className="mx-auto text-muted-dim mb-3" />
                        <p className="text-muted-dim text-sm">暂无历史日志</p>
                      </div>
                    ) : (
                      filteredLogFiles.map((file) => (
                        <motion.div
                          key={`${file.name}-${file.path}`}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          onClick={() => { setSelectedLogFile(file); setSelectedTask(null); }}
                          className={`p-2.5 mb-1.5 rounded-lg cursor-pointer transition-all ${
                            selectedLogFile?.name === file.name ? "bg-neon-cyan/10 border border-neon-cyan/30" : "hover:bg-ink-800/40 border border-transparent"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              <FileText size={12} className={selectedLogFile?.name === file.name ? "text-neon-cyan" : "text-muted-dim"} />
                              <span className="font-mono text-xs text-gray-200 truncate max-w-[100px]" title={file.name}>
                                {file.name}
                              </span>
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={(e) => { e.stopPropagation(); window.open(downloadLogFile(file.name), "_blank"); }}
                                className="p-1 rounded hover:bg-ink-700/40 text-muted hover:text-neon-cyan transition-colors"
                                title="下载"
                              >
                                <Download size={12} />
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); setConfirmDelete({ type: "file", name: file.name }); }}
                                className="p-1 rounded hover:bg-ink-700/40 text-muted hover:text-neon-rose transition-colors"
                                title="删除"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          </div>
                          <div className="flex items-center justify-between mt-1">
                            <span className="text-xs text-muted-dim">{formatFileSize(file.size)}</span>
                            <span className="text-xs text-muted-dim">{new Date(file.modified_at).toLocaleString()}</span>
                          </div>
                          {file.session_name && (
                            <div className="mt-1">
                              <span className="text-xs text-neon-cyan/70 bg-neon-cyan/10 px-1.5 py-0.5 rounded">
                                {file.session_name}
                              </span>
                            </div>
                          )}
                        </motion.div>
                      ))
                    )
                  ) : (
                    filteredLogGroups.length === 0 ? (
                      <div className="p-6 text-center">
                        <FolderOpen size={32} className="mx-auto text-muted-dim mb-3" />
                        <p className="text-muted-dim text-sm">暂无会话分组</p>
                      </div>
                    ) : (
                      filteredLogGroups.map((group) => {
                        const isExpanded = expandedGroups.has(group.session_name);
                        return (
                          <motion.div
                            key={group.session_name}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            className="mb-2"
                          >
                            <div
                              className="flex items-center justify-between p-2.5 bg-ink-800/30 rounded-lg cursor-pointer hover:bg-ink-800/50 transition-colors"
                              onClick={() => toggleGroup(group.session_name)}
                            >
                              <div className="flex items-center gap-1.5">
                                <button className="p-0.5">
                                  {isExpanded ? (
                                    <ChevronDown size={12} className="text-neon-cyan" />
                                  ) : (
                                    <ChevronRightIcon size={12} className="text-muted-dim" />
                                  )}
                                </button>
                                {isExpanded ? (
                                  <FolderOpen size={12} className="text-neon-cyan" />
                                ) : (
                                  <Folder size={12} className="text-muted-dim" />
                                )}
                                <span className="font-mono text-xs text-gray-200">{group.session_name}</span>
                                <span className="text-xs text-muted-dim">({group.total_files})</span>
                              </div>
                              <button
                                onClick={(e) => { e.stopPropagation(); setConfirmDelete({ type: "session", name: group.session_name }); }}
                                className="p-1 rounded hover:bg-ink-700/40 text-muted hover:text-neon-rose transition-colors"
                                title="删除会话所有日志"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                            <AnimatePresence>
                              {isExpanded && (
                                <motion.div
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: "auto", opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  transition={{ duration: 0.2 }}
                                  className="overflow-hidden"
                                >
                                  <div className="mt-1.5 pl-4 space-y-1">
                                    {group.files.map((file) => (
                                      <motion.div
                                        key={`${group.session_name}-${file.name}`}
                                        initial={{ opacity: 0, x: -10 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        onClick={() => { viewLogFile(file); setSelectedTask(null); }}
                                        className={`p-2 rounded cursor-pointer transition-all flex items-center justify-between ${
                                          selectedLogFile?.name === file.name ? "bg-neon-cyan/10" : "hover:bg-ink-800/40"
                                        }`}
                                      >
                                        <div className="flex items-center gap-1.5">
                                          <FileText size={10} className={selectedLogFile?.name === file.name ? "text-neon-cyan" : "text-muted-dim"} />
                                          <span className="font-mono text-xs text-gray-300 truncate max-w-[80px]" title={file.name}>
                                            {file.name}
                                          </span>
                                        </div>
                                        <div className="flex items-center gap-1">
                                          <button
                                            onClick={(e) => { e.stopPropagation(); window.open(downloadLogFile(file.name), "_blank"); }}
                                            className="p-0.5 rounded hover:bg-ink-700/40 text-muted hover:text-neon-cyan transition-colors"
                                            title="下载"
                                          >
                                            <Download size={10} />
                                          </button>
                                          <button
                                            onClick={(e) => { e.stopPropagation(); setConfirmDelete({ type: "file", name: file.name }); }}
                                            className="p-0.5 rounded hover:bg-ink-700/40 text-muted hover:text-neon-rose transition-colors"
                                            title="删除"
                                          >
                                            <Trash2 size={10} />
                                          </button>
                                        </div>
                                      </motion.div>
                                    ))}
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </motion.div>
                        );
                      })
                    )
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-3 flex flex-col">
          <AnimatePresence>
            {selectedTask ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="glass-card flex-1 flex flex-col"
              >
                <div className="p-4 border-b border-ink-700/60 flex items-center justify-between">
                  <div>
                    <h3 className="font-mono text-gray-100">{selectedTask.name}</h3>
                    <p className="text-xs text-muted-dim">{selectedTask.command}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {(selectedTask.status.includes("running") || selectedTask.status.includes("detached")) && (
                      <>
                        <button
                          onClick={() => setTerminalMode(!terminalMode)}
                          className={`btn-ghost flex items-center gap-1 ${terminalMode ? "text-neon-cyan bg-neon-cyan/10" : ""}`}
                        >
                          <Monitor size={14} /> {terminalMode ? "日志模式" : "终端模式"}
                        </button>
                        <button onClick={() => handleStop(selectedTask)} className="btn-amber">
                          <Square size={14} /> 终止
                        </button>
                      </>
                    )}
                    <button
                      onClick={saveLogs}
                      disabled={logs.length === 0}
                      className={`btn-ghost flex items-center gap-1 ${logs.length === 0 ? "text-muted-dim cursor-not-allowed" : ""}`}
                      title="手动保存日志"
                    >
                      <Save size={14} /> 保存日志
                    </button>
                  </div>
                </div>

                {!terminalMode && currentProgress !== null && (
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

                {terminalMode ? (
                  <div className="flex-1 overflow-hidden">
                    <TerminalComponent
                      sessionName={selectedTask.name}
                      onClose={() => setTerminalMode(false)}
                    />
                  </div>
                ) : (
                  <>
                    <div className="flex-1 p-4 overflow-y-auto font-mono text-sm" ref={logsEndRef}>
                      {logs.length === 0 && (
                        <div className="text-center text-muted-dim py-8">等待日志...</div>
                      )}
                      {logs.map((log, idx) => (
                        <div key={idx} className={`break-all leading-relaxed ${
                          log.isInput ? "text-neon-amber" : levelColor(log.level)
                        }`}>
                          {log.isInput ? ">" : levelIcon(log.level)}{log.text}
                        </div>
                      ))}
                    </div>

                    {(selectedTask.status.includes("running") || selectedTask.status.includes("detached")) && (
                      <div className="p-4 border-t border-ink-700/60">
                        <div className="flex items-center gap-3 bg-ink-900/60 rounded-lg px-4 py-2">
                          <span className="text-neon-cyan font-mono text-sm">{'>'}</span>
                          <input
                            type="text"
                            value={inputCommand}
                            onChange={(e) => setInputCommand(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && sendCommand()}
                            className="flex-1 bg-transparent outline-none text-gray-200 font-mono text-sm"
                            placeholder="输入命令并回车..."
                            autoFocus
                          />
                          <button
                            onClick={sendCommand}
                            disabled={!inputCommand.trim()}
                            className={`p-2 rounded-lg transition-all ${
                              inputCommand.trim() 
                                ? "text-neon-cyan hover:bg-ink-800" 
                                : "text-muted-dim cursor-not-allowed"
                            }`}
                          >
                            <Send size={16} />
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="p-4 border-t border-ink-700/60 bg-ink-900/30">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={toggleAutoSave}
                              className={`p-2 rounded-lg transition-colors ${
                                autoSaveEnabled ? "bg-neon-green/20 text-neon-green" : "bg-ink-800/30 text-muted"
                              }`}
                              title={autoSaveEnabled ? "关闭定时保存" : "开启定时保存"}
                            >
                              {autoSaveEnabled ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                            </button>
                            <span className={`text-sm ${autoSaveEnabled ? "text-neon-green" : "text-muted-dim"}`}>
                              {autoSaveEnabled ? "定时保存已开启" : "定时保存已关闭"}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-2">
                            <Clock size={14} className="text-muted-dim" />
                            <input
                              type="number"
                              value={autoSaveInterval}
                              onChange={(e) => setAutoSaveInterval(Math.max(30, Math.min(3600, Number(e.target.value))))}
                              min={30}
                              max={3600}
                              className="w-20 bg-ink-800/30 border border-ink-700/60 rounded px-2 py-1 text-xs font-mono text-gray-300 outline-none focus:border-neon-cyan/50"
                              placeholder="间隔(秒)"
                            />
                            <span className="text-xs text-muted-dim">秒</span>
                          </div>
                          {lastSaveTime && (
                            <span className="text-xs text-muted-dim">
                              上次保存: {lastSaveTime}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </motion.div>
            ) : selectedLogFile ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="glass-card flex-1 flex flex-col"
              >
                <div className="p-4 border-b border-ink-700/60 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <FileText size={20} className="text-neon-cyan" />
                    <div>
                      <h3 className="font-mono text-gray-100">{selectedLogFile.name}</h3>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-muted-dim">{formatFileSize(selectedLogFile.size)}</span>
                        <span className="text-xs text-muted-dim">·</span>
                        <span className="text-xs text-muted-dim">{new Date(selectedLogFile.modified_at).toLocaleString()}</span>
                        {selectedLogFile.session_name && (
                          <>
                            <span className="text-xs text-muted-dim">·</span>
                            <span className="text-xs text-neon-cyan/70 bg-neon-cyan/10 px-2 py-0.5 rounded">
                              {selectedLogFile.session_name}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => viewLogFile(selectedLogFile)} className="btn-ghost flex items-center gap-1">
                      <RefreshCw size={14} /> 刷新
                    </button>
                    <button onClick={() => window.open(downloadLogFile(selectedLogFile.name), "_blank")} className="btn-primary flex items-center gap-1">
                      <Download size={14} /> 下载
                    </button>
                    <button onClick={() => { setSelectedLogFile(null); setLogFileContent(""); }} className="btn-ghost flex items-center gap-1">
                      返回列表
                    </button>
                  </div>
                </div>

                <div className="flex-1 p-4 overflow-y-auto font-mono text-sm text-gray-300 whitespace-pre-wrap bg-ink-950/50">
                  {logFileContent}
                </div>
              </motion.div>
            ) : (
              <div className="glass-card h-full flex items-center justify-center text-center">
                <div>
                  <Terminal size={48} className="text-muted-dim mx-auto mb-3" />
                  <p className="text-muted-dim font-mono">选择一个会话或日志文件查看</p>
                  <p className="text-xs text-muted-dim mt-2">实时日志会在此显示</p>
                </div>
              </div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <AnimatePresence>
        {confirmDelete && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
            onClick={() => setConfirmDelete(null)}
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              className="glass-card p-6 max-w-md w-full mx-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 mb-4">
                <AlertCircle size={24} className="text-neon-amber" />
                <h3 className="text-lg font-bold text-gray-100">确认删除</h3>
              </div>
              <p className="text-gray-300 mb-6">
                {confirmDelete.type === "file"
                  ? `确定要删除日志文件 "${confirmDelete.name}" 吗？此操作无法撤销。`
                  : `确定要删除会话 "${confirmDelete.name}" 的所有日志文件吗？此操作无法撤销。`}
              </p>
              <div className="flex items-center justify-end gap-3">
                <button onClick={() => setConfirmDelete(null)} className="btn-ghost">
                  取消
                </button>
                <button
                  onClick={() => confirmDelete.type === "file" ? handleDeleteLogFile(confirmDelete.name) : handleDeleteSessionLogs(confirmDelete.name)}
                  className="btn-danger"
                >
                  删除
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}