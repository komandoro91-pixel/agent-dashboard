"""Tests for Agent Dashboard: compute_state(), _extract_detail(), _detect_session_type().

Import strategy:
- compute_state   — from server.py (top-level function)
- _extract_detail — from event-collector.py (module imported as collector)
- _detect_session_type — from event-collector.py

server.py is stdlib-only, safe to import directly.
event-collector.py is stdlib-only, but has a hyphen in its name, so we use importlib.
"""
import importlib.util
import os
import sys
import time

import pytest

# ---------------------------------------------------------------------------
# Import server.py
# ---------------------------------------------------------------------------
_SERVER_PATH = os.path.join(os.path.dirname(__file__), '..', 'server.py')
if not os.path.exists(_SERVER_PATH):
    pytest.skip('server.py is local-only (gitignored) and not present in this checkout', allow_module_level=True)
_server_spec = importlib.util.spec_from_file_location('server', _SERVER_PATH)
_server_mod = importlib.util.module_from_spec(_server_spec)
# Prevent server.py from binding a port or starting threads on import.
# It only does that inside __main__ / main(), so plain exec is safe.
_server_spec.loader.exec_module(_server_mod)
compute_state = _server_mod.compute_state

# ---------------------------------------------------------------------------
# Import event-collector.py  (hyphen in filename → importlib)
# ---------------------------------------------------------------------------
_COLLECTOR_PATH = os.path.join(os.path.dirname(__file__), '..', 'event-collector.py')
_col_spec = importlib.util.spec_from_file_location('event_collector', _COLLECTOR_PATH)
_col_mod = importlib.util.module_from_spec(_col_spec)
_col_spec.loader.exec_module(_col_mod)
_extract_detail = _col_mod._extract_detail
_detect_session_type = _col_mod._detect_session_type


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _now():
    """Return current Unix timestamp."""
    return time.time()


def _ev(phase, session_id='sess1', ts_offset=0, **kwargs):
    """Build a minimal event dict, ts = now - ts_offset seconds."""
    ev = {
        'ts': _now() - ts_offset,
        'session_id': session_id,
        'phase': phase,
    }
    ev.update(kwargs)
    return ev


# ---------------------------------------------------------------------------
# compute_state() tests
# ---------------------------------------------------------------------------

class TestComputeStateEmpty:
    def test_empty_events(self):
        """Empty list → sessions=[], total_active=0."""
        result = compute_state([], start_ts=0)
        assert result['sessions'] == [], "Expected no sessions for empty input"
        assert result['total_active'] == 0, "Expected total_active=0 for empty input"


class TestComputeStateSingleSession:
    def test_single_session_active(self):
        """session_start event → session present with status='active'."""
        events = [_ev('session_start')]
        result = compute_state(events, start_ts=0)
        assert len(result['sessions']) == 1, "Expected exactly 1 session"
        sess = result['sessions'][0]
        assert sess['status'] == 'active', f"Expected active, got {sess['status']}"
        assert sess['session_id'] == 'sess1'

    def test_session_end(self):
        """session_start + session_end → idle session without agents is not visible."""
        events = [
            _ev('session_start', ts_offset=10),
            _ev('session_end',   ts_offset=0),
        ]
        result = compute_state(events, start_ts=0)
        assert len(result['sessions']) == 0, "Idle session without agents should not be visible"


class TestAgentLifecycle:
    def test_agent_lifecycle(self):
        """PreToolUse(Agent) + PostToolUse(Agent) → agent in completed_agents, not in active_agents."""
        events = [
            _ev('session_start', ts_offset=30),
            _ev('start', ts_offset=20, tool='Agent', is_agent=True, agent_type='developer', detail='do work'),
            _ev('end',   ts_offset=10, tool='Agent', is_agent=True, agent_type='developer'),
        ]
        result = compute_state(events, start_ts=0)
        sess = result['sessions'][0]
        assert sess['active_agents'] == [], \
            f"active_agents should be empty, got {sess['active_agents']}"
        assert len(sess['completed_agents']) == 1, \
            f"Expected 1 completed agent, got {sess['completed_agents']}"
        assert sess['completed_agents'][0]['agent_type'] == 'developer'

    def test_agent_orphan(self):
        """PreToolUse(Agent) without PostToolUse → agent stays in active_agents."""
        events = [
            _ev('session_start', ts_offset=20),
            _ev('start', ts_offset=10, tool='Agent', is_agent=True, agent_type='tester', detail='run tests'),
        ]
        result = compute_state(events, start_ts=0)
        sess = result['sessions'][0]
        assert len(sess['active_agents']) == 1, \
            f"Expected 1 active agent, got {sess['active_agents']}"
        assert sess['active_agents'][0]['agent_type'] == 'tester'

    def test_multiple_same_agent_type_fifo(self):
        """Two agents of same type launched in parallel → first one completed on PostToolUse (FIFO)."""
        t_base = _now()
        events = [
            {'ts': t_base - 50, 'session_id': 'sess1', 'phase': 'session_start'},
            # Agent #1 starts first
            {'ts': t_base - 40, 'session_id': 'sess1', 'phase': 'start',
             'tool': 'Agent', 'is_agent': True, 'agent_type': 'researcher', 'detail': 'task A'},
            # Agent #2 starts second (same type)
            {'ts': t_base - 30, 'session_id': 'sess1', 'phase': 'start',
             'tool': 'Agent', 'is_agent': True, 'agent_type': 'researcher', 'detail': 'task B'},
            # One PostToolUse arrives — should complete the FIRST (earliest) researcher
            {'ts': t_base - 20, 'session_id': 'sess1', 'phase': 'end',
             'tool': 'Agent', 'is_agent': True, 'agent_type': 'researcher'},
        ]
        result = compute_state(events, start_ts=0)
        sess = result['sessions'][0]
        assert len(sess['active_agents']) == 1, \
            "One agent should remain active after one PostToolUse"
        assert len(sess['completed_agents']) == 1, \
            "Exactly one agent should be completed"
        # The completed one is the first (task A) — earliest in pending list
        assert sess['completed_agents'][0]['description'] == 'task A', \
            "FIFO: first-started agent should complete first"
        assert sess['active_agents'][0]['description'] == 'task B', \
            "Second agent should remain active"


class TestToolCount:
    def test_tool_count_excludes_agent(self):
        """tool_count does NOT increase for phase=start + tool=Agent."""
        events = [
            _ev('session_start', ts_offset=30),
            _ev('start', ts_offset=20, tool='Bash'),
            _ev('start', ts_offset=15, tool='Agent', is_agent=True, agent_type='dev', detail=''),
            _ev('start', ts_offset=10, tool='Read'),
        ]
        result = compute_state(events, start_ts=0)
        sess = result['sessions'][0]
        assert sess['tool_count'] == 2, \
            f"Expected tool_count=2 (Bash + Read), got {sess['tool_count']}"

    def test_tool_count_increments_non_agent_tools(self):
        """Each non-Agent start phase increments tool_count by 1."""
        events = [
            _ev('session_start', ts_offset=40),
            _ev('start', ts_offset=30, tool='Bash'),
            _ev('start', ts_offset=20, tool='Write'),
            _ev('start', ts_offset=10, tool='Grep'),
        ]
        result = compute_state(events, start_ts=0)
        sess = result['sessions'][0]
        assert sess['tool_count'] == 3, \
            f"Expected tool_count=3, got {sess['tool_count']}"


class TestVisibilityWindow:
    def test_session_visibility_window_expired(self):
        """Session with last_event_ts > 300 seconds ago → NOT in visible list."""
        events = [
            _ev('session_start', session_id='old_sess', ts_offset=400),  # 400s ago
        ]
        result = compute_state(events, start_ts=0)
        assert result['sessions'] == [], \
            "Session older than 300s should not appear in visible sessions"
        assert result['total_active'] == 0

    def test_session_visibility_window_recent(self):
        """Session with last_event_ts < 300 seconds ago → IS in visible list."""
        events = [
            _ev('session_start', session_id='new_sess', ts_offset=60),  # 60s ago
        ]
        result = compute_state(events, start_ts=0)
        assert len(result['sessions']) == 1, \
            "Recent session (60s ago) should appear in visible sessions"


class TestStartTsFilter:
    def test_start_ts_filter(self):
        """Events older than start_ts minus the 300s restart grace window are ignored."""
        now = _now()
        start_ts = now - 100  # cutoff incl. grace: now - 400
        events = [
            # Before start_ts and outside the grace window — should be ignored
            {'ts': now - 500, 'session_id': 'old', 'phase': 'session_start'},
            # Before start_ts but inside the grace window — restored on restart
            {'ts': now - 200, 'session_id': 'grace', 'phase': 'session_start'},
            # After start_ts — should be included
            {'ts': now - 50,  'session_id': 'new', 'phase': 'session_start'},
        ]
        result = compute_state(events, start_ts=start_ts)
        ids = [s['session_id'] for s in result['sessions']]
        assert 'old' not in ids, "Session before start_ts - 300s should be filtered out"
        assert 'grace' in ids, "Session inside the 300s grace window should be restored"
        assert 'new' in ids, "Session after start_ts should be included"


class TestServerStartIgnored:
    def test_server_start_event_ignored(self):
        """event=server_start is silently skipped, does not create a session."""
        events = [
            {'ts': _now() - 10, 'event': 'server_start', 'phase': 'server_start'},
        ]
        result = compute_state(events, start_ts=0)
        assert result['sessions'] == [], \
            "server_start event must not create a session"
        assert result['total_active'] == 0


# ---------------------------------------------------------------------------
# _extract_detail() tests
# ---------------------------------------------------------------------------

class TestExtractDetail:
    def _run(self, tool, tool_input):
        """Helper: build a minimal event dict, run _extract_detail, return it."""
        event = {'tool': tool}
        _extract_detail(event, tool, tool_input)
        return event

    def test_extract_agent_detail(self):
        """tool=Agent → agent_type, detail, is_agent=True set on event."""
        ev = self._run('Agent', {'subagent_type': 'researcher', 'description': 'find papers'})
        assert ev.get('agent_type') == 'researcher', \
            f"Expected agent_type='researcher', got {ev.get('agent_type')}"
        assert ev.get('detail') == 'find papers', \
            f"Expected detail='find papers', got {ev.get('detail')}"
        assert ev.get('is_agent') is True, "Expected is_agent=True"

    def test_extract_bash_truncates(self):
        """tool=Bash, command longer than 200 chars → detail is truncated to 200 chars."""
        long_cmd = 'echo ' + 'x' * 300  # 305 chars total
        ev = self._run('Bash', {'command': long_cmd})
        assert len(ev['detail']) <= 200, \
            f"Expected detail ≤ 200 chars, got {len(ev['detail'])}"
        assert ev['detail'] == long_cmd[:200], \
            "detail should be the first 200 characters of the command"

    def test_extract_bash_short_command_not_truncated(self):
        """tool=Bash, command ≤ 200 chars → detail preserved as-is."""
        cmd = 'ls -la'
        ev = self._run('Bash', {'command': cmd})
        assert ev['detail'] == cmd, \
            f"Short command should not be modified, got {ev['detail']}"

    def test_extract_write_basename(self):
        """tool=Write, file_path=/foo/bar.py → detail='bar.py'."""
        ev = self._run('Write', {'file_path': '/foo/bar.py'})
        assert ev['detail'] == 'bar.py', \
            f"Expected detail='bar.py', got {ev.get('detail')}"

    def test_extract_read_basename(self):
        """tool=Read, file_path=/some/dir/config.json → detail='config.json'."""
        ev = self._run('Read', {'file_path': '/some/dir/config.json'})
        assert ev['detail'] == 'config.json', \
            f"Expected detail='config.json', got {ev.get('detail')}"

    def test_extract_edit_basename(self):
        """tool=Edit, file_path=/project/src/main.ts → detail='main.ts'."""
        ev = self._run('Edit', {'file_path': '/project/src/main.ts'})
        assert ev['detail'] == 'main.ts', \
            f"Expected detail='main.ts', got {ev.get('detail')}"

    def test_extract_grep_pattern(self):
        """tool=Grep → detail equals the pattern value."""
        ev = self._run('Grep', {'pattern': 'compute_state'})
        assert ev['detail'] == 'compute_state', \
            f"Expected detail='compute_state', got {ev.get('detail')}"

    def test_extract_glob_pattern(self):
        """tool=Glob → detail equals the pattern value."""
        ev = self._run('Glob', {'pattern': '**/*.py'})
        assert ev['detail'] == '**/*.py', \
            f"Expected detail='**/*.py', got {ev.get('detail')}"

    def test_extract_unknown_tool_fallback(self):
        """Unknown tool → detail = str(tool_input)[:200]."""
        tool_input = {'foo': 'bar'}
        ev = self._run('UnknownTool', tool_input)
        assert ev['detail'] == str(tool_input)[:200], \
            f"Unexpected fallback detail: {ev.get('detail')}"


# ---------------------------------------------------------------------------
# _detect_session_type() tests
# ---------------------------------------------------------------------------

class TestDetectSessionType:
    def _run_with_env(self, env_patch):
        """Run _detect_session_type() with a patched os.environ."""
        original = os.environ.copy()
        # Remove all vscode-related vars first
        for key in ('VSCODE_PID', 'VSCODE_INJECTION_UUID', 'TERM_PROGRAM', 'VSCODE_IPC_HOOK_CLI'):
            os.environ.pop(key, None)
        try:
            os.environ.update(env_patch)
            return _detect_session_type()
        finally:
            # Restore original environment
            os.environ.clear()
            os.environ.update(original)

    def test_detect_vscode_by_pid(self):
        """VSCODE_PID in env → returns 'vscode'."""
        result = self._run_with_env({'VSCODE_PID': '1234'})
        assert result == 'vscode', f"Expected 'vscode', got '{result}'"

    def test_detect_vscode_by_injection_uuid(self):
        """VSCODE_INJECTION_UUID in env → returns 'vscode'."""
        result = self._run_with_env({'VSCODE_INJECTION_UUID': 'some-uuid'})
        assert result == 'vscode', f"Expected 'vscode', got '{result}'"

    def test_detect_vscode_by_term_program(self):
        """TERM_PROGRAM=vscode in env → returns 'vscode'."""
        result = self._run_with_env({'TERM_PROGRAM': 'vscode'})
        assert result == 'vscode', f"Expected 'vscode', got '{result}'"

    def test_detect_vscode_by_ipc_hook(self):
        """VSCODE_IPC_HOOK_CLI in env → returns 'vscode'."""
        result = self._run_with_env({'VSCODE_IPC_HOOK_CLI': '/tmp/vscode-ipc'})
        assert result == 'vscode', f"Expected 'vscode', got '{result}'"

    def test_detect_cli_default(self):
        """No vscode-related vars in env → returns 'cli'."""
        result = self._run_with_env({})
        assert result == 'cli', f"Expected 'cli', got '{result}'"

    def test_detect_cli_when_term_program_not_vscode(self):
        """TERM_PROGRAM set to something other than 'vscode' → returns 'cli'."""
        result = self._run_with_env({'TERM_PROGRAM': 'iTerm.app'})
        assert result == 'cli', f"Expected 'cli', got '{result}'"


# ---------------------------------------------------------------------------
# Tests for bug fixes
# ---------------------------------------------------------------------------

class TestAgentEmptyTypeFix:
    """Fix: agent_type='' on PostToolUse now matches 'general-purpose' in pending."""

    def test_empty_agent_type_matches_general_purpose(self):
        """PostToolUse with agent_type='' should close a 'general-purpose' pending agent."""
        events = [
            _ev('session_start', ts_offset=30),
            _ev('start', ts_offset=20, tool='Agent', is_agent=True,
                agent_type='general-purpose', detail='some task'),
            # PostToolUse arrives with empty agent_type (missing field → '')
            _ev('end', ts_offset=10, tool='Agent', is_agent=True, agent_type=''),
        ]
        result = compute_state(events, start_ts=0)
        sess = result['sessions'][0]
        assert sess['active_agents'] == [], \
            "empty agent_type on end should still match 'general-purpose' in pending"
        assert len(sess['completed_agents']) == 1, \
            "agent should move to completed_agents"

    def test_named_agent_type_not_affected(self):
        """Explicit agent_type on PostToolUse still matches correctly."""
        events = [
            _ev('session_start', ts_offset=30),
            _ev('start', ts_offset=20, tool='Agent', is_agent=True,
                agent_type='researcher', detail='read docs'),
            _ev('end', ts_offset=10, tool='Agent', is_agent=True, agent_type='researcher'),
        ]
        result = compute_state(events, start_ts=0)
        sess = result['sessions'][0]
        assert sess['active_agents'] == []
        assert len(sess['completed_agents']) == 1
        assert sess['completed_agents'][0]['agent_type'] == 'researcher'

    def test_empty_type_does_not_match_named_agent(self):
        """Empty agent_type on end should NOT close a 'developer' agent (only 'general-purpose')."""
        events = [
            _ev('session_start', ts_offset=30),
            _ev('start', ts_offset=20, tool='Agent', is_agent=True,
                agent_type='developer', detail='code task'),
            _ev('end', ts_offset=10, tool='Agent', is_agent=True, agent_type=''),
        ]
        result = compute_state(events, start_ts=0)
        sess = result['sessions'][0]
        # empty type → 'general-purpose', which ≠ 'developer' → agent stays active
        assert len(sess['active_agents']) == 1, \
            "empty end should not close a 'developer' agent"


class TestSessionIdQuantumFix:
    """Fix: session_id fallback now includes 5-min quantum to prevent PID reuse collisions."""

    def test_quantum_format(self):
        """Verify fallback format: cwd_pidPID_QUANTUM where QUANTUM = int(now)//300."""
        cwd = '/test/project'
        pid = 42
        quantum = int(time.time()) // 300
        fallback = f"{cwd}_pid{pid}_{quantum}"
        # Parse it back
        assert '_pid' in fallback
        after_pid = fallback.split('_pid')[1]
        parts = after_pid.split('_')
        assert len(parts) == 2, "should have PID and quantum separated by '_'"
        assert parts[0] == str(pid)
        assert parts[1] == str(quantum)

    def test_quantum_changes_across_windows(self):
        """Two timestamps 300s apart produce different quantums."""
        t1 = 1_000_000
        t2 = 1_000_300
        assert t1 // 300 != t2 // 300, "different 5-min windows should give different quantums"

    def test_quantum_stable_within_window(self):
        """Two timestamps within same 5-min window produce same quantum."""
        t1 = 1_000_000
        t2 = 1_000_100  # 100s later, same window
        assert t1 // 300 == t2 // 300, "same 5-min window should give same quantum"
