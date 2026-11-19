import sys
import json
import time
import os

EVENTS_FILE = os.path.join(os.path.dirname(__file__), '..', 'events', 'events.jsonl')

def log_event(event_type, details="", session_id="antigravity_session_default", **kwargs):
    event = {
        "ts": time.time(),
        "event": event_type,
        "session_id": session_id,
        "detail": details,
        "cwd": os.getcwd(),
        **kwargs
    }
    
    os.makedirs(os.path.dirname(EVENTS_FILE), exist_ok=True)
    with open(EVENTS_FILE, 'a', encoding='utf-8') as f:
        f.write(json.dumps(event) + '\n')
    print(f"Event logged: {event_type}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python dashboard-log.py <event_type> [details] [session_id] [key=value...]")
        sys.exit(1)
        
    etype = sys.argv[1]
    det = sys.argv[2] if len(sys.argv) > 2 else ""
    sid = sys.argv[3] if len(sys.argv) > 3 else "antigravity_session_default"
    
    extra = {}
    for arg in sys.argv[4:]:
        if '=' in arg:
            k, v = arg.split('=', 1)
            # Try to parse as bool or int
            if v.lower() == 'true': v = True
            elif v.lower() == 'false': v = False
            else:
                try: v = int(v)
                except: pass
            extra[k] = v
            
    log_event(etype, det, sid, **extra)
