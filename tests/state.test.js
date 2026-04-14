'use strict';

jest.mock('@upstash/redis', () => ({ Redis: jest.fn() }));

const { computeState } = require('../api/state');

function now() { return Date.now() / 1000; }

function ev(phase, { session_id = 'sess1', tsOffset = 0, cwd = '/unique-' + session_id, session_type = 'vscode', ...extra } = {}) {
  return { ts: now() - tsOffset, session_id, phase, cwd, session_type, ...extra };
}

// ---------------------------------------------------------------------------
// 1. session_end → session disappears from visible
// ---------------------------------------------------------------------------

describe('session_end: genie stays visible (idle between responses)', () => {
  it('recent session_end is still visible with idle status, excluded from total_active', () => {
    const events = [
      ev('session_start', { session_id: 'sess1', tsOffset: 10 }),
      ev('session_end',   { session_id: 'sess1', tsOffset: 1 }),
    ];
    const result = computeState(events, 0);
    const ids = result.sessions.map(s => s.session_id);
    expect(ids).toContain('sess1');
    expect(result.sessions[0].status).toBe('ended');
    expect(result.total_active).toBe(0);
  });

  it('ended session with active agents remains visible', () => {
    const base = now();
    const events = [
      { ts: base - 30, session_id: 'sess1', phase: 'session_start', cwd: '/proj', session_type: 'vscode' },
      { ts: base - 20, session_id: 'sess1', phase: 'start', tool: 'Agent', is_agent: true, agent_type: 'developer', detail: 'task', cwd: '/proj', session_type: 'vscode' },
      { ts: base - 10, session_id: 'sess1', phase: 'session_end', cwd: '/proj', session_type: 'vscode' },
    ];
    const result = computeState(events, 0);
    expect(result.sessions.length).toBe(1);
    expect(result.active_penguins.length).toBe(1);
    expect(result.active_penguins[0].agent_type).toBe('developer');
  });

  it('session_end on one session does not affect another active session; both remain visible', () => {
    const events = [
      ev('session_start', { session_id: 'ended', cwd: '/proj-ended', tsOffset: 20 }),
      ev('session_end',   { session_id: 'ended', cwd: '/proj-ended', tsOffset: 5 }),
      ev('session_start', { session_id: 'alive', cwd: '/proj-alive', tsOffset: 15 }),
    ];
    const result = computeState(events, 0);
    const ids = result.sessions.map(s => s.session_id);
    expect(ids).toContain('alive');
    expect(ids).toContain('ended'); // idle session stays visible until 5-min timeout
    expect(result.total_active).toBe(1); // only 'alive' counts as active
  });
});

// ---------------------------------------------------------------------------
// 2. Regression: session_end mid-session reactivation via phase=start
// ---------------------------------------------------------------------------

describe('session_end then phase=start reactivates session (regression)', () => {
  it('phase=start after session_end sets status=active and makes session visible', () => {
    const events = [
      ev('session_start', { session_id: 'sess1', tsOffset: 30 }),
      ev('session_end',   { session_id: 'sess1', tsOffset: 20 }),
      ev('start', { session_id: 'sess1', tsOffset: 5, tool: 'Bash' }),
    ];
    const result = computeState(events, 0);
    const sess = result.sessions.find(s => s.session_id === 'sess1');
    expect(sess).toBeDefined();
    expect(sess.status).toBe('active');
  });

  it('phase=start after session_end increments tool_count correctly', () => {
    const events = [
      ev('session_start', { session_id: 'sess1', tsOffset: 30 }),
      ev('start', { session_id: 'sess1', tsOffset: 25, tool: 'Read' }),
      ev('session_end',   { session_id: 'sess1', tsOffset: 20 }),
      ev('start', { session_id: 'sess1', tsOffset: 5, tool: 'Write' }),
    ];
    const result = computeState(events, 0);
    const sess = result.sessions.find(s => s.session_id === 'sess1');
    expect(sess.tool_count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 3. Dedup: same cwd+session_type within 5s → merged into 1 visible session
// (VS Code dual-process starts within milliseconds, not minutes)
// ---------------------------------------------------------------------------

describe('deduplication: same cwd+type within 5s', () => {
  it('two sessions with same cwd+type started 2s apart → 1 visible session', () => {
    const base = now();
    const events = [
      { ts: base - 10, session_id: 'primary', phase: 'session_start', cwd: '/proj', session_type: 'vscode' },
      { ts: base - 2,  session_id: 'primary', phase: 'start', tool: 'Bash', cwd: '/proj', session_type: 'vscode' },
      { ts: base - 8,  session_id: 'dup',     phase: 'session_start', cwd: '/proj', session_type: 'vscode' },
      { ts: base - 7,  session_id: 'dup',     phase: 'start', tool: 'Read', cwd: '/proj', session_type: 'vscode' },
    ];
    const result = computeState(events, 0);
    expect(result.sessions.length).toBe(1);
  });

  it('merged session has combined tool_count from both sessions', () => {
    const base = now();
    const events = [
      { ts: base - 10, session_id: 'primary', phase: 'session_start', cwd: '/proj', session_type: 'vscode' },
      { ts: base - 9,  session_id: 'primary', phase: 'start', tool: 'Bash', cwd: '/proj', session_type: 'vscode' },
      { ts: base - 8,  session_id: 'primary', phase: 'start', tool: 'Read', cwd: '/proj', session_type: 'vscode' },
      { ts: base - 2,  session_id: 'primary', phase: 'start', tool: 'Write', cwd: '/proj', session_type: 'vscode' },
      { ts: base - 7,  session_id: 'dup',     phase: 'session_start', cwd: '/proj', session_type: 'vscode' },
      { ts: base - 6,  session_id: 'dup',     phase: 'start', tool: 'Grep', cwd: '/proj', session_type: 'vscode' },
    ];
    const result = computeState(events, 0);
    expect(result.sessions[0].tool_count).toBe(4);
  });

  it('dedup picks the session with the most recent last_event_ts as primary', () => {
    const base = now();
    const events = [
      { ts: base - 25, session_id: 'older', phase: 'session_start', cwd: '/proj', session_type: 'cli' },
      { ts: base - 20, session_id: 'older', phase: 'start', tool: 'Bash', cwd: '/proj', session_type: 'cli' },
      { ts: base - 22, session_id: 'newer', phase: 'session_start', cwd: '/proj', session_type: 'cli' },
      { ts: base - 5,  session_id: 'newer', phase: 'start', tool: 'Read', cwd: '/proj', session_type: 'cli' },
    ];
    const result = computeState(events, 0);
    expect(result.sessions.length).toBe(1);
    expect(result.sessions[0].session_id).toBe('newer');
  });
});

// ---------------------------------------------------------------------------
// 4. Dedup: same cwd+type but > 5s apart → NOT merged (parallel sessions)
// ---------------------------------------------------------------------------

describe('deduplication: same cwd+type more than 5s apart — not merged', () => {
  it('two sessions with same cwd+type started 10s apart → both visible', () => {
    // Parallel Claude sessions from same cwd but started 10s apart → NOT VS Code dups.
    const base = now();
    const events = [
      { ts: base - 20, session_id: 'first',  phase: 'session_start', cwd: '/proj', session_type: 'vscode' },
      { ts: base - 2,  session_id: 'first',  phase: 'start', tool: 'Bash', cwd: '/proj', session_type: 'vscode' },
      { ts: base - 10, session_id: 'second', phase: 'session_start', cwd: '/proj', session_type: 'vscode' },
      { ts: base - 1,  session_id: 'second', phase: 'start', tool: 'Read', cwd: '/proj', session_type: 'vscode' },
    ];
    const result = computeState(events, 0);
    expect(result.sessions.length).toBe(2);
  });

  it('sessions exactly 5s apart are NOT merged (boundary: strict < 5)', () => {
    // Difference = 5 — not strictly less than 5 → must NOT merge.
    const base = now();
    const events = [
      { ts: base - 15, session_id: 'a', phase: 'session_start', cwd: '/proj', session_type: 'cli' },
      { ts: base - 2,  session_id: 'a', phase: 'start', tool: 'Bash', cwd: '/proj', session_type: 'cli' },
      { ts: base - 10, session_id: 'b', phase: 'session_start', cwd: '/proj', session_type: 'cli' },
      { ts: base - 1,  session_id: 'b', phase: 'start', tool: 'Read', cwd: '/proj', session_type: 'cli' },
    ];
    const result = computeState(events, 0);
    expect(result.sessions.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 5. Session older than 300s is not visible (timeout)
// ---------------------------------------------------------------------------

describe('session timeout: older than 300s', () => {
  it('session with last_event_ts 301s ago is not visible', () => {
    const events = [ev('session_start', { session_id: 'old', tsOffset: 301 })];
    const result = computeState(events, 0);
    expect(result.sessions.length).toBe(0);
    expect(result.total_active).toBe(0);
  });

  it('session with last_event_ts exactly 300s ago is not visible (strict < 300)', () => {
    const events = [ev('session_start', { session_id: 'boundary', tsOffset: 300 })];
    const result = computeState(events, 0);
    expect(result.sessions.length).toBe(0);
  });

  it('session with last_event_ts 299s ago is visible', () => {
    const events = [ev('session_start', { session_id: 'fresh', tsOffset: 299 })];
    const result = computeState(events, 0);
    expect(result.sessions.length).toBe(1);
  });

  it('old session does not affect total_active count', () => {
    const events = [
      ev('session_start', { session_id: 'old',   cwd: '/proj-old',   tsOffset: 400 }),
      ev('session_start', { session_id: 'alive', cwd: '/proj-alive', tsOffset: 10 }),
    ];
    const result = computeState(events, 0);
    expect(result.total_active).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 6. session_start after session_end reactivates
// ---------------------------------------------------------------------------

describe('session_start after session_end reactivates session', () => {
  it('phase=session_start after session_end sets status=active and makes session visible', () => {
    const events = [
      ev('session_start', { session_id: 'sess1', tsOffset: 40 }),
      ev('session_end',   { session_id: 'sess1', tsOffset: 30 }),
      ev('session_start', { session_id: 'sess1', tsOffset: 5 }),
    ];
    const result = computeState(events, 0);
    const sess = result.sessions.find(s => s.session_id === 'sess1');
    expect(sess).toBeDefined();
    expect(sess.status).toBe('active');
  });

  it('session_start updates started_at to the new start time', () => {
    const base = now();
    const events = [
      { ts: base - 40, session_id: 'sess1', phase: 'session_start', cwd: '/proj', session_type: 'vscode' },
      { ts: base - 30, session_id: 'sess1', phase: 'session_end',   cwd: '/proj', session_type: 'vscode' },
      { ts: base - 5,  session_id: 'sess1', phase: 'session_start', cwd: '/proj', session_type: 'vscode' },
    ];
    const result = computeState(events, 0);
    const sess = result.sessions.find(s => s.session_id === 'sess1');
    expect(sess.started_at).toBeCloseTo(base - 5, 0);
  });
});

// ---------------------------------------------------------------------------
// 7. total_active count
// ---------------------------------------------------------------------------

describe('total_active count', () => {
  it('empty event list → total_active=0', () => {
    expect(computeState([], 0).total_active).toBe(0);
  });

  it('single active session → total_active=1', () => {
    const result = computeState([ev('session_start', { tsOffset: 10 })], 0);
    expect(result.total_active).toBe(1);
  });

  it('multiple active sessions with different cwd → total_active=3', () => {
    const events = [
      ev('session_start', { session_id: 'a', cwd: '/proj-a', tsOffset: 10 }),
      ev('session_start', { session_id: 'b', cwd: '/proj-b', tsOffset: 8 }),
      ev('session_start', { session_id: 'c', cwd: '/proj-c', tsOffset: 6 }),
    ];
    const result = computeState(events, 0);
    expect(result.total_active).toBe(3);
  });

  it('ended session is excluded from total_active', () => {
    const events = [
      ev('session_start', { session_id: 'active', cwd: '/proj-active', tsOffset: 10 }),
      ev('session_start', { session_id: 'done',   cwd: '/proj-done',   tsOffset: 20 }),
      ev('session_end',   { session_id: 'done',   cwd: '/proj-done',   tsOffset: 5 }),
    ];
    const result = computeState(events, 0);
    expect(result.total_active).toBe(1);
  });

  it('session with active agents counts toward total_active', () => {
    const base = now();
    const events = [
      { ts: base - 10, session_id: 'primary', phase: 'session_start', cwd: '/proj', session_type: 'cli' },
      { ts: base - 9,  session_id: 'primary', phase: 'start', tool: 'Agent', is_agent: true, agent_type: 'developer', detail: 'task', cwd: '/proj', session_type: 'cli' },
    ];
    const result = computeState(events, 0);
    expect(result.total_active).toBe(1);
  });

  it('expired sessions do not inflate total_active', () => {
    const events = [
      ev('session_start', { session_id: 'expired', cwd: '/proj-exp',  tsOffset: 400 }),
      ev('session_start', { session_id: 'live',    cwd: '/proj-live', tsOffset: 10 }),
    ];
    const result = computeState(events, 0);
    expect(result.total_active).toBe(1);
  });

  it('mix of active/ended/expired → total_active=2', () => {
    const events = [
      ev('session_start', { session_id: 'active1', cwd: '/proj-a1', tsOffset: 10 }),
      ev('session_start', { session_id: 'active2', cwd: '/proj-a2', tsOffset: 15 }),
      ev('session_start', { session_id: 'ended1',  cwd: '/proj-e1', tsOffset: 30 }),
      ev('session_end',   { session_id: 'ended1',  cwd: '/proj-e1', tsOffset: 5 }),
      ev('session_start', { session_id: 'old1',    cwd: '/proj-o1', tsOffset: 500 }),
    ];
    const result = computeState(events, 0);
    expect(result.total_active).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 8. active_penguins — flat list of active subagents across all sessions
// ---------------------------------------------------------------------------

describe('active_penguins', () => {
  it('response always has active_penguins array', () => {
    const result = computeState([], 0);
    expect(Array.isArray(result.active_penguins)).toBe(true);
  });

  it('agent started < 60s ago appears in active_penguins', () => {
    const base = now();
    const events = [
      { ts: base - 10, session_id: 's1', phase: 'session_start', cwd: '/proj', session_type: 'vscode' },
      { ts: base - 5,  session_id: 's1', phase: 'start', tool: 'Agent', is_agent: true, agent_type: 'developer', detail: 'fix bug', cwd: '/proj', session_type: 'vscode' },
    ];
    const result = computeState(events, 0);
    expect(result.active_penguins.length).toBe(1);
    expect(result.active_penguins[0].agent_type).toBe('developer');
  });

  it('agent started > 600s ago (TTL expired) is NOT in active_penguins', () => {
    const base = now();
    const events = [
      { ts: base - 700, session_id: 's1', phase: 'session_start', cwd: '/proj', session_type: 'vscode' },
      { ts: base - 601, session_id: 's1', phase: 'start', tool: 'Agent', is_agent: true, agent_type: 'researcher', detail: 'old task', cwd: '/proj', session_type: 'vscode' },
      { ts: base - 2,   session_id: 's1', phase: 'start', tool: 'Bash', cwd: '/proj', session_type: 'vscode' },
    ];
    const result = computeState(events, 0);
    expect(result.active_penguins.length).toBe(0);
  });

  it('completed agent (phase=end) is not in active_penguins', () => {
    const base = now();
    const events = [
      { ts: base - 20, session_id: 's1', phase: 'session_start', cwd: '/proj', session_type: 'vscode' },
      { ts: base - 15, session_id: 's1', phase: 'start', tool: 'Agent', is_agent: true, agent_type: 'tester', detail: 'run tests', cwd: '/proj', session_type: 'vscode' },
      { ts: base - 5,  session_id: 's1', phase: 'end',   tool: 'Agent', is_agent: true, agent_type: 'tester', cwd: '/proj', session_type: 'vscode' },
    ];
    const result = computeState(events, 0);
    expect(result.active_penguins.length).toBe(0);
  });

  it('two concurrent agents → two penguins', () => {
    const base = now();
    const events = [
      { ts: base - 20, session_id: 's1', phase: 'session_start', cwd: '/proj', session_type: 'vscode' },
      { ts: base - 15, session_id: 's1', phase: 'start', tool: 'Agent', is_agent: true, agent_type: 'developer', detail: 'feat A', cwd: '/proj', session_type: 'vscode' },
      { ts: base - 10, session_id: 's1', phase: 'start', tool: 'Agent', is_agent: true, agent_type: 'tester',    detail: 'test A', cwd: '/proj', session_type: 'vscode' },
    ];
    const result = computeState(events, 0);
    expect(result.active_penguins.length).toBe(2);
  });
});
