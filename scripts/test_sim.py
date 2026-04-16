import time
import subprocess
import os

SCRIPT_PATH = os.path.join(os.path.dirname(__file__), 'dashboard-log.py')
SID = "antigravity_session_sim"

def log(etype, detail, **kwargs):
    cmd = [
        "python", SCRIPT_PATH, 
        etype, detail, SID
    ]
    for k, v in kwargs.items():
        cmd.append(f"{k}={v}")
    subprocess.run(cmd)

def run_sim():
    print("Starting simulation...")
    # Start Orchestrator
    log("session_start", "Reviewing project documentation", session_type="orchestrator", phase="session_start")
    
    agents = [
        ("researcher", "Reading Architecture docs"),
        ("reviewer", "Analyzing security guidelines"),
        ("analyst", "Deep dive into business logic"),
        ("tester", "Verifying test coverage docs"),
        ("senior-developer", "Conceptualizing global refactoring")
    ]
    
    for role, task in agents:
        print(f"Spawning {role}...")
        log("start", task, is_agent=True, agent_type=role, detail=task)
        time.sleep(25) # visible for 25 seconds
        log("end", f"Finished {task}", is_agent=True, agent_type=role, detail=f"Done: {task}")
        time.sleep(2) # brief pause
        
    print("Simulation complete.")

if __name__ == "__main__":
    run_sim()
