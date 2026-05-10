"""Local-only variant of parade_sim.py — targets localhost:3737 dev server.

Use this when smoke-testing dashboard changes on a local server.py instance
(typically launched from a worktree). The prod variant `parade_sim.py` posts
to the live Vercel deployment and must NOT be used against localhost — and
vice versa, this script must NOT be pointed at prod.

Override host via env: DASHBOARD_LOCAL_URL=http://localhost:NNNN/api/collect
"""

import json
import os
import time
import urllib.request

DASHBOARD_URL = os.environ.get(
    "DASHBOARD_LOCAL_URL",
    "http://localhost:3737/api/collect",
)
COLLECT_TOKEN = "komandordashboard"

assert "localhost" in DASHBOARD_URL or "127.0.0.1" in DASHBOARD_URL, (
    f"parade_sim_local.py target must be localhost (got {DASHBOARD_URL}). "
    "Use scripts/parade_sim.py for prod."
)

# One Claude session as the single orchestrator
MAIN_SESSION = "claude_parade_main"

# 10 agents: mix of Claude subagents + Gemini Scouts
AGENTS = [
    {"role": "researcher",        "provider": "claude",        "detail": "Scanning project docs"},
    {"role": "gemini-scout",      "provider": "gemini-scout",  "detail": "gemini-bridge --agent: find API patterns"},
    {"role": "senior-developer",  "provider": "claude",        "detail": "Architecting solution"},
    {"role": "gemini-scout",      "provider": "gemini-scout",  "detail": "gemini-bridge --agent: web search trends"},
    {"role": "reviewer",          "provider": "claude",        "detail": "Code review pass"},
    {"role": "gemini-scout",      "provider": "gemini-scout",  "detail": "gemini-bridge --agent: browse competitor"},
    {"role": "test-engineer",     "provider": "claude",        "detail": "Writing test suite"},
    {"role": "gemini-scout",      "provider": "gemini-scout",  "detail": "gemini-bridge --agent: scrape docs site"},
    {"role": "technical-writer",  "provider": "claude",        "detail": "Updating README"},
    {"role": "debugger",          "provider": "claude",        "detail": "Tracing root cause"},
]

def send_event(ev):
    try:
        data = json.dumps(ev).encode("utf-8")
        req = urllib.request.Request(
            DASHBOARD_URL, data=data,
            headers={"Content-Type": "application/json", "x-token": COLLECT_TOKEN},
            method="POST"
        )
        urllib.request.urlopen(req, timeout=2)
    except Exception as e:
        print(f"  [!] send error: {e}")

def spawn_agent(index, cfg):
    ts = time.time()
    send_event({
        "ts": ts,
        "event": "PreToolUse",
        "phase": "start",
        "session_id": MAIN_SESSION,
        "tool": "Agent",
        "is_agent": True,
        "agent_type": cfg["role"],
        "provider": cfg["provider"],
        "detail": cfg["detail"],
        "cwd": "d:/projects/agent-dashboard",
    })
    print(f"  [+] {cfg['role']} ({cfg['provider']}): {cfg['detail']}")
    return ts

def retire_agent(ts, cfg):
    send_event({
        "ts": time.time(),
        "event": "PostToolUse",
        "phase": "end",
        "session_id": MAIN_SESSION,
        "tool": "Agent",
        "is_agent": True,
        "agent_type": cfg["role"],
        "provider": cfg["provider"],
        "detail": cfg["detail"],
        "cwd": "d:/projects/agent-dashboard",
    })
    print(f"  [-] {cfg['role']} done")

def run_parade():
    print(f"--- Parade: 1 Claude genie + {len(AGENTS)} penguins ---")

    # Start main Claude session (genie)
    send_event({
        "ts": time.time(),
        "event": "SessionStart",
        "phase": "session_start",
        "session_id": MAIN_SESSION,
        "session_type": "vscode",
        "provider": "claude",
        "detail": "Parade orchestrator",
        "cwd": "d:/projects/agent-dashboard",
    })
    time.sleep(0.3)

    # Spawn all agents with slight stagger
    spawn_times = []
    for i, cfg in enumerate(AGENTS):
        ts = spawn_agent(i, cfg)
        spawn_times.append(ts)
        time.sleep(0.4)

    print(f"  All {len(AGENTS)} agents running — держи 35 сек...")
    time.sleep(35)

    # Retire all agents
    for ts, cfg in zip(spawn_times, AGENTS):
        retire_agent(ts, cfg)
        time.sleep(0.2)

    # End session
    send_event({
        "ts": time.time(),
        "event": "Stop",
        "phase": "session_end",
        "session_id": MAIN_SESSION,
        "cwd": "d:/projects/agent-dashboard",
    })
    print("--- Parade complete ---")

if __name__ == "__main__":
    run_parade()
