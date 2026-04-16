import time
import subprocess
import os
import sys

# Ensure UTF-8 output
if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except: pass

SCRIPT_PATH = os.path.join(os.path.dirname(__file__), 'dashboard-log.py')
SID = 'antigravity_session_loop'

def log(etype, detail, **kwargs):
    cmd = [sys.executable, SCRIPT_PATH, etype, detail, SID]
    for k, v in kwargs.items():
        cmd.append(f"{k}={v}")
    subprocess.run(cmd)

def run_loop():
    print("Starting reliable endless simulation (v15)...")
    log("session_start", "Real-time orchestration demo", session_type="orchestrator", phase="session_start")
    
    agents = [
        ("researcher", "Scanning logs"),
        ("analyst", "Pattern matching"),
        ("tester", "Unit tests"),
        ("devops", "Deploying fixes"),
        ("security", "Audit trails")
    ]
    
    while True:
        for role, task in agents:
            print(f"Spawning {role}...")
            log("start", task, is_agent=True, agent_type=role)
            time.sleep(15)
            log("end", f"Finished: {task}", is_agent=True, agent_type=role)
            time.sleep(2)

if __name__ == "__main__":
    run_loop()
