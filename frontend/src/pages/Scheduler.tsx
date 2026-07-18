import { useState, useEffect, useCallback } from "react";
import { Clock, Plus, Trash2, Play, Power, RefreshCw, Calendar, Terminal, Code2, Settings } from "lucide-react";
import { motion } from "framer-motion";
import PageHeader from "../components/PageHeader";
import { listSchedules, createSchedule, updateSchedule, deleteSchedule, triggerSchedule, listTasks, listScreens, listLocalScreens, listScripts, type Schedule, type Task, type ScreenTask, type Script } from "../lib/api";

const cronPresets = [
  { label: "每分钟", value: "* * * * *" },
  { label: "每 5 分钟", value: "*/5 * * * *" },
  { label: "每小时", value: "0 * * * *" },
  { label: "每天 00:00", value: "0 0 * * *" },
  { label: "每天 02:00", value: "0 2 * * *" },
  { label: "每周一 09:00", value: "0 9 * * 1" },
];

const targetTypes = [
  { value: "task", label: "任务", icon: Settings },
  { value: "screen", label: "Screen会话", icon: Terminal },
  { value: "script", label: "脚本", icon: Code2 },
];

export default function Scheduler() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [screens, setScreens] = useState<ScreenTask[]>([]);
  const [scripts, setScripts] = useState<Script[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ 
    name: "", 
    cron_expr: "0 * * * *", 
    target_type: "task" as "task" | "screen" | "script",
    target_id: 0,
    screen_name: "",
    script_id: 0,
    command: "",
    enabled: true 
  });

  const load = async () => {
    setLoading(true);
    try {
      const [s, t, sc, scr, ls] = await Promise.all([
        listSchedules(), 
        listTasks(), 
        listScreens(), 
        listScripts(),
        listLocalScreens()
      ]);
      setSchedules(s);
      setTasks(t);
      setScripts(scr);
      
      const containerScreens = sc.map((screen) => ({ ...screen, source: "container" }));
      const localScreens = (ls.success && ls.data ? ls.data : []).map((screen) => ({ ...screen, source: "local" }));
      const allScreens: (ScreenTask & { source?: string })[] = [...containerScreens, ...localScreens];
      setScreens(allScreens as ScreenTask[]);
      
      if (t.length > 0 && form.target_type === "task" && form.target_id === 0) {
        setForm((f) => ({ ...f, target_id: t[0].id }));
      }
      if (allScreens.length > 0 && form.target_type === "screen" && !form.screen_name) {
        setForm((f) => ({ ...f, screen_name: allScreens[0].name }));
      }
      if (scr.length > 0 && form.target_type === "script" && form.script_id === 0) {
        setForm((f) => ({ ...f, script_id: scr[0].id }));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleCreate = useCallback(async () => {
    if (!form.name || !form.cron_expr) {
      alert("请填写名称和Cron表达式");
      return;
    }
    if (form.target_type === "task" && form.target_id === 0) {
      alert("请选择任务");
      return;
    }
    if (form.target_type === "screen" && !form.screen_name) {
      alert("请选择Screen会话");
      return;
    }
    if (form.target_type === "script" && form.script_id === 0) {
      alert("请选择脚本");
      return;
    }
    try {
      await createSchedule({
        name: form.name,
        cron_expr: form.cron_expr,
        target_type: form.target_type,
        target_id: form.target_type === "task" ? form.target_id : undefined,
        screen_name: form.target_type === "screen" ? form.screen_name : undefined,
        script_id: form.target_type === "script" ? form.script_id : undefined,
        command: form.command || undefined,
        enabled: form.enabled,
      });
      setShowForm(false);
      setForm({ 
        name: "", 
        cron_expr: "0 * * * *", 
        target_type: "task",
        target_id: tasks[0]?.id || 0,
        screen_name: "",
        script_id: scripts[0]?.id || 0,
        command: "",
        enabled: true 
      });
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.detail || "创建失败");
    }
  }, [form, tasks, scripts]);

  const handleToggle = async (s: Schedule) => {
    try {
      await updateSchedule(s.id, { enabled: !s.enabled });
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.detail || "操作失败");
    }
  };

  const handleTrigger = async (s: Schedule) => {
    try {
      await triggerSchedule(s.id);
      alert("已触发执行");
    } catch (e: any) {
      alert(e?.response?.data?.detail || "触发失败");
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("确认删除此定时任务？")) return;
    try {
      await deleteSchedule(id);
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.detail || "删除失败");
    }
  };

  const getTargetName = (s: Schedule) => {
    if (s.target_type === "task") {
      return tasks.find((t) => t.id === s.target_id)?.name || `任务#${s.target_id}`;
    }
    if (s.target_type === "screen") {
      return s.screen_name || "未知会话";
    }
    if (s.target_type === "script") {
      return scripts.find((scr) => scr.id === s.script_id)?.name || `脚本#${s.script_id}`;
    }
    return "-";
  };

  const getTargetIcon = (type: string) => {
    if (type === "task") return <Settings size={14} />;
    if (type === "screen") return <Terminal size={14} />;
    if (type === "script") return <Code2 size={14} />;
    return null;
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="定时任务"
        subtitle="按 Cron 表达式自动定时执行任务、脚本或发送命令到Screen会话"
        icon={<Clock size={20} />}
        actions={
          <>
            <button onClick={load} className="btn-ghost flex items-center gap-1">
              <RefreshCw size={14} /> 刷新
            </button>
            <button
              onClick={() => setShowForm((s) => !s)}
              className="btn-neon flex items-center gap-2"
            >
              <Plus size={14} /> 新建任务
            </button>
          </>
        }
      />

      {showForm && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          className="glass-card p-5 mb-6"
        >
          <h3 className="text-sm font-mono text-neon-cyan uppercase tracking-wider mb-4">新建定时任务</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="text-xs font-mono text-muted-dim">任务名称</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="input-cyber mt-1"
                placeholder="每日数据同步"
              />
            </div>
            <div>
              <label className="text-xs font-mono text-muted-dim">执行类型</label>
              <select
                  value={form.target_type}
                  onChange={(e) => {
                    const newValue = e.target.value as "task" | "screen" | "script";
                    setForm({ 
                      ...form, 
                      target_type: newValue,
                      target_id: newValue === "task" ? (tasks[0]?.id || 0) : 0,
                      screen_name: newValue === "screen" ? form.screen_name : "",
                      script_id: newValue === "script" ? (scripts[0]?.id || 0) : 0,
                    });
                  }}
                  className="input-cyber mt-1"
              >
                {targetTypes.map((t) => {
                  const Icon = t.icon;
                  return (
                    <option key={t.value} value={t.value} className="bg-ink-900">
                      <Icon size={14} className="inline mr-2" />
                      {t.label}
                    </option>
                  );
                })}
              </select>
            </div>
            {form.target_type === "task" && (
              <div>
                <label className="text-xs font-mono text-muted-dim">关联任务</label>
                <select
                  value={form.target_id}
                  onChange={(e) => setForm({ ...form, target_id: Number(e.target.value) })}
                  className="input-cyber mt-1"
                >
                  {tasks.length === 0 && <option value={0}>请先创建任务</option>}
                  {tasks.map((t) => (
                    <option key={t.id} value={t.id} className="bg-ink-900">
                      {t.name} ({t.type})
                    </option>
                  ))}
                </select>
              </div>
            )}
            {form.target_type === "screen" && (
              <div>
                <label className="text-xs font-mono text-muted-dim">Screen会话</label>
                <select
                  value={form.screen_name}
                  onChange={(e) => setForm({ ...form, screen_name: e.target.value })}
                  className="input-cyber mt-1"
                >
                  {screens.length === 0 && <option value="">暂无会话</option>}
                  <optgroup label="容器内会话">
                    {screens.filter((s) => (s as any).source === "container").map((s) => (
                      <option key={s.name} value={s.name} className="bg-ink-900">
                        {s.name} ({s.status})
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="宿主机会话">
                    {screens.filter((s) => (s as any).source === "local").map((s) => (
                      <option key={s.name} value={s.name} className="bg-ink-900">
                        {s.name} ({s.status})
                      </option>
                    ))}
                  </optgroup>
                </select>
              </div>
            )}
            {form.target_type === "script" && (
              <div>
                <label className="text-xs font-mono text-muted-dim">脚本</label>
                <select
                  value={form.script_id}
                  onChange={(e) => setForm({ ...form, script_id: Number(e.target.value) })}
                  className="input-cyber mt-1"
                >
                  {scripts.length === 0 && <option value={0}>请先创建脚本</option>}
                  {scripts.map((scr) => (
                    <option key={scr.id} value={scr.id} className="bg-ink-900">
                      {scr.name} ({scr.filename})
                    </option>
                  ))}
                </select>
              </div>
            )}
            {(form.target_type === "screen" || form.target_type === "script") && (
              <div className="md:col-span-2 lg:col-span-4">
                <label className="text-xs font-mono text-muted-dim">
                  {form.target_type === "screen" ? "发送命令" : "执行命令"}
                </label>
                <input
                  value={form.command}
                  onChange={(e) => setForm({ ...form, command: e.target.value })}
                  className="input-cyber mt-1 font-mono"
                  placeholder={form.target_type === "screen" ? "ls -la" : "python scripts/my_script.py"}
                />
                {form.target_type === "screen" && (
                  <p className="text-xs text-muted-dim mt-1">
                    定时向Screen会话发送命令，例如：执行命令、发送输入等
                  </p>
                )}
              </div>
            )}
            <div className="md:col-span-2 lg:col-span-4">
              <label className="text-xs font-mono text-muted-dim">Cron 表达式（分 时 日 月 周）</label>
              <input
                value={form.cron_expr}
                onChange={(e) => setForm({ ...form, cron_expr: e.target.value })}
                className="input-cyber mt-1 font-mono"
                placeholder="0 2 * * *"
              />
              <div className="mt-2 flex flex-wrap gap-2">
                {cronPresets.map((p) => (
                  <button
                    key={p.value}
                    onClick={() => setForm({ ...form, cron_expr: p.value })}
                    className="px-2 py-1 text-xs font-mono rounded border border-ink-700 text-muted hover:border-neon-cyan/60 hover:text-neon-cyan transition-all"
                  >
                    {p.label} <span className="text-muted-dim">{p.value}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-muted cursor-pointer">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                className="accent-neon-cyan"
              />
              立即启用
            </label>
            <button onClick={handleCreate} className="btn-neon">保存任务</button>
            <button onClick={() => setShowForm(false)} className="btn-ghost">取消</button>
          </div>
        </motion.div>
      )}

      <div className="glass-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs font-mono text-muted-dim uppercase tracking-wider border-b border-ink-700/60">
              <th className="px-4 py-3">状态</th>
              <th className="px-4 py-3">名称</th>
              <th className="px-4 py-3">类型</th>
              <th className="px-4 py-3">关联目标</th>
              <th className="px-4 py-3">命令</th>
              <th className="px-4 py-3">Cron</th>
              <th className="px-4 py-3">上次运行</th>
              <th className="px-4 py-3">下次运行</th>
              <th className="px-4 py-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {schedules.length === 0 && !loading && (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-muted-dim font-mono">
                  暂无定时任务，点击右上角"新建任务"开始
                </td>
              </tr>
            )}
            {schedules.map((s) => (
              <tr key={s.id} className="border-b border-ink-800/40 hover:bg-ink-800/30 transition-colors">
                <td className="px-4 py-3">
                  <span className={`dot ${s.enabled ? "dot-enabled" : "dot-disabled"}`} />
                </td>
                <td className="px-4 py-3 text-gray-100 font-medium">{s.name}</td>
                <td className="px-4 py-3">
                  <span className="flex items-center gap-1 text-muted">
                    {getTargetIcon(s.target_type)}
                    {targetTypes.find((t) => t.value === s.target_type)?.label || s.target_type}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted">{getTargetName(s)}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted-dim max-w-[200px] truncate" title={s.command || ""}>
                  {s.command || "-"}
                </td>
                <td className="px-4 py-3 font-mono text-neon-amber text-xs">{s.cron_expr}</td>
                <td className="px-4 py-3 text-muted-dim text-xs font-mono">
                  {s.last_run_at ? new Date(s.last_run_at).toLocaleString("zh-CN") : "-"}
                </td>
                <td className="px-4 py-3 text-neon-cyan text-xs font-mono">
                  {s.next_run_at ? new Date(s.next_run_at).toLocaleString("zh-CN") : "-"}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      onClick={() => handleTrigger(s)}
                      title="立即触发"
                      className="p-1.5 rounded text-muted hover:text-neon-green hover:bg-ink-800/60 transition-all"
                    >
                      <Play size={15} />
                    </button>
                    <button
                      onClick={() => handleToggle(s)}
                      title={s.enabled ? "禁用" : "启用"}
                      className={`p-1.5 rounded transition-all ${s.enabled ? "text-neon-green hover:bg-ink-800/60" : "text-muted-dim hover:text-neon-cyan hover:bg-ink-800/60"}`}
                    >
                      <Power size={15} />
                    </button>
                    <button
                      onClick={() => handleDelete(s.id)}
                      title="删除"
                      className="p-1.5 rounded text-muted hover:text-neon-rose hover:bg-ink-800/60 transition-all"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 text-xs text-muted-dim font-mono flex items-center gap-2">
        <Calendar size={12} />
        Cron 表达式格式：分(0-59) 时(0-23) 日(1-31) 月(1-12) 周(0-6，0=周日)。例：<span className="text-neon-amber">0 2 * * *</span> = 每天 02:00
      </div>
    </div>
  );
}
