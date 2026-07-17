#!/usr/bin/env python3
"""
test_script5 - test5

这是一个示例脚本，用于演示如何通过标准输出向前端（如 Web 界面）发送进度信息和日志。
脚本模拟了一个耗时任务，分阶段报告进度，并记录关键日志。
"""

import os          # 提供与操作系统交互的功能（本脚本未直接使用，但保留常见导入）
import sys         # 访问 Python 解释器相关的变量和函数
import json        # 用于序列化数据结构为 JSON 字符串，便于前端解析
import time        # 提供时间相关的函数，如 sleep 用于模拟耗时操作
from datetime import datetime  # 用于获取当前时间戳，并格式化为 ISO 格式


def send_progress(message: str, progress: int = None, **kwargs):
    """
    向前端发送进度信息。

    该函数将进度数据封装为 JSON 格式，并通过标准输出打印带有特殊前缀 `[PROGRESS]` 的行。
    前端可通过监听标准输出来实时解析进度更新。

    参数:
        message (str): 进度消息，描述当前阶段或状态。
        progress (int, optional): 进度百分比值（0~100），若为 None 则不在数据中包含该字段。
        **kwargs: 任意额外的键值对，会合并到 JSON 数据中，便于扩展自定义字段。

    返回:
        None

    示例:
        send_progress("正在加载数据...", 30, stage="loading")
        将输出: [PROGRESS] {"type":"progress","message":"正在加载数据...","timestamp":"2026-07-17T...","progress":30,"stage":"loading"}
    """
    # 构建基础数据字典
    data = {
        "type": "progress",               # 固定类型标识，便于前端区分消息类型
        "message": message,               # 进度描述文本
        "timestamp": datetime.now().isoformat(),  # 当前时间，ISO 8601 格式
    }
    # 如果传入了 progress 参数且不为 None，则添加到数据中
    if progress is not None:
        data["progress"] = progress
    # 将额外的关键字参数合并到数据字典中
    data.update(kwargs)
    # 打印带有 `[PROGRESS]` 前缀的 JSON 字符串，并强制刷新输出缓冲区，确保前端能立即收到
    print(f"[PROGRESS] {json.dumps(data)}", flush=True)


def send_log(message: str, level: str = "info"):
    """
    向前端发送日志信息。

    与 send_progress 类似，但用于记录一般日志、错误或成功信息，前端可以据此显示不同级别的提示。

    参数:
        message (str): 日志内容。
        level (str): 日志级别，通常为 "info"、"success"、"warning"、"error" 等，默认 "info"。

    返回:
        None

    示例:
        send_log("文件已保存", "success")
        将输出: [PROGRESS] {"type":"log","message":"文件已保存","level":"success","timestamp":"2026-07-17T..."}
    """
    data = {
        "type": "log",                    # 固定类型标识，区分于进度
        "message": message,               # 日志文本
        "level": level,                   # 日志级别，前端可根据级别渲染颜色或图标
        "timestamp": datetime.now().isoformat(),  # 时间戳
    }
    # 同样使用 `[PROGRESS]` 前缀打印 JSON，前端统一处理此前缀
    print(f"[PROGRESS] {json.dumps(data)}", flush=True)


def main():
    """
    脚本主函数，模拟一个包含多个步骤的任务流程。

    流程:
        1. 记录脚本启动日志
        2. 发送进度 0% -> 初始化
        3. 模拟耗时操作（sleep 1秒）
        4. 发送进度 50% -> 处理中
        5. 再次模拟耗时操作（sleep 1秒）
        6. 发送进度 100% -> 完成
        7. 记录成功日志
    若任何步骤抛出异常，则捕获异常并记录错误日志，然后重新抛出以终止脚本。
    """
    # 记录脚本启动信息（级别 info）
    send_log("Script started", "info")
    
    try:
        # 阶段1：初始化，进度 0%
        send_progress("Initializing...", 0)
        time.sleep(1)                     # 模拟初始化耗时操作
        
        # 阶段2：处理中，进度 50%
        send_progress("Processing...", 50)
        time.sleep(1)                     # 模拟处理耗时操作
        
        # 阶段3：完成，进度 100%
        send_progress("Completed", 100)
        
        # 记录执行成功日志（级别 success）
        send_log("Execution successful!", "success")
        
    except Exception as e:
        # 若发生任何异常，记录错误日志，包含异常信息
        send_log(f"Execution failed: {str(e)}", "error")
        # 重新抛出异常，以便外部调用者或系统捕获，保证脚本以非零状态退出
        raise


if __name__ == "__main__":
    # 当脚本作为主程序直接运行时，调用 main 函数
    main()