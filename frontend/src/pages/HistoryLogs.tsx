import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FolderOpen, Folder, FileText, Download, RefreshCw, Search, ChevronRight, Grid3X3, List, Trash2, AlertTriangle, ChevronDown, ChevronRight as ChevronRightIcon } from "lucide-react";
import { listLogFiles, listLogFilesGrouped, getLogFileContent, downloadLogFile, deleteLogFile, deleteSessionLogs, LogFile, SessionLogGroup } from "../lib/api";
import Layout from "../components/Layout";

type ViewMode = "timeline" | "grouped";

export default function HistoryLogs() {
  const [logFiles, setLogFiles] = useState<LogFile[]>([]);
  const [logGroups, setLogGroups] = useState<SessionLogGroup[]>([]);
  const [selectedFile, setSelectedFile] = useState<LogFile | null>(null);
  const [fileContent, setFileContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("timeline");
  const [confirmDelete, setConfirmDelete] = useState<{ type: "file" | "session"; name: string } | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const load = async () => {
    setLoading(true);
    try {
      setLogFiles(await listLogFiles());
      setLogGroups(await listLogFilesGrouped());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const viewFile = async (file: LogFile) => {
    setSelectedFile(file);
    setFileContent("加载中...");
    try {
      const result = await getLogFileContent(file.name, 1000);
      setFileContent(result.content || "日志文件为空");
    } catch (e) {
      console.error(e);
      setFileContent("加载失败");
    }
  };

  const handleDeleteFile = async (filename: string) => {
    try {
      await deleteLogFile(filename);
      load();
      if (selectedFile?.name === filename) {
        setSelectedFile(null);
        setFileContent("");
      }
    } catch (e) {
      console.error(e);
    }
    setConfirmDelete(null);
  };

  const handleDeleteSession = async (sessionName: string) => {
    try {
      await deleteSessionLogs(sessionName);
      load();
      if (selectedFile?.session_name === sessionName) {
        setSelectedFile(null);
        setFileContent("");
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

  const filteredFiles = logFiles.filter((file) =>
    file.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (file.session_name && file.session_name.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const filteredGroups = logGroups.filter((group) =>
    group.session_name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  return (
    <Layout>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-100 flex items-center gap-3">
            <FolderOpen className="text-neon-cyan" size={28} />
            历史日志
          </h1>
          <p className="text-muted-dim mt-1">查看和管理所有保存的日志文件</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center bg-ink-800/40 rounded-lg p-1 border border-ink-700/60">
            <button
              onClick={() => setViewMode("timeline")}
              className={`p-2 rounded-md transition-all ${viewMode === "timeline" ? "bg-neon-cyan/20 text-neon-cyan" : "text-muted hover:text-gray-200"}`}
              title="时间线视图"
            >
              <List size={16} />
            </button>
            <button
              onClick={() => setViewMode("grouped")}
              className={`p-2 rounded-md transition-all ${viewMode === "grouped" ? "bg-neon-cyan/20 text-neon-cyan" : "text-muted hover:text-gray-200"}`}
              title="分组视图"
            >
              <Grid3X3 size={16} />
            </button>
          </div>
          <button
            onClick={load}
            className="btn-primary flex items-center gap-2"
          >
            <RefreshCw size={16} />
            刷新列表
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 h-[calc(100vh-180px)]">
        <div className="lg:col-span-1 glass-card flex flex-col">
          <div className="p-4 border-b border-ink-700/60">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-dim" />
              <input
                type="text"
                placeholder="搜索日志文件..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-ink-800/40 border border-ink-700/60 rounded-lg text-sm text-gray-200 placeholder:text-muted-dim focus:outline-none focus:border-neon-cyan/60 transition-colors"
              />
            </div>
            <p className="text-xs text-muted-dim mt-2">
              {viewMode === "timeline" ? `共 ${filteredFiles.length} 个日志文件` : `共 ${filteredGroups.length} 个会话分组`}
            </p>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {loading ? (
              <div className="p-8 text-center text-muted-dim font-mono">加载中...</div>
            ) : viewMode === "timeline" ? (
              filteredFiles.length === 0 ? (
                <div className="p-8 text-center">
                  <FileText size={48} className="mx-auto text-muted-dim mb-4" />
                  <p className="text-muted-dim">暂无历史日志</p>
                </div>
              ) : (
                filteredFiles.map((file) => (
                  <motion.div
                    key={`${file.name}-${file.path}`}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className={`p-3 mb-2 rounded-lg cursor-pointer transition-all ${
                      selectedFile?.name === file.name ? "bg-neon-cyan/10 border border-neon-cyan/30" : "hover:bg-ink-800/40 border border-transparent"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <FileText size={14} className={selectedFile?.name === file.name ? "text-neon-cyan" : "text-muted-dim"} />
                        <span className="font-mono text-sm text-gray-200 truncate max-w-[120px]" title={file.name}>
                          {file.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => { e.stopPropagation(); window.open(downloadLogFile(file.name), "_blank"); }}
                          className="p-1.5 rounded hover:bg-ink-700/40 text-muted hover:text-neon-cyan transition-colors"
                          title="下载"
                        >
                          <Download size={14} />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setConfirmDelete({ type: "file", name: file.name }); }}
                          className="p-1.5 rounded hover:bg-ink-700/40 text-muted hover:text-neon-rose transition-colors"
                          title="删除"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between mt-1.5">
                      <span className="text-xs text-muted-dim">
                        {formatFileSize(file.size)}
                      </span>
                      <span className="text-xs text-muted-dim">
                        {new Date(file.modified_at).toLocaleString()}
                      </span>
                    </div>
                    {file.session_name && (
                      <div className="mt-1">
                        <span className="text-xs text-neon-cyan/70 bg-neon-cyan/10 px-2 py-0.5 rounded">
                          {file.session_name}
                        </span>
                      </div>
                    )}
                  </motion.div>
                ))
              )
            ) : (
              filteredGroups.length === 0 ? (
                <div className="p-8 text-center">
                  <FolderOpen size={48} className="mx-auto text-muted-dim mb-4" />
                  <p className="text-muted-dim">暂无会话分组</p>
                </div>
              ) : (
                filteredGroups.map((group) => {
                    const isExpanded = expandedGroups.has(group.session_name);
                    const toggleGroup = () => {
                      const newExpanded = new Set(expandedGroups);
                      if (isExpanded) {
                        newExpanded.delete(group.session_name);
                      } else {
                        newExpanded.add(group.session_name);
                      }
                      setExpandedGroups(newExpanded);
                    };
                    return (
                      <motion.div
                        key={group.session_name}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="mb-3"
                      >
                        <div 
                          className="flex items-center justify-between p-3 bg-ink-800/30 rounded-lg cursor-pointer hover:bg-ink-800/50 transition-colors"
                          onClick={toggleGroup}
                        >
                          <div className="flex items-center gap-2">
                            <button className="p-0.5 hover:text-neon-cyan transition-colors">
                              {isExpanded ? (
                                <ChevronDown size={14} className="text-neon-cyan" />
                              ) : (
                                <ChevronRightIcon size={14} className="text-muted-dim" />
                              )}
                            </button>
                            {isExpanded ? (
                              <FolderOpen size={14} className="text-neon-cyan" />
                            ) : (
                              <Folder size={14} className="text-muted-dim" />
                            )}
                            <span className="font-mono text-sm text-gray-200">{group.session_name}</span>
                            <span className="text-xs text-muted-dim">({group.total_files})</span>
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); setConfirmDelete({ type: "session", name: group.session_name }); }}
                            className="p-1.5 rounded hover:bg-ink-700/40 text-muted hover:text-neon-rose transition-colors"
                            title="删除会话所有日志"
                          >
                            <Trash2 size={14} />
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
                              <div className="mt-2 pl-4 space-y-1">
                                {group.files.map((file) => (
                                  <motion.div
                                    key={`${group.session_name}-${file.name}`}
                                    initial={{ opacity: 0, x: -10 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    onClick={() => viewFile(file)}
                                    className={`p-2 rounded cursor-pointer transition-all flex items-center justify-between ${
                                      selectedFile?.name === file.name ? "bg-neon-cyan/10" : "hover:bg-ink-800/40"
                                    }`}
                                  >
                                    <div className="flex items-center gap-2">
                                      <FileText size={12} className={selectedFile?.name === file.name ? "text-neon-cyan" : "text-muted-dim"} />
                                      <span className="font-mono text-xs text-gray-300 truncate max-w-[120px]" title={file.name}>
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

        <div className="lg:col-span-3 flex flex-col">
          <AnimatePresence>
            {selectedFile ? (
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
                      <h3 className="font-mono text-gray-100">{selectedFile.name}</h3>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-muted-dim">
                          {formatFileSize(selectedFile.size)}
                        </span>
                        <span className="text-xs text-muted-dim">·</span>
                        <span className="text-xs text-muted-dim">
                          {new Date(selectedFile.modified_at).toLocaleString()}
                        </span>
                        {selectedFile.session_name && (
                          <>
                            <span className="text-xs text-muted-dim">·</span>
                            <span className="text-xs text-neon-cyan/70 bg-neon-cyan/10 px-2 py-0.5 rounded">
                              {selectedFile.session_name}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => viewFile(selectedFile)}
                      className="btn-ghost flex items-center gap-1"
                    >
                      <RefreshCw size={14} /> 刷新
                    </button>
                    <button
                      onClick={() => window.open(downloadLogFile(selectedFile.name), "_blank")}
                      className="btn-primary flex items-center gap-1"
                    >
                      <Download size={14} /> 下载
                    </button>
                    <button
                      onClick={() => { setSelectedFile(null); setFileContent(""); }}
                      className="btn-ghost flex items-center gap-1"
                    >
                      <ChevronRight size={14} /> 返回列表
                    </button>
                  </div>
                </div>

                <div className="flex-1 p-4 overflow-y-auto font-mono text-sm text-gray-300 whitespace-pre-wrap bg-ink-950/50">
                  {fileContent}
                </div>
              </motion.div>
            ) : (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="glass-card flex-1 flex items-center justify-center"
              >
                <div className="text-center">
                  <FolderOpen size={64} className="mx-auto text-muted-dim mb-4" />
                  <p className="text-muted-dim text-lg">选择一个日志文件查看</p>
                  <p className="text-muted-dim text-sm mt-2">点击左侧列表中的文件</p>
                </div>
              </motion.div>
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
                <AlertTriangle size={24} className="text-neon-amber" />
                <h3 className="text-lg font-bold text-gray-100">确认删除</h3>
              </div>
              <p className="text-gray-300 mb-6">
                {confirmDelete.type === "file"
                  ? `确定要删除日志文件 "${confirmDelete.name}" 吗？此操作无法撤销。`
                  : `确定要删除会话 "${confirmDelete.name}" 的所有日志文件吗？此操作无法撤销。`}
              </p>
              <div className="flex items-center justify-end gap-3">
                <button
                  onClick={() => setConfirmDelete(null)}
                  className="btn-ghost"
                >
                  取消
                </button>
                <button
                  onClick={() => confirmDelete.type === "file" ? handleDeleteFile(confirmDelete.name) : handleDeleteSession(confirmDelete.name)}
                  className="btn-danger"
                >
                  删除
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </Layout>
  );
}
