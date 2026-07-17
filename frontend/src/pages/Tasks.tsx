import { useState, useEffect } from "react";
import { Settings, Plus, Edit2, Trash2, X, Save, Webhook, Clock, Users, Link2, Code2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import PageHeader from "../components/PageHeader";
import { listTasks, createTask, updateTask, deleteTask, type Task } from "../lib/api";
import { listScripts, executeScript, type Script } from "../lib/api";

interface FormState {
  name: string;
  script_id: number | null;
  push_time: string;
  max_workers: number;
  urls: string;
  command: string;
  webhook_url: string;
  webhook_headers: string;
}

const empty: FormState = {
  name: "",
  script_id: null,
  push_time: "",
  max_workers: 5,
  urls: "",
  command: "",
  webhook_url: "",
  webhook_headers: "",
};

export default function Tasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [scripts, setScripts] = useState<Script[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(empty);

  const load = async () => {
    setLoading(true);
    try {
      const [ts, ss] = await Promise.all([listTasks(), listScripts()]);
      setTasks(Array.isArray(ts) ? ts : []);
      setScripts(Array.isArray(ss) ? ss : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm(empty);
    setShowForm(true);
  };

  const openEdit = (t: Task) => {
    setEditing(t);
    setForm({
      name: t.name,
      script_id: (t as any).script_id || null,
      push_time: (t as any).push_time || "",
      max_workers: t.max_workers || 5,
      urls: t.urls ? (Array.isArray(t.urls) ? t.urls.join("\n") : t.urls) : "",
      command: t.command || "",
      webhook_url: t.webhook_url || "",
      webhook_headers: t.webhook_headers || "",
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name) {
      alert("请填写任务名称");
      return;
    }
    if (!form.script_id) {
      alert("请选择脚本");
      return;
    }

    let webhook_headers: Record<string, string> | undefined;
    if (form.webhook_headers.trim()) {
      try {
        webhook_headers = JSON.parse(form.webhook_headers);
      } catch {
        alert("Webhook Headers 必须是合法 JSON");
        return;
      }
    }

    const data: any = {
      name: form.name,
      type: form.script_id ? "command" : "scrape",
      script_id: form.script_id,
      push_time: form.push_time || undefined,
      max_workers: form.max_workers,
      webhook_url: form.webhook_url || undefined,
      webhook_headers,
    };
    
    if (form.urls.trim()) {
      data.urls = form.urls.split("\n").map((s) => s.trim()).filter(Boolean);
    }
    if (form.command.trim()) {
      data.command = form.command;
    }

    try {
      if (editing) {
        await updateTask(editing.id, data);
      } else {
        await createTask(data);
      }

      if (!editing && form.script_id) {
        const args = form.urls.trim() || form.command.trim();
        await executeScript(form.script_id, args);
        alert("脚本已启动，可以在任务台查看实时日志");
      }

      setShowForm(false);
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.detail || "保存失败");
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("确认删除此任务？关联的调度也会一并删除。")) return;
    try {
      await deleteTask(id);
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.detail || "删除失败");
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
        title="任务管理"
        subtitle="管理任务，配置脚本、推送时间和并发数量"
        icon={<Settings size={20} />}
        actions={
          <button onClick={openCreate} className="btn-neon flex items-center gap-2">
            <Plus size={14} /> 新建任务
          </button>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading && tasks.length === 0 && (
          <div className="col-span-full text-center py-12 text-muted-dim font-mono">加载中...</div>
        )}
        {!loading && tasks.length === 0 && (
          <div className="col-span-full text-center py-12 text-muted-dim font-mono">
            暂无任务，点击右上角"新建任务"开始
          </div>
        )}
        {tasks.map((t, i) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="glass-card p-5 hover:border-ink-600 transition-all"
          >
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded border border-neon-cyan/40 text-neon-cyan">
                  <Code2 size={14} />
                </div>
                <h3 className="font-bold text-gray-100">{t.name}</h3>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => openEdit(t)}
                  className="p-1.5 rounded text-muted hover:text-neon-cyan hover:bg-ink-800/60 transition-all"
                >
                  <Edit2 size={14} />
                </button>
                <button
                  onClick={() => handleDelete(t.id)}
                  className="p-1.5 rounded text-muted hover:text-neon-rose hover:bg-ink-800/60 transition-all"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
            <div className="space-y-2 text-xs font-mono">
              <div className="flex items-center gap-2">
                <Code2 size={11} className="text-muted-dim" />
                <span className="text-neon-cyan">{getScriptName((t as any).script_id)}</span>
              </div>
              <div className="flex items-center gap-2">
                <Clock size={11} className="text-muted-dim" />
                <span className="text-gray-200">{(t as any).push_time || "不定时"}</span>
              </div>
              <div className="flex items-center gap-2">
                <Users size={11} className="text-muted-dim" />
                <span className="text-gray-200">并发: {t.max_workers}</span>
              </div>
              <div className="flex items-center gap-2">
                <Link2 size={11} className="text-muted-dim" />
                <span className="text-gray-200">URL数: {t.urls ? (Array.isArray(t.urls) ? t.urls.length : 1) : 0}</span>
              </div>
              <div className="flex items-center gap-2">
                <Webhook size={11} className="text-muted-dim" />
                <span className={t.webhook_url ? "text-neon-green" : "text-muted-dim"}>
                  {t.webhook_url ? "已配置推送" : "无推送"}
                </span>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      <AnimatePresence>
        {showForm && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowForm(false)}
              className="fixed inset-0 bg-black/60 z-40"
            />
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="fixed right-0 top-0 h-full w-full max-w-md bg-ink-900 border-l border-ink-700/60 z-50 overflow-auto"
            >
              <div className="p-5">
                <div className="flex items-center justify-between mb-5">
                  <h2 className="text-lg font-bold font-mono text-gray-100">
                    {editing ? "编辑任务" : "新建任务"}
                  </h2>
                  <button onClick={() => setShowForm(false)} className="btn-ghost">
                    <X size={18} />
                  </button>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-mono text-muted-dim">任务名称 *</label>
                    <input
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      className="input-cyber mt-1"
                      placeholder="输入任务名称"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-mono text-muted-dim">脚本选择 *</label>
                    <select
                      value={form.script_id || ""}
                      onChange={(e) => setForm({ ...form, script_id: e.target.value ? Number(e.target.value) : null })}
                      className="input-cyber mt-1 w-full"
                    >
                      <option value="">请选择脚本</option>
                      {scripts.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} - {s.description || "无描述"}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-xs font-mono text-muted-dim">推送时间（cron表达式）</label>
                    <input
                      value={form.push_time}
                      onChange={(e) => setForm({ ...form, push_time: e.target.value })}
                      className="input-cyber mt-1"
                      placeholder="例如: 0 8 * * * 表示每天8点执行"
                    />
                    <div className="mt-1 text-xs text-muted-dim font-mono">
                      格式: 分 时 日 月 周 (留空则不定时)
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-mono text-muted-dim">并发数量</label>
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={form.max_workers}
                      onChange={(e) => setForm({ ...form, max_workers: Number(e.target.value) })}
                      className="input-cyber mt-1 w-28"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-mono text-muted-dim">URL列表（每行一个，可选）</label>
                    <textarea
                      value={form.urls}
                      onChange={(e) => setForm({ ...form, urls: e.target.value })}
                      rows={4}
                      className="input-cyber mt-1 resize-y"
                      placeholder="https://example.com/api/data"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-mono text-muted-dim">自定义指令（可选）</label>
                    <textarea
                      value={form.command}
                      onChange={(e) => setForm({ ...form, command: e.target.value })}
                      rows={3}
                      className="input-cyber mt-1 resize-y"
                      placeholder="python script.py --arg value"
                    />
                  </div>

                  <div className="pt-3 border-t border-ink-800/60">
                    <div className="flex items-center gap-2 mb-3">
                      <Webhook size={14} className="text-neon-green" />
                      <span className="text-xs font-mono text-muted-dim uppercase tracking-wider">Webhook推送（可选）</span>
                    </div>
                    <div className="space-y-3">
                      <div>
                        <label className="text-xs font-mono text-muted-dim">Webhook URL</label>
                        <input
                          value={form.webhook_url}
                          onChange={(e) => setForm({ ...form, webhook_url: e.target.value })}
                          className="input-cyber mt-1"
                          placeholder="https://your-webhook.example.com/notify"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-mono text-muted-dim">Webhook Headers（JSON）</label>
                        <textarea
                          value={form.webhook_headers}
                          onChange={(e) => setForm({ ...form, webhook_headers: e.target.value })}
                          rows={3}
                          className="input-cyber mt-1 resize-y text-xs"
                          placeholder={'{"Authorization": "Bearer xxx"}'}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-4">
                    <button onClick={handleSave} className="btn-neon flex items-center gap-2">
                      <Save size={14} /> 保存
                    </button>
                    <button onClick={() => setShowForm(false)} className="btn-ghost">
                      取消
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
