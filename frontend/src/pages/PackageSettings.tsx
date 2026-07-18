import { useState, useEffect } from "react";
import { Package, Plus, Trash2, Download, RefreshCw, CheckCircle, XCircle, AlertCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import PageHeader from "../components/PageHeader";
import { getPackages, installPackage, removePackage, installAllPackages, type PackageInfo } from "../lib/api";

export default function PackageSettings() {
  const [packages, setPackages] = useState<PackageInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);
  const [newPackage, setNewPackage] = useState("");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const loadPackages = async () => {
    try {
      const result = await getPackages();
      setPackages(result.packages);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadPackages();
  }, []);

  const handleInstall = async (packageName: string) => {
    setInstalling(packageName);
    try {
      await installPackage(packageName);
      setMessage({ type: "success", text: `包 '${packageName}' 安装成功` });
      await loadPackages();
    } catch (e: any) {
      setMessage({ type: "error", text: e?.response?.data?.detail || "安装失败" });
    } finally {
      setInstalling(null);
      setTimeout(() => setMessage(null), 3000);
    }
  };

  const handleAddPackage = async () => {
    if (!newPackage.trim()) return;
    setInstalling(newPackage);
    try {
      await installPackage(newPackage.trim());
      setMessage({ type: "success", text: `包 '${newPackage}' 安装成功` });
      setNewPackage("");
      await loadPackages();
    } catch (e: any) {
      setMessage({ type: "error", text: e?.response?.data?.detail || "安装失败" });
    } finally {
      setInstalling(null);
      setTimeout(() => setMessage(null), 3000);
    }
  };

  const handleRemove = async (packageName: string) => {
    if (!confirm(`确认从配置中移除包 '${packageName}'？`)) return;
    try {
      await removePackage(packageName);
      setMessage({ type: "success", text: `包 '${packageName}' 已移除` });
      await loadPackages();
    } catch (e: any) {
      setMessage({ type: "error", text: e?.response?.data?.detail || "移除失败" });
    } finally {
      setTimeout(() => setMessage(null), 3000);
    }
  };

  const handleInstallAll = async () => {
    if (!confirm("确认安装所有包？这可能需要一段时间。")) return;
    setInstalling("all");
    try {
      await installAllPackages();
      setMessage({ type: "success", text: "所有包安装成功" });
      await loadPackages();
    } catch (e: any) {
      setMessage({ type: "error", text: e?.response?.data?.detail || "安装失败" });
    } finally {
      setInstalling(null);
      setTimeout(() => setMessage(null), 3000);
    }
  };

  const installedCount = packages.filter(p => p.installed).length;

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="脚本库设置" icon={<Package size={24} />} />

      <AnimatePresence>
        {message && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className={`mx-4 mt-4 p-4 rounded-lg flex items-center gap-2 ${
              message.type === "success" ? "bg-neon-green/10 text-neon-green" : "bg-neon-rose/10 text-neon-rose"
            }`}
          >
            {message.type === "success" ? <CheckCircle size={18} /> : <XCircle size={18} />}
            <span>{message.text}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex-1 flex flex-col p-4 gap-4 overflow-hidden">
        <div className="glass-card flex flex-col flex-1 min-h-0">
          <div className="p-4 border-b border-ink-700/60 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-gray-100">已安装的包</h3>
              <p className="text-sm text-muted-dim">{installedCount} / {packages.length} 个包已安装</p>
            </div>
            <button
              onClick={handleInstallAll}
              disabled={installing === "all"}
              className="btn-amber flex items-center gap-2 disabled:opacity-50"
            >
              <Download size={16} />
              {installing === "all" ? "安装中..." : "安装全部"}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            <div className="space-y-2">
              {packages.length === 0 ? (
                <div className="text-center text-muted-dim py-8">
                  <Package size={32} className="mx-auto mb-3 opacity-50" />
                  <p>暂无包配置</p>
                </div>
              ) : (
                packages.map((pkg) => (
                  <motion.div
                    key={pkg.name}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="flex items-center justify-between p-3 bg-ink-800/30 rounded-lg hover:bg-ink-800/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      {pkg.installed ? (
                        <CheckCircle size={16} className="text-neon-green" />
                      ) : (
                        <XCircle size={16} className="text-neon-rose" />
                      )}
                      <span className="font-mono text-sm text-gray-200">{pkg.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {!pkg.installed && (
                        <button
                          onClick={() => handleInstall(pkg.name)}
                          disabled={installing === pkg.name}
                          className="btn-ghost text-xs flex items-center gap-1 hover:text-neon-cyan"
                        >
                          <RefreshCw size={12} className={installing === pkg.name ? "animate-spin" : ""} />
                          安装
                        </button>
                      )}
                      <button
                        onClick={() => handleRemove(pkg.name)}
                        className="p-1.5 rounded hover:bg-ink-700/40 text-muted hover:text-neon-rose transition-colors"
                        title="移除"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </motion.div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="glass-card p-4">
          <h3 className="text-lg font-semibold text-gray-100 mb-4">添加新包</h3>
          <div className="flex gap-3">
            <input
              type="text"
              value={newPackage}
              onChange={(e) => setNewPackage(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddPackage()}
              placeholder="输入包名，例如: beautifulsoup4 或 requests==2.31.0"
              className="flex-1 input-cyber"
            />
            <button
              onClick={handleAddPackage}
              disabled={!newPackage.trim() || installing === newPackage}
              className="btn-amber flex items-center gap-2 disabled:opacity-50"
            >
              <Plus size={16} />
              添加并安装
            </button>
          </div>
          <div className="mt-4 p-3 bg-ink-800/30 rounded-lg">
            <div className="flex items-start gap-2">
              <AlertCircle size={14} className="text-neon-amber mt-0.5 flex-shrink-0" />
              <p className="text-xs text-muted-dim">
                添加的包会自动安装并保存到 requirements.txt 文件中。格式支持：包名（如 beautifulsoup4）、指定版本（如 requests==2.31.0）、版本范围（如 requests&gt;=2.30.0）。
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
