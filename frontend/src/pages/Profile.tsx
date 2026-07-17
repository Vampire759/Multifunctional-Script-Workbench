import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Settings, Lock, User, CheckCircle, AlertCircle, Eye, EyeOff } from "lucide-react";
import PageHeader from "../components/PageHeader";
import { changePassword, getCurrentUser } from "../lib/api";

export default function Profile() {
  const [user, setUser] = useState<{ username: string; created_at: string } | null>(null);
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showOldPassword, setShowOldPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const loadUser = async () => {
    try {
      const data = await getCurrentUser();
      setUser(data);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadUser();
  }, []);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    
    if (!oldPassword.trim()) {
      setMessage({ type: "error", text: "请输入原密码" });
      return;
    }
    if (!newPassword.trim()) {
      setMessage({ type: "error", text: "请输入新密码" });
      return;
    }
    if (newPassword.length < 6) {
      setMessage({ type: "error", text: "新密码长度不能少于6位" });
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage({ type: "error", text: "两次输入的密码不一致" });
      return;
    }
    if (oldPassword === newPassword) {
      setMessage({ type: "error", text: "新密码不能与原密码相同" });
      return;
    }

    setLoading(true);
    try {
      await changePassword(oldPassword, newPassword);
      setMessage({ type: "success", text: "密码修改成功，请重新登录" });
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setTimeout(() => {
        localStorage.removeItem("token");
        localStorage.removeItem("username");
        window.location.href = "/login";
      }, 2000);
    } catch (err: any) {
      setMessage({ type: "error", text: err?.response?.data?.detail || "修改失败" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <PageHeader
        title="个人设置"
        subtitle="管理账户信息和密码"
        icon={<Settings size={20} />}
      />

      <div className="glass-card p-6 mb-6">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-xl bg-neon-cyan/20 flex items-center justify-center">
            <User size={32} className="text-neon-cyan" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-100">{user?.username || "加载中..."}</h2>
            <p className="text-sm text-muted-dim mt-1">
              注册时间: {user?.created_at ? new Date(user.created_at).toLocaleString("zh-CN") : "-"}
            </p>
          </div>
        </div>
      </div>

      <div className="glass-card p-6">
        <h3 className="text-sm font-mono text-neon-cyan uppercase tracking-wider mb-6 flex items-center gap-2">
          <Lock size={14} /> 修改密码
        </h3>

        {message && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`flex items-center gap-2 px-4 py-3 rounded-lg mb-6 ${
              message.type === "success" 
                ? "bg-neon-green/10 border border-neon-green/30" 
                : "bg-neon-rose/10 border border-neon-rose/30"
            }`}
          >
            {message.type === "success" ? (
              <CheckCircle size={16} className="text-neon-green flex-shrink-0" />
            ) : (
              <AlertCircle size={16} className="text-neon-rose flex-shrink-0" />
            )}
            <span className={`text-sm ${message.type === "success" ? "text-neon-green" : "text-neon-rose"}`}>
              {message.text}
            </span>
          </motion.div>
        )}

        <form onSubmit={handleChangePassword} className="space-y-4">
          <div>
            <label className="block text-sm font-mono text-muted-dim mb-2">原密码</label>
            <div className="relative">
              <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-dim" />
              <input
                type={showOldPassword ? "text" : "password"}
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                className="input-cyber pl-10 pr-10"
                placeholder="请输入原密码"
              />
              <button
                type="button"
                onClick={() => setShowOldPassword(!showOldPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-dim hover:text-neon-cyan transition-colors"
              >
                {showOldPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-mono text-muted-dim mb-2">新密码</label>
            <div className="relative">
              <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-dim" />
              <input
                type={showNewPassword ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="input-cyber pl-10 pr-10"
                placeholder="请输入新密码（至少6位）"
              />
              <button
                type="button"
                onClick={() => setShowNewPassword(!showNewPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-dim hover:text-neon-cyan transition-colors"
              >
                {showNewPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-mono text-muted-dim mb-2">确认新密码</label>
            <div className="relative">
              <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-dim" />
              <input
                type={showConfirmPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="input-cyber pl-10 pr-10"
                placeholder="请再次输入新密码"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-dim hover:text-neon-cyan transition-colors"
              >
                {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="btn-neon w-full py-3 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                修改中...
              </span>
            ) : (
              "确认修改"
            )}
          </button>
        </form>

        <div className="mt-6 p-4 bg-ink-900/40 rounded-lg">
          <h4 className="text-xs font-mono text-muted-dim mb-2">安全提示</h4>
          <ul className="text-xs text-muted space-y-1">
            <li>• 密码长度至少6位</li>
            <li>• 请使用安全强度高的密码</li>
            <li>• 修改密码后请妥善保管</li>
            <li>• 密码修改成功后将自动退出登录</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
