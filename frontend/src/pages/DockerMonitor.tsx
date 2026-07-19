import { useState, useEffect, useRef } from "react";
import { Container, Play, Square, RotateCcw, Pause, PlayCircle, RefreshCw, Eye, ChevronRight, Activity, Server, Database, Image } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import PageHeader from "../components/PageHeader";
import http from "../lib/api";

interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
  ports: string;
  created: string;
}

interface LogLine {
  text: string;
  ts: number;
}

function useDockerWebSocket(containerId: string | null): { logs: LogLine[]; connected: boolean } {
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!containerId) {
      setLogs([]);
      setConnected(false);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      return;
    }

    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${window.location.host}/api/docker/logs/${containerId}`);
    wsRef.current = ws;
    setConnected(true);
    setLogs([]);

    ws.onmessage = (ev) => {
      if (ev.data && ev.data.trim()) {
        setLogs((prev) => [...prev.slice(-1000), { text: ev.data.trim(), ts: Date.now() }]);
      }
    };

    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
    };

    ws.onerror = () => {
      setConnected(false);
      wsRef.current = null;
    };

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setConnected(false);
    };
  }, [containerId]);

  return { logs, connected };
}

export default function DockerMonitor() {
  const [containers, setContainers] = useState<ContainerInfo[]>([]);
  const [selectedContainer, setSelectedContainer] = useState<ContainerInfo | null>(null);
  const [stats, setStats] = useState({
    containers_total: 0,
    containers_running: 0,
    containers_stopped: 0,
    images_total: 0,
  });
  const [loading, setLoading] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const { logs, connected } = useDockerWebSocket(selectedContainer?.id || null);

  const loadContainers = async () => {
    setLoading(true);
    try {
      const [cs, st] = await Promise.all([
        http.get("/docker/containers").then((r) => r.data),
        http.get("/docker/stats").then((r) => r.data),
      ]);
      setContainers(Array.isArray(cs) ? cs : []);
      setStats(st || { containers_total: 0, containers_running: 0, containers_stopped: 0, images_total: 0 });
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadContainers();
    const t = setInterval(loadContainers, 10000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const handleContainerAction = async (containerId: string, action: string) => {
    try {
      await http.post(`/docker/container/${containerId}/${action}`);
      await loadContainers();
    } catch (e: any) {
      alert(e?.response?.data?.detail || "操作失败");
    }
  };

  const handleContainerSelect = (container: ContainerInfo) => {
    setSelectedContainer(container);
  };

  const statusColor = (state: string) => {
    switch (state) {
      case "running": return "text-neon-green";
      case "exited": return "text-neon-rose";
      case "paused": return "text-neon-amber";
      default: return "text-muted";
    }
  };

  const statusBg = (state: string) => {
    switch (state) {
      case "running": return "bg-neon-green/20";
      case "exited": return "bg-neon-rose/20";
      case "paused": return "bg-neon-amber/20";
      default: return "bg-ink-800/60";
    }
  };

  const statusDot = (state: string) => {
    switch (state) {
      case "running": return "dot-running";
      case "exited": return "dot-failed";
      case "paused": return "dot-pending";
      default: return "dot-pending";
    }
  };

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Docker 监控"
        subtitle="监控和管理 Docker 容器，实时查看日志"
        icon={<Container size={20} />}
        actions={
          <button onClick={loadContainers} className="btn-ghost flex items-center gap-1">
            <RefreshCw size={14} /> 刷新
          </button>
        }
      />

      <div className="flex-1 flex min-h-0">
        <div className="w-72 flex-shrink-0 border-r border-ink-800/60 flex flex-col min-h-0">
          <div className="p-3 border-b border-ink-800/60">
            <div className="grid grid-cols-2 gap-2">
              <div className="p-2 bg-ink-800/60 rounded-lg">
                <div className="flex items-center gap-2 mb-1">
                  <Server size={12} className="text-neon-cyan" />
                  <span className="text-[10px] font-mono text-muted-dim">容器</span>
                </div>
                <div className="text-xl font-bold text-gray-100">{stats.containers_total}</div>
              </div>
              <div className="p-2 bg-ink-800/60 rounded-lg">
                <div className="flex items-center gap-2 mb-1">
                  <Image size={12} className="text-neon-purple" />
                  <span className="text-[10px] font-mono text-muted-dim">镜像</span>
                </div>
                <div className="text-xl font-bold text-gray-100">{stats.images_total}</div>
              </div>
              <div className="p-2 bg-neon-green/10 rounded-lg border border-neon-green/30">
                <div className="text-[10px] font-mono text-neon-green mb-1">运行中</div>
                <div className="text-xl font-bold text-neon-green">{stats.containers_running}</div>
              </div>
              <div className="p-2 bg-neon-rose/10 rounded-lg border border-neon-rose/30">
                <div className="text-[10px] font-mono text-neon-rose mb-1">已停止</div>
                <div className="text-xl font-bold text-neon-rose">{stats.containers_stopped}</div>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {loading ? (
              <div className="text-center py-8">
                <RefreshCw size={24} className="text-muted-dim mx-auto mb-2 animate-spin" />
                <p className="text-xs font-mono text-muted-dim">加载中...</p>
              </div>
            ) : containers.length === 0 ? (
              <div className="text-center py-8">
                <Container size={32} className="text-muted-dim mx-auto mb-2" />
                <p className="text-xs font-mono text-muted-dim">暂无容器</p>
              </div>
            ) : (
              <div className="space-y-2">
                {containers.map((container) => (
                  <motion.div
                    key={container.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    onClick={() => handleContainerSelect(container)}
                    className={`relative p-3 rounded-lg cursor-pointer transition-all ${
                      selectedContainer?.id === container.id
                        ? "bg-neon-cyan/10 border border-neon-cyan/30"
                        : "bg-ink-800/40 border border-transparent hover:border-ink-700/60"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`dot ${statusDot(container.state)}`} />
                      <span className={`text-xs font-mono ${statusColor(container.state)}`}>
                        {container.state}
                      </span>
                    </div>
                    <div className="font-medium text-gray-100 text-sm truncate" title={container.name}>
                      {container.name}
                    </div>
                    <div className="text-xs font-mono text-muted-dim truncate" title={container.image}>
                      {container.image}
                    </div>
                    {container.ports && (
                      <div className="text-[10px] font-mono text-neon-amber mt-1">
                        {container.ports.split(',')[0]}
                      </div>
                    )}
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 flex flex-col min-h-0">
          {selectedContainer ? (
            <>
              <div className="p-4 border-b border-ink-800/60">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${statusBg(selectedContainer.state)}`}>
                      <Container size={20} className={statusColor(selectedContainer.state)} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-gray-100">{selectedContainer.name}</h3>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-mono ${statusBg(selectedContainer.state)} ${statusColor(selectedContainer.state)}`}>
                          {selectedContainer.state}
                        </span>
                      </div>
                      <div className="text-xs font-mono text-muted-dim mt-1">
                        ID: {selectedContainer.id} | 镜像: {selectedContainer.image}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {selectedContainer.state === "running" && (
                      <>
                        <button
                          onClick={() => handleContainerAction(selectedContainer.id, "pause")}
                          className="btn-ghost flex items-center gap-1 px-3"
                          title="暂停"
                        >
                          <Pause size={14} /> 暂停
                        </button>
                        <button
                          onClick={() => handleContainerAction(selectedContainer.id, "stop")}
                          className="btn-danger flex items-center gap-1 px-3"
                          title="停止"
                        >
                          <Square size={14} /> 停止
                        </button>
                      </>
                    )}
                    {selectedContainer.state === "exited" && (
                      <button
                        onClick={() => handleContainerAction(selectedContainer.id, "start")}
                        className="btn-neon flex items-center gap-1 px-3"
                        title="启动"
                      >
                        <Play size={14} /> 启动
                      </button>
                    )}
                    {selectedContainer.state === "paused" && (
                      <button
                        onClick={() => handleContainerAction(selectedContainer.id, "unpause")}
                        className="btn-neon flex items-center gap-1 px-3"
                        title="恢复"
                      >
                        <PlayCircle size={14} /> 恢复
                      </button>
                    )}
                    <button
                      onClick={() => handleContainerAction(selectedContainer.id, "restart")}
                      className="btn-amber flex items-center gap-1 px-3"
                      title="重启"
                    >
                      <RotateCcw size={14} /> 重启
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div className="p-2 bg-ink-800/60 rounded-lg">
                    <div className="text-[10px] font-mono text-muted-dim mb-1">状态</div>
                    <div className={`text-sm font-medium ${statusColor(selectedContainer.state)}`}>
                      {selectedContainer.status}
                    </div>
                  </div>
                  <div className="p-2 bg-ink-800/60 rounded-lg">
                    <div className="text-[10px] font-mono text-muted-dim mb-1">端口</div>
                    <div className="text-sm font-medium text-gray-100">
                      {selectedContainer.ports || "-"}
                    </div>
                  </div>
                  <div className="p-2 bg-ink-800/60 rounded-lg">
                    <div className="text-[10px] font-mono text-muted-dim mb-1">创建时间</div>
                    <div className="text-sm font-medium text-gray-100">
                      {selectedContainer.created?.split(' ')[0] || "-"}
                    </div>
                  </div>
                  <div className="p-2 bg-ink-800/60 rounded-lg">
                    <div className="text-[10px] font-mono text-muted-dim mb-1">连接状态</div>
                    <div className={`text-sm font-medium ${connected ? "text-neon-green" : "text-neon-rose"}`}>
                      {connected ? "已连接" : "未连接"}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex-1 p-4 overflow-hidden">
                <div className="glass-card h-full flex flex-col">
                  <div className="flex items-center justify-between p-3 border-b border-ink-700/60">
                    <div className="flex items-center gap-2">
                      <Activity size={14} className="text-neon-cyan" />
                      <span className="text-xs font-mono text-neon-cyan">实时日志</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-mono px-2 py-0.5 rounded ${connected ? "bg-neon-green/20 text-neon-green" : "bg-neon-rose/20 text-neon-rose"}`}>
                        {connected ? "STREAMING" : "DISCONNECTED"}
                      </span>
                      <span className="text-[10px] font-mono text-muted-dim">
                        {logs.length} lines
                      </span>
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4 font-mono text-xs">
                    {logs.length === 0 ? (
                      <div className="text-center py-8 text-muted-dim">
                        暂无日志
                      </div>
                    ) : (
                      logs.map((log, index) => (
                        <div key={index} className="text-gray-300 mb-1">
                          {log.text}
                        </div>
                      ))
                    )}
                    <div ref={logsEndRef} />
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <Container size={48} className="text-muted-dim mx-auto mb-3" />
                <p className="text-muted-dim font-mono">选择一个容器查看详情</p>
                <p className="text-xs text-muted-dim mt-2">实时日志、状态信息都会在此显示</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}