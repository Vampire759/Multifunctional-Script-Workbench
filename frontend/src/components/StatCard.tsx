import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";

interface StatCardProps {
  label: string;
  value: number | string;
  icon: LucideIcon;
  color?: "cyan" | "green" | "rose" | "amber";
  delay?: number;
}

const colorMap = {
  cyan: { text: "text-neon-cyan", glow: "shadow-neon-cyan", border: "border-neon-cyan/40" },
  green: { text: "text-neon-green", glow: "shadow-neon-green", border: "border-neon-green/40" },
  rose: { text: "text-neon-rose", glow: "shadow-[0_0_12px_rgba(255,77,109,0.4)]", border: "border-neon-rose/40" },
  amber: { text: "text-neon-amber", glow: "shadow-neon-amber", border: "border-neon-amber/40" },
};

export default function StatCard({ label, value, icon: Icon, color = "cyan", delay = 0 }: StatCardProps) {
  const c = colorMap[color];
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4 }}
      whileHover={{ y: -2 }}
      className={`glass-card p-5 hover:border-ink-600 transition-all`}
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs font-mono text-muted-dim uppercase tracking-wider">{label}</div>
          <div className={`mt-2 text-3xl font-mono font-bold ${c.text}`} style={{ textShadow: "0 0 12px currentColor" }}>
            {value}
          </div>
        </div>
        <div className={`p-2 rounded-lg border ${c.border} ${c.glow}`}>
          <Icon size={18} className={c.text} />
        </div>
      </div>
    </motion.div>
  );
}
