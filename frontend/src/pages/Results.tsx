import { useState, useEffect, useCallback } from "react";
import { Database, Download, Search, RefreshCw, ExternalLink, ArrowDownToLine } from "lucide-react";
import { motion } from "framer-motion";
import PageHeader from "../components/PageHeader";
import { listResults, listJobs, exportUrl, createDownload, type VideoResult } from "../lib/api";
import type { JobBrief } from "../lib/types";

export default function Results() {
  const [items, setItems] = useState<VideoResult[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [keyword, setKeyword] = useState("");
  const [jobId, setJobId] = useState("");
  const [jobs, setJobs] = useState<JobBrief[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listResults({
        page,
        page_size: pageSize,
        keyword: keyword || undefined,
        job_id: jobId || undefined,
      });
      setItems(data.items);
      setTotal(data.total);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, keyword, jobId]);

  useEffect(() => {
    listJobs().then(setJobs).catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [load]);

  const totalPages = Math.ceil(total / pageSize);

  const handleExport = (format: "txt" | "json" | "csv") => {
    const url = exportUrl(format, jobId || undefined, keyword || undefined);
    window.open(url, "_blank");
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="结果中心"
        subtitle={`共 ${total} 条采集结果`}
        icon={<Database size={20} />}
        actions={
          <>
            <button onClick={load} className="btn-ghost flex items-center gap-1">
              <RefreshCw size={14} /> 刷新
            </button>
            <div className="flex items-center gap-1">
              <button onClick={() => handleExport("txt")} className="btn-ghost flex items-center gap-1">
                <Download size={14} /> TXT
              </button>
              <button onClick={() => handleExport("json")} className="btn-ghost flex items-center gap-1">
                <Download size={14} /> JSON
              </button>
              <button onClick={() => handleExport("csv")} className="btn-ghost flex items-center gap-1">
                <Download size={14} /> CSV
              </button>
            </div>
          </>
        }
      />

      {/* 筛选区 */}
      <div className="glass-card p-4 mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-dim" />
          <input
            value={keyword}
            onChange={(e) => {
              setKeyword(e.target.value);
              setPage(1);
            }}
            className="input-cyber pl-9"
            placeholder="搜索标题 / URL / 来源"
          />
        </div>
        <select
          value={jobId}
          onChange={(e) => {
            setJobId(e.target.value);
            setPage(1);
          }}
          className="input-cyber w-64"
        >
          <option value="">全部任务批次</option>
          {jobs.map((j) => (
            <option key={j.job_id} value={j.job_id} className="bg-ink-900">
              {j.job_id.slice(0, 16)}... [{j.status}]
            </option>
          ))}
        </select>
        {items.length > 0 && (
          <button
            onClick={() => {
              items.forEach(async (r) => {
                await createDownload(r.url, r.source_url, undefined, undefined, r.title);
              });
              alert(`已将 ${items.length} 条结果添加到下载队列`);
            }}
            className="btn-amber flex items-center gap-2"
          >
            <ArrowDownToLine size={14} /> 全部下载
          </button>
        )}
      </div>

      {/* 表格 */}
      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-mono text-muted-dim uppercase tracking-wider border-b border-ink-700/60">
                <th className="px-4 py-3">序号</th>
                <th className="px-4 py-3">标题</th>
                <th className="px-4 py-3">视频 URL</th>
                <th className="px-4 py-3">来源页面</th>
                <th className="px-4 py-3">采集时间</th>
                <th className="px-4 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-muted-dim font-mono">
                    加载中...
                  </td>
                </tr>
              )}
              {!loading && items.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-muted-dim font-mono">
                    暂无数据
                  </td>
                </tr>
              )}
              {items.map((r) => (
                <motion.tr
                  key={`${r.seq}-${r.source_url}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="border-b border-ink-800/40 hover:bg-ink-800/30 transition-colors"
                >
                  <td className="px-4 py-3 text-neon-cyan font-mono">{r.seq}</td>
                  <td className="px-4 py-3 text-gray-200 max-w-xs">
                    <div className="truncate" title={r.title || ""}>{r.title || "-"}</div>
                  </td>
                  <td className="px-4 py-3 text-neon-green/90 max-w-md">
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 hover:underline truncate"
                      title={r.url}
                    >
                      <span className="truncate">{r.url}</span>
                      <ExternalLink size={12} className="flex-shrink-0" />
                    </a>
                  </td>
                  <td className="px-4 py-3 text-muted-dim max-w-xs">
                    <div className="truncate text-xs font-mono" title={r.source_url}>{r.source_url}</div>
                  </td>
                  <td className="px-4 py-3 text-muted-dim text-xs font-mono">
                    {new Date(r.collected_at).toLocaleString("zh-CN")}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => {
                        createDownload(r.url, r.source_url, undefined, undefined, r.title);
                      }}
                      title="下载此视频"
                      className="p-1.5 rounded text-muted hover:text-neon-amber hover:bg-ink-800/60 transition-all"
                    >
                      <ArrowDownToLine size={15} />
                    </button>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 分页 */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-ink-700/60 text-xs font-mono">
            <span className="text-muted-dim">
              第 {page} / {totalPages} 页，共 {total} 条
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="btn-ghost disabled:opacity-30 disabled:cursor-not-allowed"
              >
                上一页
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="btn-ghost disabled:opacity-30 disabled:cursor-not-allowed"
              >
                下一页
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
