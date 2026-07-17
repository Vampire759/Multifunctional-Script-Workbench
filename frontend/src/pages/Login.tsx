import { useState } from "react";
import { motion } from "framer-motion";
import { LogIn, User, Lock, Eye, EyeOff, AlertCircle } from "lucide-react";
import { login } from "../lib/api";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const data = await login(username, password);
      localStorage.setItem("token", data.access_token);
      localStorage.setItem("username", username);
      window.location.href = "/dashboard";
    } catch (err: any) {
      setError(err?.response?.data?.detail || "登录失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-ink-950 relative overflow-hidden">
      <div className="absolute inset-0 opacity-20">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-neon-cyan/20 rounded-full blur-[120px]" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-neon-amber/20 rounded-full blur-[120px]" />
      </div>

      <div className="relative z-10 w-full max-w-md px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card p-8"
        >
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 rounded-xl bg-neon-cyan/20 flex items-center justify-center mb-4">
              <LogIn size={32} className="text-neon-cyan" />
            </div>
            <h1 className="text-2xl font-bold text-gray-100">登录工作台</h1>
            <p className="text-sm text-muted-dim mt-1">登录系统管理任务</p>
          </div>

          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-2 px-4 py-3 bg-neon-rose/10 border border-neon-rose/30 rounded-lg mb-6"
            >
              <AlertCircle size={16} className="text-neon-rose flex-shrink-0" />
              <span className="text-sm text-neon-rose">{error}</span>
            </motion.div>
          )}

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="block text-sm font-mono text-muted-dim mb-2">用户名</label>
              <div className="relative">
                <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-dim" />
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="input-cyber pl-10"
                  placeholder="admin"
                  autoFocus
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-mono text-muted-dim mb-2">密码</label>
              <div className="relative">
                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-dim" />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input-cyber pl-10 pr-10"
                  placeholder="admin123"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-dim hover:text-neon-cyan transition-colors"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !username || !password}
              className="btn-neon w-full py-3 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  登录中...
                </span>
              ) : (
                "登录"
              )}
            </button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-xs font-mono text-muted-dim">
              默认账号: <span className="text-neon-cyan">admin</span> / <span className="text-neon-cyan">admin123</span>
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
