// WebSocket Hook：订阅指定 job 的实时进度
import { useEffect, useRef, useCallback, useState } from "react";
import type { WSMessage, VideoResult } from "../lib/types";

export interface UseWSResult {
  connected: boolean;
  logs: LogLine[];
  progress: { completed: number; total: number | null; current_url?: string } | null;
  results: VideoResult[];
  done: boolean;
  status: string | null;
  error: string | null;
  send: (msg: string) => void;
  reset: () => void;
}

export interface LogLine {
  text: string;
  level?: string;
  ts: number;
}

export function useJobWebSocket(jobId: string | null): UseWSResult {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [progress, setProgress] = useState<UseWSResult["progress"]>(null);
  const [results, setResults] = useState<VideoResult[]>([]);
  const [done, setDone] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setLogs([]);
    setProgress(null);
    setResults([]);
    setDone(false);
    setStatus(null);
    setError(null);
  }, []);

  useEffect(() => {
    if (!jobId) return;
    reset();

    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const url = `${proto}://${window.location.host}/api/ws/${jobId}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setError("WebSocket 连接失败");

    ws.onmessage = (ev) => {
      try {
        const msg: WSMessage = JSON.parse(ev.data);
        switch (msg.type) {
          case "log":
            setLogs((prev) => [...prev, { text: msg.payload.log_line || "", level: msg.payload.level, ts: Date.now() }]);
            break;
          case "progress":
            setProgress({
              completed: msg.payload.completed ?? 0,
              total: msg.payload.total ?? null,
              current_url: msg.payload.current_url,
            });
            break;
          case "result":
            if (msg.payload.result) {
              setResults((prev) => [...prev, msg.payload.result!]);
            }
            break;
          case "done":
            setDone(true);
            setStatus(msg.payload.status || "done");
            if (msg.payload.total_videos !== undefined) {
              setLogs((prev) => [...prev, { text: `>> 完成，共提取 ${msg.payload.total_videos} 条结果`, ts: Date.now() }]);
            }
            break;
          case "error":
            setError(msg.payload.error || "未知错误");
            setLogs((prev) => [...prev, { text: `[错误] ${msg.payload.error}`, level: "error", ts: Date.now() }]);
            break;
        }
      } catch {
        // ignore parse errors
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [jobId, reset]);

  const send = useCallback((msg: string) => {
    wsRef.current?.send(msg);
  }, []);

  return { connected, logs, progress, results, done, status, error, send, reset };
}
