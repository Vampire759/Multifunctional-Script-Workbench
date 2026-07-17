import { useEffect, useRef } from "react";
import { Terminal as XTerminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

interface TerminalProps {
  sessionName: string;
  onClose?: () => void;
}

export default function Terminal({ sessionName, onClose }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XTerminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const terminal = new XTerminal({
      cursorBlink: true,
      cursorStyle: "block",
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      theme: {
        background: "#0a0a0f",
        foreground: "#e4e4e7",
        cursor: "#22d3ee",
        cursorAccent: "#0a0a0f",
        selectionBackground: "#22d3ee20",
        black: "#18181b",
        red: "#f87171",
        green: "#4ade80",
        yellow: "#facc15",
        blue: "#60a5fa",
        magenta: "#f472b6",
        cyan: "#22d3ee",
        white: "#e4e4e7",
        brightBlack: "#52525b",
        brightRed: "#fca5a5",
        brightGreen: "#86efac",
        brightYellow: "#fde047",
        brightBlue: "#93c5fd",
        brightMagenta: "#f9a8d4",
        brightCyan: "#67e8f9",
        brightWhite: "#f4f4f5",
      },
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);

    terminal.open(containerRef.current);

    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${window.location.host}/api/terminal/screen/${sessionName}`);

    ws.onopen = () => {
      terminal.write(`\r\n=== 已连接到 screen 会话: ${sessionName} ===\r\n`);
    };

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        const text = new TextDecoder('utf-8').decode(event.data);
        terminal.write(text);
      } else if (typeof event.data === "string") {
        terminal.write(event.data);
      }
    };

    ws.onerror = () => {
      terminal.write("\r\n连接错误...\r\n");
    };

    ws.onclose = () => {
      terminal.write("\r\n连接已断开.\r\n");
    };

    terminal.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    terminal.onResize(({ rows, cols }) => {
      console.log(`Terminal resized: ${rows}x${cols}`);
    });

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    wsRef.current = ws;

    fitAddon.fit();

    const handleResize = () => {
      fitAddon.fit();
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      terminal.dispose();
    };
  }, [sessionName]);

  useEffect(() => {
    if (fitAddonRef.current) {
      fitAddonRef.current.fit();
    }
  }, [sessionName]);

  return (
    <div className="flex-1 flex flex-col bg-ink-950">
      <div className="flex items-center justify-between px-4 py-3 bg-ink-900 border-b border-ink-700/60">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-neon-rose/80" />
          <div className="w-3 h-3 rounded-full bg-neon-amber/80" />
          <div className="w-3 h-3 rounded-full bg-neon-green/80" />
        </div>
        <span className="text-xs font-mono text-muted-dim">screen - {sessionName}</span>
        <button
          onClick={onClose}
          className="text-muted hover:text-neon-rose transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      <div ref={containerRef} className="flex-1" />
    </div>
  );
}