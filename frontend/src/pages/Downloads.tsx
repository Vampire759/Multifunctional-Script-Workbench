import { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { Download, Play, RotateCcw, Trash2, Eye, X, RefreshCw, ArrowDownToLine, Code2, Globe, FileText, Send, Terminal, Save, FolderOpen, Trash, ChevronRight, Zap, Pause, ExternalLink, Plus, Settings, ChevronDown, ChevronUp, Menu, LogOut } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import PageHeader from "../components/PageHeader";
import ProgressBar from "../components/ProgressBar";
import LogStream from "../components/LogStream";
import { listDownloads, createDownload, retryDownload, deleteDownload, type DownloadTask, type DownloadTemplate, listDownloadTemplates, createDownloadTemplate, updateDownloadTemplate, deleteDownloadTemplate, startDockerPush, stopDockerPush, getDockerPushStatus, rePushDocker } from "../lib/api";
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
          setLogs((prev) => [...prev.slice(-1000), { text: msg.payload.log_line, level: msg.payload.level, ts: Date.now() }]);
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
  const { id: taskId } = useParams<{ id: string }>();
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const [scripts, setScripts] = useState<Script[]>([]);
  const [templates, setTemplates] = useState<DownloadTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedTask, setSelectedTask] = useState<DownloadTask | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<DownloadTemplate | null>(null);
  
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [taskName, setTaskName] = useState("");
  const [selectedScriptId, setSelectedScriptId] = useState<number | null>(null);
  const [scriptFormat, setScriptFormat] = useState("");
  const [outputFormat, setOutputFormat] = useState("");
  const [pushFormat, setPushFormat] = useState("");
  const [customCommand, setCustomCommand] = useState("");
  const [showSaveTemplateModal, setShowSaveTemplateModal] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [templateDescription, setTemplateDescription] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [dockerPushRunning, setDockerPushRunning] = useState(false);
  const [dockerPushLogs, setDockerPushLogs] = useState<LogLine[]>([]);
  const [dockerPushConnected, setDockerPushConnected] = useState(false);
  const [dockerPushCommand, setDockerPushCommand] = useState("docker build -t myapp . && docker push myapp:latest");
  const [isPushing, setIsPushing] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const dockerLogsEndRef = useRef<HTMLDivElement>(null);

  const { logs, connected } = useDownloadWebSocket(selectedTask?.id || null);

  function useDockerPushWebSocket(): { logs: LogLine[]; connected: boolean } {
    const [logs, setLogs] = useState<LogLine[]>([]);
    const [connected, setConnected] = useState(false);

    useEffect(() => {
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${window.location.host}/api/docker-push/ws`);
      setConnected(true);

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === "log" && msg.payload?.log_line) {
            setLogs((prev) => [...prev.slice(-1000), { text: msg.payload.log_line, level: msg.payload.level, ts: Date.now() }]);
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
    }, []);

    return { logs, connected };
  }

  const { logs: dockerLogs, connected: dockerWsConnected } = useDockerPushWebSocket();

  useEffect(() => {
    setDockerPushLogs(dockerLogs);
    setDockerPushConnected(dockerWsConnected);
  }, [dockerLogs, dockerWsConnected]);

  useEffect(() => {
    dockerLogsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [dockerPushLogs]);

  useEffect(() => {
    const checkStatus = async () => {
      try {
        const status = await getDockerPushStatus();
        setDockerPushRunning(status.running);
      } catch {
        setDockerPushRunning(false);
      }
    };
    checkStatus();
    const interval = setInterval(checkStatus, 10000);
    return () => clearInterval(interval);
  }, []);

  const loadScriptsAndTemplates = async () => {
    try {
      const [ss, ts2] = await Promise.all([listScripts(), listDownloadTemplates()]);
      setScripts(Array.isArray(ss) ? ss : []);
      setTemplates(Array.isArray(ts2) ? ts2 : []);
    } catch (e) {
      console.error(e);
    }
  };

  const loadTasks = async () => {
    try {
      const ts = await listDownloads();
      const taskList = Array.isArray(ts) ? ts : [];
      setTasks(taskList);
      
      if (taskId && !selectedTask) {
        const numericId = parseInt(taskId, 10);
        const task = taskList.find((t) => t.id === numericId);
        if (task) {
          setSelectedTask(task);
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    setLoading(true);
    loadScriptsAndTemplates();
    loadTasks().finally(() => setLoading(false));
    const t = setInterval(loadTasks, 10000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const handleTemplateSelect = (template: DownloadTemplate) => {
    setSelectedTemplate(template);
    setSelectedScriptId(template.script_id);
    setScriptFormat(template.command_format);
    setOutputFormat(template.output_format);
    setPushFormat(template.push_format);
    setCustomCommand(template.custom_command || "");
    setSelectedTask(null);
  };

  const getScriptName = (id: number | null) => {
    if (!id) return "-";
    const script = scripts.find((s) => s.id === id);
    return script ? script.name : "-";
  };

  const handleSend = async () => {
    if (!websiteUrl.trim()) {
      alert("请输入网站地址");
      return;
    }
    if (!selectedScriptId || selectedScriptId < 0) {
      alert("请选择脚本");
      return;
    }

    setIsSending(true);
    try {
      const url = websiteUrl.trim();
      let cmd = customCommand.trim() || scriptFormat;
      cmd = cmd.replace(/{url}/g, url);
      const name = taskName.trim() || url.substring(0, 50);
      const result = await createDownload(url, "", selectedScriptId, cmd, "", "", name);
      if (result && result.data && result.data.task_id) {
        await loadTasks();
      }
      setWebsiteUrl("");
      setTaskName("");
    } catch (e: any) {
      alert(e?.response?.data?.detail || "发送失败");
    } finally {
      setIsSending(false);
    }
  };

  const handleSaveTemplate = async () => {
    if (!templateName.trim()) {
      alert("请输入模板名称");
      return;
    }
    if (!selectedScriptId || selectedScriptId < 0) {
      alert("请先选择脚本并配置格式");
      return;
    }

    try {
      if (selectedTemplate) {
        await updateDownloadTemplate(selectedTemplate.id, {
          name: templateName.trim(),
          script_id: selectedScriptId,
          command_format: scriptFormat,
          output_format: outputFormat,
          push_format: pushFormat,
          custom_command: customCommand,
          description: templateDescription.trim(),
        });
        alert("模板已更新");
      } else {
        await createDownloadTemplate({
          name: templateName.trim(),
          script_id: selectedScriptId,
          command_format: scriptFormat,
          output_format: outputFormat,
          push_format: pushFormat,
          custom_command: customCommand,
          description: templateDescription.trim(),
        });
        alert("模板已保存");
      }
      setTemplateName("");
      setTemplateDescription("");
      setShowSaveTemplateModal(false);
      await loadScriptsAndTemplates();
    } catch (e: any) {
      alert(e?.response?.data?.detail || "保存失败");
    }
  };

  const handleDeleteTemplate = async (templateId: number) => {
    if (!confirm("确认删除此模板？")) return;
    try {
      await deleteDownloadTemplate(templateId);
      if (selectedTemplate?.id === templateId) {
        setSelectedTemplate(null);
      }
      await loadScriptsAndTemplates();
    } catch (e: any) {
      alert(e?.response?.data?.detail || "删除失败");
    }
  };

  const handleDeleteTask = async (taskId: number) => {
    if (!confirm("确认删除此任务？")) return;
    try {
      await deleteDownload(taskId);
      if (selectedTask?.id === taskId) {
        setSelectedTask(null);
      }
      await loadTasks();
    } catch (e: any) {
      alert(e?.response?.data?.detail || "删除失败");
    }
  };

  const handleScriptChange = (scriptId: number | null) => {
    setSelectedScriptId(scriptId);
    setSelectedTemplate(null);
    if (scriptId && scriptId > 0) {
      const script = scripts.find((s) => s.id === scriptId);
      if (script) {
        const scriptName = script.filename || script.name;
        if (!scriptName.endsWith(".py")) {
          setScriptFormat(`python scripts/${scriptName}.py {url}`);
        } else {
          setScriptFormat(`python scripts/${scriptName} {url}`);
        }
      }
    } else {
      setScriptFormat("");
    }
  };

  const handleDockerPushStart = async () => {
    setIsPushing(true);
    try {
      await startDockerPush(dockerPushCommand.trim());
      setDockerPushRunning(true);
      alert("Docker推送已启动");
    } catch (e: any) {
      alert(e?.response?.data?.detail || "启动失败");
    } finally {
      setIsPushing(false);
    }
  };

  const handleDockerPushStop = async () => {
    try {
      await stopDockerPush();
      setDockerPushRunning(false);
      alert("Docker推送已停止");
    } catch (e: any) {
      alert(e?.response?.data?.detail || "停止失败");
    }
  };

  const handleDockerRePush = async () => {
    setIsPushing(true);
    try {
      await rePushDocker(dockerPushCommand.trim());
      alert("重新推送命令已发送");
    } catch (e: any) {
      alert(e?.response?.data?.detail || "发送失败");
    } finally {
      setIsPushing(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="下载管理"
        subtitle={selectedTemplate ? `当前模板: ${selectedTemplate.name}` : "选择模板或脚本"}
        icon={<Download size={20} />}
        actions={
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="btn-ghost flex items-center gap-1"
            >
              <Menu size={14} />
            </button>
            <button onClick={async () => { await loadTasks(); await loadScriptsAndTemplates(); }} className="btn-ghost flex items-center gap-1">
              <RefreshCw size={14} /> 刷新
            </button>
          </div>
        }
      />

      <div className="flex-1 flex min-h-0">
        <div className={`${sidebarCollapsed ? "w-12" : "w-64"} flex-shrink-0 border-r border-ink-800/60 flex flex-col min-h-0 transition-all duration-300`}>
          <div className={`p-3 border-b border-ink-800/60 flex items-center justify-between ${sidebarCollapsed ? "justify-center" : ""}`}>
            {!sidebarCollapsed && (
              <span className="text-xs font-mono text-muted-dim flex items-center gap-1">
                <FolderOpen size={12} /> 任务模板
              </span>
            )}
            <button
              onClick={() => {
                setSelectedTemplate(null);
                setTemplateName("");
                setTemplateDescription("");
                setShowSaveTemplateModal(true);
              }}
              className="p-1 rounded text-muted hover:text-neon-cyan hover:bg-ink-700/40 transition-all"
              title="新建模板"
            >
              <Plus size={14} />
            </button>
          </div>

          {!sidebarCollapsed && (
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {templates.length === 0 ? (
                <div className="text-center py-8">
                  <FolderOpen size={24} className="text-muted-dim mx-auto mb-2" />
                  <p className="text-xs font-mono text-muted-dim">暂无模板</p>
                  <p className="text-[10px] font-mono text-muted-dim mt-1">点击右上角+创建</p>
                </div>
              ) : (
                templates.map((t) => (
                  <motion.div
                    key={t.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    onClick={() => handleTemplateSelect(t)}
                    className={`relative p-3 rounded-lg cursor-pointer transition-all group ${
                      selectedTemplate?.id === t.id
                        ? "bg-neon-cyan/10 border border-neon-cyan/30"
                        : "bg-ink-800/40 border border-transparent hover:border-ink-700/60"
                    }`}
                  >
                    <div className="font-medium text-gray-100 text-sm truncate" title={t.name}>
                      {t.name}
                    </div>
                    <div className="text-xs font-mono text-muted-dim truncate" title={getScriptName(t.script_id)}>
                      {getScriptName(t.script_id)}
                    </div>
                    {t.command_format && (
                      <div className="text-[10px] font-mono text-neon-amber mt-1 truncate">
                        {t.command_format.slice(0, 40)}...
                      </div>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteTemplate(t.id); }}
                      className="absolute top-2 right-2 p-1 rounded text-muted opacity-0 group-hover:opacity-100 hover:text-neon-rose transition-all"
                    >
                      <Trash size={12} />
                    </button>
                  </motion.div>
                ))
              )}
            </div>
          )}
        </div>

        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 overflow-y-auto p-4">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="space-y-4 lg:col-span-1">
                <div className="glass-card p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-bold text-gray-100 flex items-center gap-2">
                      <Globe size={14} className="text-neon-cyan" /> 下载配置
                    </h3>
                    <button
                      onClick={() => {
                        if (selectedTemplate) {
                          setTemplateName(selectedTemplate.name);
                          setTemplateDescription(selectedTemplate.description);
                        }
                        setShowSaveTemplateModal(true);
                      }}
                      className="btn-ghost flex items-center gap-1 text-xs"
                      title="保存当前配置为模板"
                    >
                      <Save size={14} /> {selectedTemplate ? "编辑模板" : "保存模板"}
                    </button>
                  </div>
                  
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-mono text-muted-dim mb-1">任务名称</label>
                      <input
                        value={taskName}
                        onChange={(e) => setTaskName(e.target.value)}
                        className="input-cyber w-full"
                        placeholder="为任务命名"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-mono text-muted-dim mb-1">网站地址 *</label>
                      <input
                        value={websiteUrl}
                        onChange={(e) => setWebsiteUrl(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleSend()}
                        className="input-cyber w-full"
                        placeholder="https://example.com"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-mono text-muted-dim mb-1">脚本 *</label>
                      <select
                        value={selectedScriptId && selectedScriptId > 0 ? selectedScriptId : ""}
                        onChange={(e) => handleScriptChange(e.target.value ? Number(e.target.value) : null)}
                        className="input-cyber w-full"
                      >
                        <option value="">选择脚本</option>
                        {scripts.filter(s => s.id > 0).map((s) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-mono text-muted-dim mb-1">脚本格式</label>
                      <textarea
                        value={scriptFormat}
                        onChange={(e) => setScriptFormat(e.target.value)}
                        rows={2}
                        className="input-cyber w-full text-xs font-mono resize-y"
                        placeholder="python scripts/example.py {url}"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-mono text-muted-dim mb-1">自定义命令（覆盖脚本格式）</label>
                      <textarea
                        value={customCommand}
                        onChange={(e) => setCustomCommand(e.target.value)}
                        rows={2}
                        className="input-cyber w-full text-xs font-mono resize-y"
                        placeholder="留空则使用脚本格式"
                      />
                    </div>

                    <button
                      onClick={handleSend}
                      disabled={isSending || !websiteUrl.trim() || !selectedScriptId || selectedScriptId < 0}
                      className="btn-neon w-full flex items-center justify-center gap-2"
                    >
                      {isSending ? (
                        <RefreshCw size={14} className="animate-spin" />
                      ) : (
                        <Send size={14} />
                      )}
                      {isSending ? "发送中..." : "发送执行"}
                    </button>
                  </div>
                </div>

                <div className="glass-card p-4">
                  <h3 className="text-sm font-bold text-gray-100 mb-3 flex items-center gap-2">
                    <Terminal size={14} className="text-neon-purple" /> Docker推送（Screen形式）
                    <span className={`text-[10px] font-mono px-2 py-0.5 rounded ml-auto ${dockerPushRunning ? "bg-neon-green/20 text-neon-green" : "bg-neon-rose/20 text-neon-rose"}`}>
                      {dockerPushRunning ? "RUNNING" : "STOPPED"}
                    </span>
                  </h3>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-mono text-muted-dim mb-1">推送命令</label>
                      <textarea
                        value={dockerPushCommand}
                        onChange={(e) => setDockerPushCommand(e.target.value)}
                        rows={2}
                        className="input-cyber w-full text-xs font-mono resize-y"
                        placeholder='docker build -t myapp . && docker push myapp:latest'
                      />
                    </div>
                    <div className="flex gap-2">
                      {!dockerPushRunning ? (
                        <button
                          onClick={handleDockerPushStart}
                          disabled={isPushing}
                          className="btn-neon flex-1 flex items-center justify-center gap-2"
                        >
                          {isPushing ? (
                            <RefreshCw size={14} className="animate-spin" />
                          ) : (
                            <Play size={14} />
                          )}
                          {isPushing ? "启动中..." : "启动推送"}
                        </button>
                      ) : (
                        <>
                          <button
                            onClick={handleDockerRePush}
                            disabled={isPushing}
                            className="btn-neon flex-1 flex items-center justify-center gap-2"
                          >
                            {isPushing ? (
                              <RefreshCw size={14} className="animate-spin" />
                            ) : (
                              <RotateCcw size={14} />
                            )}
                            {isPushing ? "推送中..." : "重新推送"}
                          </button>
                          <button
                            onClick={handleDockerPushStop}
                            className="btn-ghost px-4"
                          >
                            <Pause size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-4 lg:col-span-2">
                <div className="glass-card p-4">
                  <h3 className="text-sm font-bold text-gray-100 mb-3 flex items-center gap-2">
                    <Download size={14} className="text-neon-green" /> 任务列表
                  </h3>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {loading ? (
                      <div className="text-center py-4">
                        <RefreshCw size={16} className="text-muted-dim animate-spin mx-auto" />
                      </div>
                    ) : tasks.length === 0 ? (
                      <div className="text-center py-4 text-muted-dim text-xs font-mono">
                        暂无任务
                      </div>
                    ) : (
                      tasks.slice(0, 20).map((task) => (
                        <motion.div
                          key={task.id}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          onClick={() => setSelectedTask(task)}
                          className={`p-3 rounded-lg cursor-pointer border transition-all ${
                            selectedTask?.id === task.id
                              ? "border-neon-cyan/50 bg-neon-cyan/10"
                              : "border-ink-700/40 bg-ink-800/30 hover:border-ink-600/60"
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm font-medium text-gray-100 truncate flex-1">
                              {task.name || '未命名任务'}
                            </span>
                            <div className="flex items-center gap-1">
                              <span className={`text-[10px] font-mono px-2 py-0.5 rounded ${
                                task.status === "success" ? "bg-neon-green/20 text-neon-green" :
                                task.status === "failed" ? "bg-neon-rose/20 text-neon-rose" :
                                "bg-neon-amber/20 text-neon-amber"
                              }`}>
                                {task.status}
                              </span>
                              <button
                                onClick={(e) => { e.stopPropagation(); window.open(`/downloads/${task.id}`, "_blank"); }}
                                className="p-1 rounded text-muted hover:text-neon-cyan hover:bg-ink-700/40 transition-all"
                                title="在新标签页打开"
                              >
                                <ExternalLink size={12} />
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleDeleteTask(task.id); }}
                                className="p-1 rounded text-muted hover:text-neon-rose hover:bg-ink-700/40 transition-all"
                                title="删除任务"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 text-xs font-mono text-muted-dim">
                            <span>{task.created_at?.split(' ')[0]}</span>
                            {task.progress !== undefined && (
                              <span>进度: {task.progress}%</span>
                            )}
                          </div>
                        </motion.div>
                      ))
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="glass-card p-4 flex flex-col">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-bold text-gray-100 flex items-center gap-2">
                        <Zap size={14} className="text-neon-cyan" /> 任务日志
                        {selectedTask && (
                          <span className="text-[10px] font-mono text-muted-dim ml-auto truncate max-w-[120px]">
                            {selectedTask.name || '未命名'}
                          </span>
                        )}
                      </h3>
                      <span className={`text-[10px] font-mono px-2 py-0.5 rounded ${connected ? "bg-neon-green/20 text-neon-green" : "bg-neon-rose/20 text-neon-rose"}`}>
                        {connected ? "CONNECTED" : "DISCONNECTED"}
                      </span>
                    </div>
                    <div className="flex-1 overflow-y-auto p-3 font-mono text-xs bg-ink-900/60 rounded-lg">
                      {selectedTask ? (
                        <>
                          {logs.length === 0 ? (
                            <div className="text-center py-4 text-muted-dim">
                              等待日志...
                            </div>
                          ) : (
                            logs.map((log, index) => (
                              <div key={index} className={`mb-1 ${log.level === "error" ? "text-neon-rose" : "text-gray-300"}`}>
                                {log.text}
                              </div>
                            ))
                          )}
                          <div ref={logsEndRef} />
                        </>
                      ) : (
                        <div className="text-center py-4 text-muted-dim">
                          选择任务查看日志
                        </div>
                      )}
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <span className="text-[10px] font-mono text-muted-dim">
                        {logs.length} lines
                      </span>
                    </div>
                  </div>

                  <div className="glass-card p-4 flex flex-col">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-bold text-gray-100 flex items-center gap-2">
                        <Zap size={14} className="text-neon-purple" /> 推送日志
                      </h3>
                      <span className={`text-[10px] font-mono px-2 py-0.5 rounded ${dockerPushConnected ? "bg-neon-green/20 text-neon-green" : "bg-neon-rose/20 text-neon-rose"}`}>
                        {dockerPushConnected ? "CONNECTED" : "DISCONNECTED"}
                      </span>
                    </div>
                    <div className="flex-1 overflow-y-auto p-3 font-mono text-xs bg-ink-900/60 rounded-lg">
                      {dockerPushLogs.length === 0 ? (
                        <div className="text-center py-4 text-muted-dim">
                          {dockerPushRunning ? "等待日志..." : "未启动推送"}
                        </div>
                      ) : (
                        dockerPushLogs.map((log, index) => (
                          <div key={index} className={`mb-1 ${log.level === "error" ? "text-neon-rose" : log.level === "input" ? "text-neon-cyan" : "text-gray-300"}`}>
                            {log.text}
                          </div>
                        ))
                      )}
                      <div ref={dockerLogsEndRef} />
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <span className="text-[10px] font-mono text-muted-dim">
                        {dockerPushLogs.length} lines
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {showSaveTemplateModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
            onClick={() => setShowSaveTemplateModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="glass-card p-6 w-full max-w-md"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-gray-100 flex items-center gap-2">
                  <Save size={18} className="text-neon-cyan" />
                  {selectedTemplate ? "编辑任务模板" : "保存任务模板"}
                </h3>
                <button onClick={() => setShowSaveTemplateModal(false)} className="btn-ghost">
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-mono text-muted-dim mb-1">模板名称 *</label>
                  <input
                    value={templateName}
                    onChange={(e) => setTemplateName(e.target.value)}
                    className="input-cyber w-full"
                    placeholder="输入模板名称"
                  />
                </div>
                <div>
                  <label className="block text-xs font-mono text-muted-dim mb-1">描述（可选）</label>
                  <textarea
                    value={templateDescription}
                    onChange={(e) => setTemplateDescription(e.target.value)}
                    rows={2}
                    className="input-cyber w-full text-xs resize-y"
                    placeholder="模板描述"
                  />
                </div>
                
                <div className="p-3 bg-ink-900/60 rounded-lg border border-ink-700/40">
                  <div className="text-xs font-mono text-muted-dim mb-2">将保存的配置：</div>
                  <div className="space-y-2 text-xs font-mono">
                    <div><span className="text-neon-cyan">脚本:</span> {getScriptName(selectedScriptId)}</div>
                    {scriptFormat && (
                      <div><span className="text-neon-amber">脚本格式:</span> {scriptFormat}</div>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-6 flex items-center justify-end gap-2">
                <button onClick={() => setShowSaveTemplateModal(false)} className="btn-ghost">
                  取消
                </button>
                <button onClick={handleSaveTemplate} className="btn-neon">
                  保存模板
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}