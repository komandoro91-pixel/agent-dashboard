import os, json, time, subprocess, sys, argparse
from datetime import datetime

# Paths
OBSIDIAN_BASE = r"D:\Obsidian\ClaudeLocalSetup"
HANDOFF_FILE = os.path.join(OBSIDIAN_BASE, "HANDOFF.md")
SESSION_STATE_FILE = os.path.join(OBSIDIAN_BASE, "SESSION_STATE.md")
COST_SCRIPT = r"D:\Claude\scripts\session-cost.py"
EVENTS_FILE = r"D:\projects\agent-dashboard\events\events.jsonl"

# Ensure UTF-8 output
if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

def get_session_cost():
    try:
        result = subprocess.run([sys.executable, COST_SCRIPT], capture_output=True, check=True)
        return result.stdout.decode('utf-8').strip()
    except Exception:
        return "(ошибка получения стоимости)"

def update_handoff(date_str, summary, next_step):
    content = f"""# HANDOFF — {date_str}

## Что делали
{summary}

## Статус
✓ Выполнено

## Следующий шаг
{next_step}

## Контекст
Antigravity Orchestration, agent-dashboard.
"""
    with open(HANDOFF_FILE, "w", encoding="utf-8") as f:
        f.write(content)

def update_session_state(date_str, project, task, summary, next_step):
    # Try to keep the project table
    table = ""
    if os.path.exists(SESSION_STATE_FILE):
        with open(SESSION_STATE_FILE, "r", encoding="utf-8") as f:
            lines = f.readlines()
            for i, line in enumerate(lines):
                if "## Активные проекты" in line:
                    table = "".join(lines[i:])
                    break
    
    if not table:
        table = "## Активные проекты\n| Проект | Статус | Путь |\n|---|---|---|\n| agent-dashboard | Активен | `d:/projects/agent-dashboard/` |"

    content = f"""# Session State

**Последнее обновление:** {date_str}

## Последняя сессия

**Проект:** {project}
**Задача:** {task}
**Статус:** ✅ Завершена

## Что сделано
{summary}

## Следующий шаг
{next_step}

{table}
"""
    with open(SESSION_STATE_FILE, "w", encoding="utf-8") as f:
        f.write(content)

def stop_dashboard_session():
    event = {
        "ts": time.time(),
        "event": "Stop",
        "phase": "session_end",
        "session_id": "antigravity_session_default",
        "detail": "Orbit Wrap-up completed",
        "cwd": os.getcwd()
    }
    try:
        os.makedirs(os.path.dirname(EVENTS_FILE), exist_ok=True)
        with open(EVENTS_FILE, 'a', encoding='utf-8') as f:
            f.write(json.dumps(event) + '\n')
    except Exception:
        pass

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", default="agent-dashboard")
    parser.add_argument("--task", required=True)
    parser.add_argument("--summary", required=True)
    parser.add_argument("--next", required=True)
    args = parser.parse_args()

    date_str = datetime.now().strftime("%Y-%m-%d")
    cost_info = get_session_cost()

    update_handoff(date_str, args.summary, args.next)
    update_session_state(date_str, args.project, args.task, args.summary, args.next)
    stop_dashboard_session()

    print("\n--- Orbit Wrap-up ---")
    print(f"✓ Проект: {args.project}")
    print(f"✓ Задача: {args.task}")
    print(f"✓ {args.summary}")
    print(f"→ {args.next}")
    print(f"💰 {cost_info}")
    print("---------------------\n")

if __name__ == "__main__":
    main()
