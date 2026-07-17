interface ProgressBarProps {
  completed: number;
  total: number | null;
  current?: string;
}

export default function ProgressBar({ completed, total, current }: ProgressBarProps) {
  const pct = total ? Math.min(100, Math.round((completed / total) * 100)) : 0;
  return (
    <div className="w-full">
      <div className="flex items-center justify-between text-xs font-mono mb-2">
        <span className="text-neon-cyan">
          {completed}
          {total ? ` / ${total}` : ""}
        </span>
        <span className="text-muted-dim">{total ? `${pct}%` : "运行中"}</span>
      </div>
      <div className="h-2 bg-ink-800 rounded-full overflow-hidden border border-ink-700/60">
        <div
          className="h-full bg-gradient-to-r from-neon-cyan/60 via-neon-cyan to-neon-green/80 transition-all duration-500"
          style={{
            width: `${pct}%`,
            backgroundSize: "200% 100%",
            animation: "flow 2s linear infinite",
          }}
        />
      </div>
      {current && (
        <div className="mt-2 text-xs font-mono text-muted truncate" title={current}>
          <span className="text-muted-dim">▸ </span>
          {current}
        </div>
      )}
    </div>
  );
}
