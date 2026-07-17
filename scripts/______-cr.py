#!/usr/bin/env python3
"""视频地址提取工具（CLI 模式，输出进度与日志，带重试和增强请求头）"""
import sys
import json
import re
import threading
import argparse
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from bs4 import BeautifulSoup

# -------------------- 增强的请求头（模拟真实浏览器） --------------------
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Cache-Control": "max-age=0",
}

# -------------------- 核心抓取函数 --------------------
def extract_video_info_from_dplayer(dplayer_element):
    if not dplayer_element:
        return {"title": None, "url": None}
    title = dplayer_element.get('data-video_title')
    config_str = dplayer_element.get('data-config')
    if not config_str:
        return {"title": title, "url": None}
    config_str = config_str.replace('&quot;', '"').replace('&#39;', "'")
    try:
        config = json.loads(config_str)
        url_raw = config['video']['url']
        url = url_raw.replace('&amp;', '&').replace('\\/', '/')
        return {"title": title, "url": url}
    except json.JSONDecodeError:
        match = re.search(r'"url":"(.*?)"', config_str)
        if match:
            url_raw = match.group(1)
            url = url_raw.replace('\\/', '/').replace('&amp;', '&')
            return {"title": title, "url": url}
        return {"title": title, "url": None}


def extract_all_videos(html):
    soup = BeautifulSoup(html, 'lxml')
    players = soup.select('.dplayer')
    results = []
    for player in players:
        info = extract_video_info_from_dplayer(player)
        if info['url']:
            results.append(info)
    return results


def create_session_with_retries(retries=3, backoff_factor=1):
    """创建带有重试策略的 requests Session"""
    session = requests.Session()
    retry = Retry(
        total=retries,
        read=retries,
        connect=retries,
        backoff_factor=backoff_factor,
        status_forcelist=[500, 502, 503, 504],
        allowed_methods=["GET"]
    )
    adapter = HTTPAdapter(max_retries=retry)
    session.mount('http://', adapter)
    session.mount('https://', adapter)
    return session


def fetch_page_html(url):
    """使用带重试的 Session 获取页面"""
    session = create_session_with_retries(retries=3, backoff_factor=1)
    resp = session.get(url, headers=HEADERS, timeout=15)
    resp.raise_for_status()
    return resp.text


def scrape_single_url(url):
    try:
        html = fetch_page_html(url)
        videos = extract_all_videos(html)
        return url, videos, None
    except Exception as e:
        return url, [], str(e)


# -------------------- 进度/日志输出辅助函数 --------------------
def send_progress(message: str, progress: int = None, **kwargs):
    """向前端发送进度信息（通过 stdout）"""
    data = {
        "type": "progress",
        "message": message,
        "timestamp": datetime.now().isoformat(),
    }
    if progress is not None:
        data["progress"] = progress
    data.update(kwargs)
    print(f"[PROGRESS] {json.dumps(data, ensure_ascii=False)}", flush=True)


def send_log(message: str, level: str = "info"):
    """向前端发送日志信息（通过 stdout）"""
    data = {
        "type": "log",
        "message": message,
        "level": level,
        "timestamp": datetime.now().isoformat(),
    }
    print(f"[PROGRESS] {json.dumps(data, ensure_ascii=False)}", flush=True)


# -------------------- 并发爬取主逻辑 --------------------
def run_scrape(urls, max_workers=5):
    """
    并发抓取所有 URL，并输出进度与日志
    :param urls: 待抓取 URL 列表
    :param max_workers: 最大并发数
    """
    total = len(urls)
    if total == 0:
        send_log("未提供任何 URL", "warning")
        return

    send_progress("开始抓取", 0, total=total)
    send_log(f"共 {total} 个 URL 待处理", "info")

    completed = 0
    total_videos = 0
    all_results = []          # 存储 (url, videos, error)
    lock = threading.Lock()

    max_workers = min(max_workers, total)

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_url = {executor.submit(scrape_single_url, url): url for url in urls}

        for future in as_completed(future_to_url):
            url = future_to_url[future]
            try:
                result_url, videos, error = future.result()
            except Exception as e:
                result_url, videos, error = url, [], f"未知异常: {str(e)}"

            with lock:
                completed += 1
                all_results.append((result_url, videos, error))
                if error:
                    send_log(f"失败: {result_url} - {error}", "error")
                else:
                    send_log(f"成功: {result_url} (提取 {len(videos)} 个视频)", "info")
                    total_videos += len(videos)

                # 计算进度百分比
                progress = int(completed / total * 100)
                send_progress(
                    f"进度 {completed}/{total}",
                    progress,
                    completed=completed,
                    total=total,
                    current_url=result_url,
                    videos_found=len(videos)
                )

    # 全部完成
    send_progress(
        "抓取完成",
        100,
        total_urls=total,
        completed_urls=completed,
        total_videos=total_videos,
        results=all_results   # 将完整结果附带在最终消息中（供前端解析）
    )
    send_log(f"处理完成，共提取 {total_videos} 个视频", "success")


# -------------------- 命令行参数解析 --------------------
def parse_args():
    parser = argparse.ArgumentParser(description="视频地址提取工具（CLI 模式）")
    # 位置参数：直接传递 URL
    parser.add_argument('urls', nargs='*', help="待抓取的 URL 列表（位置参数）")
    # 兼容旧用法：--urls 选项
    parser.add_argument('--urls', nargs='*', default=[], help="待抓取的 URL 列表（选项参数，兼容）")
    parser.add_argument('--urls-file', help="从文件读取 URL（每行一个）")
    parser.add_argument('--max-workers', type=int, default=5, help="并发数（默认 5）")
    return parser.parse_args()


# -------------------- 入口 --------------------
def main():
    send_log("脚本启动", "info")

    args = parse_args()

    # 收集 URL：优先使用位置参数 urls，然后追加 --urls
    urls = list(args.urls) if args.urls else []
    if args.urls:
        urls.extend(args.urls)

    # 从文件读取
    if args.urls_file:
        try:
            with open(args.urls_file, 'r', encoding='utf-8') as f:
                urls.extend([line.strip() for line in f if line.strip()])
        except Exception as e:
            send_log(f"读取 URL 文件失败: {e}", "error")
            sys.exit(1)

    # 从标准输入读取（支持管道）
    if not sys.stdin.isatty() and not urls:
        urls = [line.strip() for line in sys.stdin if line.strip()]

    # 去重保序
    seen = set()
    unique_urls = []
    for u in urls:
        if u not in seen:
            seen.add(u)
            unique_urls.append(u)

    if not unique_urls:
        send_log("未提供任何 URL", "error")
        sys.exit(1)

    try:
        run_scrape(unique_urls, args.max_workers)
    except Exception as e:
        send_log(f"执行失败: {str(e)}", "error")
        raise


if __name__ == "__main__":
    main()