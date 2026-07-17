#!/usr/bin/env python3
"""
通用脚本模板 - 支持实时进度推送与前端监控

使用方法:
    python script_template.py --task-id <任务ID> [--args '...']

在这个模板中，你只需要实现 run() 函数的业务逻辑，框架会自动:
    1. 通过 stdout 输出 JSON 事件流，供后端解析
    2. 前端通过 WebSocket 实时接收进度和日志
    3. 支持进度、日志、结果、错误等多种事件类型

事件格式 (每行一个 JSON):
    {"type":"log","payload":{"log_line":"..."}}
    {"type":"progress","payload":{"completed":N,"total":M,"current":"..."}}
    {"type":"result","payload":{"key":"value"}}
    {"type":"error","payload":{"error":"..."}}
    {"type":"done","payload":{"status":"success","message":"..."}}

示例实现:
    def run(ctx):
        ctx.log("开始处理...")
        ctx.progress(0, 100, "准备中")
        for i in range(100):
            time.sleep(0.1)
            ctx.progress(i+1, 100, f"处理进度 {i+1}%")
            if (i+1) % 10 == 0:
                ctx.log(f"完成 {i+1}%")
        ctx.result({"total": 100, "data": [...]})
        ctx.done("success", "任务完成")
"""

import json
import sys
import argparse
from typing import Any, Dict


class ScriptContext:
    """脚本上下文 - 用于输出进度和日志事件"""

    def __init__(self, task_id: str = ""):
        self.task_id = task_id

    def _emit(self, event_type: str, payload: Dict[str, Any]):
        """输出 JSON 事件"""
        event = {"type": event_type, "payload": payload}
        if self.task_id:
            event["task_id"] = self.task_id
        print(json.dumps(event, ensure_ascii=False), flush=True)

    def log(self, message: str, level: str = "info"):
        """输出日志消息"""
        self._emit("log", {"log_line": message, "level": level})

    def progress(self, completed: int, total: int, current: str = ""):
        """输出进度信息"""
        self._emit("progress", {
            "completed": completed,
            "total": total,
            "current": current,
        })

    def result(self, data: Dict[str, Any]):
        """输出中间结果"""
        self._emit("result", data)

    def error(self, message: str):
        """输出错误信息"""
        self._emit("error", {"error": message})

    def done(self, status: str = "success", message: str = ""):
        """标记任务完成"""
        self._emit("done", {"status": status, "message": message})


def run(ctx: ScriptContext):
    """
    ==================== 在这里实现你的业务逻辑 ====================
    你只需要修改这个函数，使用 ctx 对象输出进度和日志。
    
    ctx.log(message)        - 输出日志
    ctx.progress(done, total, current) - 输出进度
    ctx.result(data)        - 输出中间结果
    ctx.error(message)      - 输出错误
    ctx.done(status, msg)   - 标记完成
    """
    import time

    ctx.log("=== 示例脚本开始执行 ===")
    ctx.progress(0, 5, "初始化")
    
    # 模拟步骤1
    time.sleep(1)
    ctx.log("步骤1: 数据准备")
    ctx.progress(1, 5, "数据准备")
    
    # 模拟步骤2
    time.sleep(1)
    ctx.log("步骤2: 处理数据")
    ctx.progress(2, 5, "处理数据")
    
    # 模拟步骤3 - 包含子进度
    ctx.log("步骤3: 执行计算")
    ctx.progress(3, 5, "执行计算")
    for i in range(10):
        time.sleep(0.3)
        sub_pct = (i + 1) * 10
        ctx.log(f"  计算进度: {sub_pct}%")
        ctx.progress(3 + (sub_pct / 100), 5, f"计算 {sub_pct}%")
    
    # 模拟步骤4
    time.sleep(1)
    ctx.log("步骤4: 保存结果")
    ctx.progress(4, 5, "保存结果")
    
    # 输出结果
    ctx.result({
        "processed": 1000,
        "saved": 1000,
        "errors": 0,
    })
    
    # 完成
    ctx.progress(5, 5, "完成")
    ctx.done("success", "示例脚本执行完毕")


def main():
    parser = argparse.ArgumentParser(description="通用脚本模板")
    parser.add_argument("--task-id", type=str, default="", help="任务ID（用于日志关联）")
    parser.add_argument("--args", type=str, default="", help="自定义参数（JSON格式）")
    args = parser.parse_args()

    ctx = ScriptContext(task_id=args.task_id)
    ctx.log(f"脚本启动，任务ID: {args.task_id}")
    if args.args:
        try:
            params = json.loads(args.args)
            ctx.log(f"收到参数: {json.dumps(params, ensure_ascii=False)}")
        except json.JSONDecodeError:
            ctx.log(f"参数格式错误: {args.args}", level="warning")

    try:
        run(ctx)
    except Exception as e:
        ctx.error(f"脚本执行异常: {str(e)}")
        ctx.done("failed", str(e))
        sys.exit(1)


if __name__ == "__main__":
    main()
