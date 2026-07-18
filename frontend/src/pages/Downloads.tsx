import { useState, useEffect } from "react";
import { Download, Play, RotateCcw, Trash2, Eye, X, RefreshCw, ArrowDownToLine, Code2, Globe, FileText, Send, Terminal } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import PageHeader from "../components/PageHeader";
import ProgressBar from "../components/ProgressBar";
import LogStream from "../components/LogStream";
import { listDownloads, createDownload, retryDownload, deleteDownload, type DownloadTask } from "../lib/api";
import { listScripts, executeScript, type Script } from "../lib/api";

interface LogLine {
  text: string;
  level?: string;
  ts: number;
}

function useDownloadWebSocket(taskId: number | null): { logs: LogLine[]; connected: boolean } {
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!taskId) {
      setLogs([]);
      setConnected(false);
      return;
    }

    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${window.location.host}/api/downloads/ws/${taskId}`);
    setConnected(true);

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "log" && msg.payload?.log_line) {
          setLogs((prev) => [...prev, { text: msg.payload.log_line, level: msg.payload.level, ts: Date.now() }]);
        }
      } catch {
        // ignore
      }
    };

    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);

    return () => {
      ws.close();
      setConnected(false);
    };
  }, [taskId]);

  return { logs, connected };
}

export default function Downloads() {
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const [scripts, setScripts] = useState<Script[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedTask, setSelectedTask] = useState<DownloadTask | null>(null);
  
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [selectedScriptId, setSelectedScriptId] = useState<number | null>(null);
  const [scriptFormat, setScriptFormat] = useState("");
  const [outputFormat, setOutputFormat] = useState("");
  const [pushFormat, setPushFormat] = useState("");
  const [customCommand, setCustomCommand] = useState("");

  const { logs, connected } = useDownloadWebSocket(selectedTask?.id || null);

  const load = async () => {
    setLoading(true);
    try {
      const [ts, ss] = await Promise.all([listDownloads(), listScripts()]);
      setTasks(Array.isArray(ts) ? ts : []);
      setScripts(Array.isArray(ss) ? ss : []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (selectedScriptId && websiteUrl) {
      const script = scripts.find((s) => s.id === selectedScriptId);
      if (script) {
        setScriptFormat(`python scripts/${script.filename} "${websiteUrl}"`);
        setOutputFormat(`{
  "success": true,
  "data": [],
  "message": "任务完成"
}`);
        setPushFormat(`{
  "url": "${websiteUrl}",
  "status": "success",
  "result": "..."
}`);
      }
    }
  }, [selectedScriptId, websiteUrl, scripts]);

  const handleAddDownload = async () => {
    if (!websiteUrl.trim()) {
      alert("请输入网站地址");
      return;
    }
    if (!selectedScriptId) {
      alert("请选择脚本");
      return;
    }
    
    const cmd = customCommand.trim() || scriptFormat;
    
    try {
      if (cmd) {
        await createDownload(websiteUrl.trim(), "", selectedScriptId, cmd);
      } else {
        await executeScript(selectedScriptId, websiteUrl.trim());
      }
      setWebsiteUrl("");
      setSelectedScriptId(null);
      setScriptFormat("");
      setOutputFormat("");
      setPushFormat("");
      setCustomCommand("");
      await load();
      alert("脚本已启动，可以在任务台查看实时日志");
    } catch (e: any) {
      alert(e?.response?.data?.detail || "创建失败");
    }
  };

  const handleRetry = async (task: DownloadTask) => {
    try {
      await retryDownload(task.id);
      await load();
      if (selectedTask?.id === task.id) {
        setSelectedTask(null);
      }
    } catch (e: any) {
      alert(e?.response?.data?.detail || "重试失败");
    }
  };

  const handleDelete = async (task: DownloadTask) => {
    if (!confirm("确认删除此下载任务？")) return;
    try {
      await deleteDownload(task.id);
      await load();
      if (selectedTask?.id === task.id) {
        setSelectedTask(null);
      }
    } catch (e: any) {
      alert(e?.response?.data?.detail || "删除失败");
    }
  };

  const statusColor = (status: string) => {
    switch (status) {
      case "running": return "text-neon-cyan";
      case "success": return "text-neon-green";
      case "failed": return "text-neon-rose";
      case "retrying": return "text-neon-amber";
      default: return "text-muted";
    }
  };

  const statusDot = (status: string) => {
    switch (status) {
      case "running": return "dot-running";
      case "success": return "dot-success";
      case "failed": return "dot-failed";
      case "retrying": return "dot-running";
      default: return "dot-pending";
    }
  };

  const getScriptName = (id: number | null) => {
    if (!id) return "-";
    const script = scripts.find((s) => s.id === id);
    return script ? script.name : "-";
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="下载管理"
        subtitle="管理视频下载任务，实时监控进度，自动重试失败任务"
        icon={<Download size={20} />}
        actions={
          <button onClick={load} className="btn-ghost flex items-center gap-1">
            <RefreshCw size={14} /> 刷新
          </button>
        }
      />

      <div className="glass-card p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="flex items-center gap-2 text-xs font-mono text-muted-dim">
              <Globe size={12} /> 输入内容
            </label>
            <input
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              className="input-cyber mt-1"
              placeholder="输入网址或其他参数"
            />
          </div>
          <div>
            <label className="flex items-center gap-2 text-xs font-mono text-muted-dim">
              <Code2 size={12} /> 脚本选择
            </label>
            <select
              value={selectedScriptId || ""}
              onChange={(e) => setSelectedScriptId(e.target.value ? Number(e.target.value) : null)}
              className="input-cyber mt-1 w-full"
            >
              <option value="">请选择脚本</option>
              {scripts.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="flex items-center gap-2 text-xs font-mono text-muted-dim">
              <Terminal size={12} /> 脚本格式
            </label>
            <input
              value={scriptFormat}
              onChange={(e) => setScriptFormat(e.target.value)}
              className="input-cyber mt-1 font-mono text-xs"
              placeholder="python script.py url"
            />
          </div>
          <div className="flex items-end">
            <button onClick={handleAddDownload} className="btn-neon flex items-center gap-2 w-full">
              <Play size={14} /> 执行脚本
            </button>
          </div>
        </div>
        
        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="flex items-center gap-2 text-xs font-mono text-muted-dim">
              <FileText size={12} /> 脚本输出格式
            </label>
            <textarea
              value={outputFormat}
              onChange={(e) => setOutputFormat(e.target.value)}
              rows={4}
              className="input-cyber mt-1 font-mono text-xs resize-y"
              placeholder="脚本执行后的输出格式"
            />
          </div>
          <div>
            <label className="flex items-center gap-2 text-xs font-mono text-muted-dim">
              <Send size={12} /> 容器推送格式
            </label>
            <textarea
              value={pushFormat}
              onChange={(e) => setPushFormat(e.target.value)}
              rows={4}
              className="input-cyber mt-1 font-mono text-xs resize-y"
              placeholder="Axios请求发送的格式"
            />
          </div>
          <div>
            <label className="flex items-center gap-2 text-xs font-mono text-muted-dim">
              <Terminal size={12} /> 自定义指令（覆盖）
            </label>
            <textarea
              value={customCommand}
              onChange={(e) => setCustomCommand(e.target.value)}
              rows={4}
              className="input-cyber mt-1 font-mono text-xs resize-y"
              placeholder="留空则使用脚本格式"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="glass-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-mono text-muted-dim uppercase tracking-wider border-b border-ink-700/60">
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3">脚本</th>
                <th className="px-4 py-3">项目状态</th>
                <th className="px-4 py-3">进度</th>
                <th className="px-4 py-3">速度</th>
                <th className="px-4 py-3">重试</th>
                <th className="px-4 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-muted-dim font-mono">加载中...</td>
                </tr>
              )}
              {!loading && tasks.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-muted-dim font-mono">
                    暂无下载任务，在上方配置后执行
                  </td>
                </tr>
              )}
              {tasks.map((task) => (
                <motion.tr
                  key={task.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  onClick={() => setSelectedTask(task)}
                  className={`border-b border-ink-800/40 hover:bg-ink-800/30 cursor-pointer transition-colors ${
                    selectedTask?.id === task.id ? "bg-ink-800/40" : ""
                  }`}
                >
                  <td className="px-4 py-3">
                    <span className={`dot ${statusDot(task.status)}`} />
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-neon-cyan text-xs font-mono">
                      {getScriptName((task as any).script_id)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-100 truncate" title={task.video_url || ""}>
                      {task.video_url?.slice(0, 50) + "..."}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-xs font-mono ${statusColor(task.status)}`}>
                        {task.status}
                      </span>
                      {task.progress > 0 && (
                        <span className="text-xs text-muted-dim font-mono">
                          {task.progress}%
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-24 h-1.5 bg-ink-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all ${
                            task.status === "running" ? "bg-neon-cyan" :
                            task.status === "success" ? "bg-neon-green" :
                            task.status === "failed" ? "bg-neon-rose" : "bg-muted-dim"
                          }`}
                          style={{ width: `${task.progress}%` }}
                        />
                      </div>
                      <span className={`text-xs font-mono ${statusColor(task.status)}`}>
                        {task.progress}%
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-dim text-xs font-mono">
                    {task.speed || "-"}
                  </td>
                  <td className="px-4 py-3 text-muted-dim text-xs font-mono">
                    {task.retry_count}/{task.max_retries}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); setSelectedTask(task); }}
                        title="查看详情"
                        className="p-1.5 rounded text-muted hover:text-neon-cyan hover:bg-ink-800/60 transition-all"
                      >
                        <Eye size={15} />
                      </button>
                      {(task.status === "failed" || task.status === "retrying") && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleRetry(task); }}
                          title="重试"
                          className="p-1.5 rounded text-muted hover:text-neon-amber hover:bg-ink-800/60 transition-all"
                        >
                          <RotateCcw size={15} />
                        </button>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(task); }}
                        title="删除"
                        className="p-1.5 rounded text-muted hover:text-neon-rose hover:bg-ink-800/60 transition-all"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>

        <AnimatePresence>
          {selectedTask ? (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="glass-card p-5 flex flex-col"
            >
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`dot ${statusDot(selectedTask.status)}`} />
                    <span className={`font-mono text-sm ${statusColor(selectedTask.status)}`}>
                      {selectedTask.status}
                    </span>
                    {selectedTask.retry_count > 0 && (
                      <span className="text-xs font-mono text-neon-amber">
                        (重试 {selectedTask.retry_count}/{selectedTask.max_retries})
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <Code2 size={12} className="text-neon-cyan" />
                    <span className="text-xs font-mono text-neon-cyan">
                      {getScriptName((selectedTask as any).script_id)}
                    </span>
                  </div>
                  <h3 className="mt-1 font-bold text-gray-100 truncate" title={selectedTask.video_url || ""}>
                    {selectedTask.video_url || "-"}
                  </h3>
                  {selectedTask.command && (
                    <div className="mt-1 text-xs font-mono text-neon-amber truncate">
                      {selectedTask.command}
                    </div>
                  )}
                </div>
                <button onClick={() => setSelectedTask(null)} className="btn-ghost">
                  <X size={18} />
                </button>
              </div>

              <div className="mb-4">
                <div className="flex items-center justify-between text-xs font-mono mb-2">
                  <span className="text-neon-cyan">执行进度</span>
                  <span className="text-muted-dim">{selectedTask.speed || "N/A"} | ETA {selectedTask.eta || "--:--"}</span>
                </div>
                <ProgressBar
                  completed={selectedTask.progress}
                  total={selectedTask.total_bytes > 0 ? selectedTask.total_bytes : null}
                  current={selectedTask.video_url}
                />
              </div>

              <div className="flex-1">
                <LogStream logs={logs} connected={connected} height="320px" />
              </div>

              <div className="mt-4 flex items-center gap-2">
                {(selectedTask.status === "failed" || selectedTask.status === "retrying") && (
                  <button onClick={() => handleRetry(selectedTask)} className="btn-amber flex items-center gap-2">
                    <RotateCcw size={14} /> 重新执行
                  </button>
                )}
                <button onClick={() => handleDelete(selectedTask)} className="btn-danger">
                  <Trash2 size={14} /> 删除
                </button>
              </div>
            </motion.div>
          ) : (
            <div className="glass-card p-5 flex flex-col items-center justify-center text-center">
              <Download size={48} className="text-muted-dim mb-3" />
              <p className="text-muted-dim font-mono">选择一个任务查看详情</p>
              <p className="text-xs text-muted-dim mt-2">实时日志、进度、速度都会在此显示</p>
            </div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
