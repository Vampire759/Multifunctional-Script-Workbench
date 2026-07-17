import { useEffect, useRef } from "react";
import type { LogLine } from "../hooks/useJobWebSocket";

interface LogStreamProps {
  logs: LogLine[];
  connected?: boolean;
  height?: string;
}

export default function LogStream({ logs, connected, height = "300px" }: LogStreamProps) {
  const endRef = useRef<HTMLDivElement>(null);
  const safeLogs = Array.isArray(logs) ? logs : [];

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [safeLogs]);

  return (
    <div
      className="bg-ink-950 border border-ink-800/60 rounded-lg p-3 overflow-auto font-mono text-xs"
      style={{ height }}
    >
      <div className="flex items-center justify-between mb-2 pb-2 border-b border-ink-800/60">
        <span className="text-muted-dim uppercase tracking-wider">日志输出</span>
        {connected !== undefined && (
          <span className={`flex items-center gap-1.5 ${connected ? "text-neon-green" : "text-muted-dim"}`}>
            <span className={`dot ${connected ? "dot-running" : "dot-disabled"}`} />
            {connected ? "已连接" : "未连接"}
          </span>
        )}
      </div>
      {safeLogs.length === 0 ? (
        <div className="text-muted-dim italic">等待输出...</div>
      ) : (
        safeLogs.map((line, i) => (
          <div
            key={i}
            className={`leading-relaxed ${
              line.level === "error" ? "text-neon-rose" : "text-neon-green/90"
            }`}
          >
            <span className="text-muted-dim mr-2">
              {new Date(line.ts).toLocaleTimeString("zh-CN", { hour12: false })}
            </span>
            {line.text}
          </div>
        ))
      )}
      <div ref={endRef} />
    </div>
  );
}
