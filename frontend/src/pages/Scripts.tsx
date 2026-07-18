import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Code2, Play, Plus, Trash2, Save, Eye, Edit3, RefreshCw, Terminal, Upload, FileText, Zap, FolderOpen, FileCode } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import PageHeader from "../components/PageHeader";
import { listScripts, createScript, getScript, updateScript, deleteScript, executeScript, uploadScript, listScriptFiles, executeScriptFile, type Script, type ScriptFile } from "../lib/api";

interface ExecuteModalProps {
  script: Script;
  onClose: () => void;
}

function ExecuteModal({ script, onClose }: ExecuteModalProps) {
  const [args, setArgs] = useState("");
  const [format, setFormat] = useState("urls");
  const [inputContent, setInputContent] = useState("");
  const navigate = useNavigate();

  const formats = [
    { value: "urls", label: "URL列表", description: "每行一个URL，作为命令行参数传递" },
    { value: "json", label: "JSON数据", description: "JSON格式的输入数据" },
    { value: "command", label: "命令参数", description: "直接的命令行参数" },
  ];

  const handleExecute = async () => {
    let finalArgs = args;
    
    if (format === "urls") {
      const urls = inputContent.split("\n").filter(Boolean).map(u => u.trim()).join(" ");
      finalArgs = urls || args;
    } else if (format === "json") {
      finalArgs = inputContent || args;
    }
    
    try {
      await executeScript(script.id, finalArgs);
      navigate("/dashboard");
    } catch (e: any) {
      alert(e?.response?.data?.detail || "执行失败");
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9 }}
        animate={{ scale: 1 }}
        exit={{ scale: 0.9 }}
        onClick={(e) => e.stopPropagation()}
        className="glass-card w-full max-w-2xl"
      >
        <div className="p-4 border-b border-ink-700/60 flex items-center justify-between">
          <h3 className="font-mono text-gray-100 flex items-center gap-2">
            <Play size={18} className="text-neon-green" />
            执行脚本 - {script.name}
          </h3>
          <button onClick={onClose} className="text-muted hover:text-gray-200">×</button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="text-xs font-mono text-muted-dim">输入格式</label>
            <div className="flex gap-2 mt-2">
              {formats.map((f) => (
                <button
                  key={f.value}
                  onClick={() => setFormat(f.value)}
                  className={`px-4 py-2 rounded-lg text-sm font-mono transition-all ${
                    format === f.value
                      ? "bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/50"
                      : "bg-ink-800/40 text-muted hover:text-gray-200 border border-transparent"
                  }`}
                  title={f.description}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-dim mt-1">{formats.find(f => f.value === format)?.description}</p>
          </div>

          <div>
            <label className="text-xs font-mono text-muted-dim">输入内容</label>
            {format === "urls" ? (
              <textarea
                value={inputContent}
                onChange={(e) => setInputContent(e.target.value)}
                className="w-full h-32 font-mono text-sm bg-ink-900/80 text-gray-200 border border-ink-700/60 rounded-lg p-4 resize-none outline-none focus:border-neon-cyan/50 mt-2"
                placeholder="https://example.com/page1\nhttps://example.com/page2\n..."
              />
            ) : format === "json" ? (
              <textarea
                value={inputContent}
                onChange={(e) => setInputContent(e.target.value)}
                className="w-full h-32 font-mono text-sm bg-ink-900/80 text-gray-200 border border-ink-700/60 rounded-lg p-4 resize-none outline-none focus:border-neon-cyan/50 mt-2"
                placeholder='{"key": "value", "list": [1, 2, 3]}'
              />
            ) : (
              <input
                value={args}
                onChange={(e) => setArgs(e.target.value)}
                className="w-full font-mono text-sm bg-ink-900/80 text-gray-200 border border-ink-700/60 rounded-lg p-4 outline-none focus:border-neon-cyan/50 mt-2"
                placeholder="--option value1 value2"
              />
            )}
          </div>

          <div className="flex justify-end gap-3">
            <button onClick={onClose} className="btn-ghost">取消</button>
            <button onClick={handleExecute} className="btn-neon flex items-center gap-2">
              <Zap size={14} /> 执行
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default function Scripts() {
  const navigate = useNavigate();
  const [scripts, setScripts] = useState<Script[]>([]);
  const [scriptFiles, setScriptFiles] = useState<ScriptFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedScript, setSelectedScript] = useState<Script | null>(null);
  const [editingScript, setEditingScript] = useState<Script | null>(null);
  const [content, setContent] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [scriptType, setScriptType] = useState("general");
  const [showExecute, setShowExecute] = useState<Script | null>(null);
  const [tab, setTab] = useState<"db" | "files">("db");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [dbScripts, files] = await Promise.all([
        listScripts(),
        listScriptFiles(),
      ]);
      setScripts(Array.isArray(dbScripts) ? dbScripts : []);
      setScriptFiles(Array.isArray(files) ? files : []);
    } catch (e) {
      console.error(e);
      setScripts([]);
      setScriptFiles([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleExecuteFile = async (filename: string) => {
    try {
      await executeScriptFile(filename);
      navigate("/logs");
    } catch (e: any) {
      alert(e?.response?.data?.detail || "执行失败");
    }
  };

  const handleCreate = async () => {
    if (!newName.trim()) {
      alert("请填写脚本名称");
      return;
    }
    try {
      await createScript(newName.trim(), newDescription.trim(), scriptType);
      setNewName("");
      setNewDescription("");
      setScriptType("general");
      setShowCreate(false);
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.detail || "创建失败");
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    try {
      await uploadScript(file);
      await load();
      alert(`脚本 "${file.name}" 上传成功`);
    } catch (e: any) {
      alert(e?.response?.data?.detail || "上传失败");
    }
    
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleSelect = async (script: Script) => {
    setSelectedScript(script);
    setEditingScript(null);
  };

  const handleEdit = async (script: Script) => {
    const detail = await getScript(script.id);
    setEditingScript(detail);
    setContent(detail.content);
    setSelectedScript(null);
  };

  const handleSave = async () => {
    if (!editingScript) return;
    try {
      await updateScript(editingScript.id, content, editingScript.description);
      setEditingScript(null);
      setContent("");
      await load();
      alert("保存成功");
    } catch (e: any) {
      alert(e?.response?.data?.detail || "保存失败");
    }
  };

  const handleDelete = async (script: Script) => {
    if (!confirm(`确认删除脚本 "${script.name}"？`)) return;
    try {
      await deleteScript(script.id);
      await load();
      if (selectedScript?.id === script.id) {
        setSelectedScript(null);
      }
      if (editingScript?.id === script.id) {
        setEditingScript(null);
        setContent("");
      }
    } catch (e: any) {
      alert(e?.response?.data?.detail || "删除失败");
    }
  };

  const handleExecute = (script: Script) => {
    setShowExecute(script);
  };

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="脚本管理"
        subtitle="管理可拓展的 Python 脚本，支持生成模板、上传、执行"
        icon={<Code2 size={20} />}
        actions={
          <>
            <button onClick={load} className="btn-ghost flex items-center gap-1">
              <RefreshCw size={14} /> 刷新
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="btn-amber flex items-center gap-2"
            >
              <Upload size={14} /> 上传脚本
            </button>
            <button onClick={() => setShowCreate(true)} className="btn-neon flex items-center gap-2">
              <Plus size={14} /> 新增脚本
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".py"
              onChange={handleUpload}
              className="hidden"
            />
          </>
        }
      />

      <div className="flex-1 flex flex-col p-4 overflow-hidden">
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => { setTab("db"); setSelectedScript(null); setEditingScript(null); }}
            className={`px-4 py-2 rounded-lg text-sm font-mono transition-all flex items-center gap-2 ${
              tab === "db"
                ? "bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/50"
                : "bg-ink-800/40 text-muted hover:text-gray-200 border border-transparent"
            }`}
          >
            <FileText size={14} /> 数据库脚本
          </button>
          <button
            onClick={() => { setTab("files"); setSelectedScript(null); setEditingScript(null); }}
            className={`px-4 py-2 rounded-lg text-sm font-mono transition-all flex items-center gap-2 ${
              tab === "files"
                ? "bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/50"
                : "bg-ink-800/40 text-muted hover:text-gray-200 border border-transparent"
            }`}
          >
            <FolderOpen size={14} /> scripts目录
          </button>
        </div>

        <AnimatePresence>
          {showCreate && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="glass-card p-4 mb-4"
            >
              <div className="flex flex-wrap items-center gap-3">
                <div className="w-48">
                  <label className="text-xs font-mono text-muted-dim">脚本名称</label>
                  <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="input-cyber mt-1"
                    placeholder="my_script"
                  />
                </div>
                <div className="w-48">
                  <label className="text-xs font-mono text-muted-dim">脚本类型</label>
                  <select
                    value={scriptType}
                    onChange={(e) => setScriptType(e.target.value)}
                    className="input-cyber mt-1"
                  >
                    <option value="general">通用脚本</option>
                    <option value="scrape">爬虫脚本</option>
                  </select>
                </div>
                <div className="flex-1 min-w-[300px]">
                  <label className="text-xs font-mono text-muted-dim">描述（可选）</label>
                  <input
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                    className="input-cyber mt-1"
                    placeholder="脚本功能描述"
                  />
                </div>
                <button onClick={handleCreate} className="btn-amber flex items-center gap-2 mt-5">
                  <Plus size={14} /> 生成模板
                </button>
                <button onClick={() => setShowCreate(false)} className="btn-ghost mt-5">取消</button>
              </div>
              <div className="mt-3 p-3 bg-ink-900/40 rounded-lg border border-ink-700/40">
                <p className="text-xs text-muted-dim font-mono">
                  💡 提示：生成的模板包含 <code className="text-neon-cyan">send_progress()</code> 和 <code className="text-neon-cyan">send_log()</code> 函数，
                  在模板中实现功能即可实现前后端实时监控。
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex-1 grid grid-cols-1 lg:grid-cols-4 gap-6 min-h-0">
        <div className="lg:col-span-1 flex flex-col">
          <div className="glass-card flex-1 flex flex-col">
            <div className="p-4 border-b border-ink-700/60">
              <h3 className="text-sm font-mono text-muted-dim uppercase tracking-wider">
                {tab === "db" ? "脚本列表" : "scripts目录文件"}
              </h3>
            </div>
            <div className="flex-1 overflow-y-auto">
              {loading && (
                <div className="p-8 text-center text-muted-dim font-mono">加载中...</div>
              )}
              {tab === "db" && !loading && scripts.length === 0 && (
                <div className="p-8 text-center text-muted-dim font-mono">
                  暂无脚本
                  <p className="text-xs mt-2">点击上方「新增脚本」或「上传脚本」开始</p>
                </div>
              )}
              {tab === "files" && !loading && scriptFiles.length === 0 && (
                <div className="p-8 text-center text-muted-dim font-mono">
                  暂无脚本文件
                  <p className="text-xs mt-2">scripts 目录为空</p>
                </div>
              )}
              {tab === "db" && scripts.map((script) => (
                <motion.div
                  key={script.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className={`p-4 border-b border-ink-800/40 ${
                    editingScript?.id === script.id ? "bg-ink-800/40" : "hover:bg-ink-800/30"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-mono text-sm text-gray-100">{script.name}</span>
                    <span className={`text-xs font-mono ${script.status === "active" ? "text-neon-cyan" : "text-muted-dim"}`}>
                      {script.status === "active" ? "可用" : "草稿"}
                    </span>
                  </div>
                  <div className="text-xs text-muted-dim truncate" title={script.filename}>
                    {script.filename}
                  </div>
                  {script.description && (
                    <div className="text-xs text-gray-500 mt-1 truncate" title={script.description}>
                      {script.description}
                    </div>
                  )}
                  <div className="flex items-center gap-2 mt-3">
                    <button
                      onClick={() => handleExecute(script)}
                      className="p-1.5 rounded text-muted hover:text-neon-green hover:bg-ink-800/60 transition-all"
                      title="执行"
                    >
                      <Play size={14} />
                    </button>
                    <button
                      onClick={() => handleSelect(script)}
                      className="p-1.5 rounded text-muted hover:text-neon-cyan hover:bg-ink-800/60 transition-all"
                      title="查看"
                    >
                      <Eye size={14} />
                    </button>
                    <button
                      onClick={() => handleEdit(script)}
                      className="p-1.5 rounded text-muted hover:text-neon-amber hover:bg-ink-800/60 transition-all"
                      title="编辑"
                    >
                      <Edit3 size={14} />
                    </button>
                    <button
                      onClick={() => handleDelete(script)}
                      className="p-1.5 rounded text-muted hover:text-neon-rose hover:bg-ink-800/60 transition-all"
                      title="删除"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </motion.div>
              ))}
              {tab === "files" && scriptFiles.map((file) => (
                <motion.div
                  key={file.filename}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="p-4 border-b border-ink-800/40 hover:bg-ink-800/30"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <FileCode size={14} className="text-neon-cyan" />
                    <span className="font-mono text-sm text-gray-100">{file.name}</span>
                  </div>
                  <div className="text-xs text-muted-dim truncate" title={file.filename}>
                    {file.filename}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-dim">
                    <span>{file.size} bytes</span>
                    <span>{new Date(file.modified_at).toLocaleDateString()}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-3">
                    <button
                      onClick={() => handleExecuteFile(file.filename)}
                      className="p-1.5 rounded text-muted hover:text-neon-green hover:bg-ink-800/60 transition-all"
                      title="执行"
                    >
                      <Play size={14} />
                    </button>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </div>

        <div className="lg:col-span-3 flex flex-col">
          <AnimatePresence>
            {editingScript ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="glass-card flex-1 flex flex-col"
              >
                <div className="p-4 border-b border-ink-700/60 flex items-center justify-between">
                  <div>
                    <h3 className="font-mono text-gray-100">编辑脚本 - {editingScript.name}</h3>
                    <p className="text-xs text-muted-dim">{editingScript.filename}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => { setEditingScript(null); setContent(""); }} className="btn-ghost">取消</button>
                    <button onClick={handleSave} className="btn-neon flex items-center gap-2">
                      <Save size={14} /> 保存
                    </button>
                  </div>
                </div>
                <div className="flex-1 p-4 overflow-hidden">
                  <textarea
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    className="w-full h-full font-mono text-sm bg-ink-900/80 text-gray-200 border border-ink-700/60 rounded-lg p-4 resize-none outline-none focus:border-neon-cyan/50"
                    spellCheck={false}
                  />
                </div>
              </motion.div>
            ) : selectedScript ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="glass-card h-full flex flex-col"
              >
                <div className="p-4 border-b border-ink-700/60 flex items-center justify-between">
                  <div>
                    <h3 className="font-mono text-gray-100">{selectedScript.name}</h3>
                    <p className="text-xs text-muted-dim">{selectedScript.filename}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => handleExecute(selectedScript)} className="btn-neon flex items-center gap-2">
                      <Play size={14} /> 执行脚本
                    </button>
                    <button onClick={() => handleEdit(selectedScript)} className="btn-amber flex items-center gap-2">
                      <Edit3 size={14} /> 编辑
                    </button>
                  </div>
                </div>
                <div className="flex-1 p-4 overflow-auto">
                  <pre className="font-mono text-sm text-gray-300 whitespace-pre-wrap break-all">
                    {selectedScript.content}
                  </pre>
                </div>
                <div className="p-4 border-t border-ink-700/60 bg-ink-900/40">
                  <div className="flex items-center gap-2 text-xs text-muted-dim">
                    <Terminal size={12} />
                    <span>执行命令：</span>
                    <code className="text-neon-cyan bg-ink-800 px-2 py-1 rounded">
                      python scripts/{selectedScript.filename}
                    </code>
                  </div>
                </div>
              </motion.div>
            ) : tab === "files" ? (
              <div className="glass-card h-full flex items-center justify-center text-center">
                <div>
                  <FolderOpen size={48} className="text-muted-dim mx-auto mb-3" />
                  <p className="text-muted-dim font-mono">选择一个脚本文件执行</p>
                  <p className="text-xs text-muted-dim mt-2">执行后会在日志中心创建screen会话</p>
                </div>
              </div>
            ) : (
              <div className="glass-card h-full flex items-center justify-center text-center">
                <div>
                  <Code2 size={48} className="text-muted-dim mx-auto mb-3" />
                  <p className="text-muted-dim font-mono">选择一个脚本查看或编辑</p>
                  <p className="text-xs text-muted-dim mt-2">点击脚本的执行按钮开始运行</p>
                </div>
              </div>
            )}
          </AnimatePresence>
        </div>
      </div>

      </div>

      <AnimatePresence>
        {showExecute && <ExecuteModal script={showExecute} onClose={() => setShowExecute(null)} />}
      </AnimatePresence>
    </div>
  );
}
