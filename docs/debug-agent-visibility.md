# Debug Report: Background Agents Not Visible on Dashboard

**Date:** 2026-03-25
**Symptom:** Active Agents counter = 0, penguins appear < 1 second then disappear, timeline shows SPAWN events

---

## Root Cause

**Two separate bugs in `api/state.js` interact to make background agents invisible within one polling cycle.**

---

## Bug 1 — Immediate despawn: `PostToolUse` fires for background agents before the next `fetchState()`

### Where

`api/state.js`, lines 57–68 (the `phase === 'end'` block):

```javascript
} else if (phase === 'end') {
  if (ev.is_agent && pending[sid]) {
    const agentType = ev.agent_type || '';
    const idx = pending[sid].findIndex(ag => ag.agent_type === agentType);
    if (idx >= 0) {
      const doneAg = pending[sid].splice(idx, 1)[0];
      doneAg.completed_at = ts;
      if (!completed[sid]) completed[sid] = [];
      completed[sid].push(doneAg);
    }
  }
}
```

### What happens for background agents

Background agents (tool = `Agent`, `run_in_background: true`) are different from foreground agents in a crucial way: **Claude Code emits both `PreToolUse` and `PostToolUse` for the Agent tool itself immediately, before the background agent does any work.** The background agent then runs autonomously in a separate session — but the *parent* session already received the `PostToolUse`.

The event sequence in the parent session's Redis log is:

```
PreToolUse  Agent  phase=start   is_agent=true   agent_type=X   ← adds to pending[]
PostToolUse Agent  phase=end     is_agent=true   agent_type=X   ← immediately removes from pending[]
```

Both events arrive in the same Redis batch. When `computeState()` replays them, the agent is added to `pending[sid]` and then immediately removed from `pending[sid]` and moved to `completed[sid]`. By the time `fetchState()` returns to the browser, `active_agents` is already empty.

### Why penguins appear for < 1 second

The *first* `fetchState()` poll (every 1500ms) might catch the agent mid-flight in a tiny timing window where the PreToolUse has arrived but PostToolUse has not yet been written to Redis. In that rare case `applyState()` calls `spawnPenguin()`. On the *next* poll (1500ms later) the PostToolUse is in Redis, `computeState()` returns `active_agents: []`, and `applyState()` calls `despawnPenguin()`. This explains the < 1 second flash.

---

## Bug 2 — `total_active` counts sessions, not agents

### Where

`api/state.js`, lines 78–80:

```javascript
const total_active = visible.filter(
  s => s.status === 'active' || s.active_agents.length > 0
).length;
```

`total_active` is the **count of active sessions**, not the count of active agents.

### Why `Active Agents = 0`

`renderMetrics()` in `public/index.html` line 1257:

```javascript
document.getElementById('metricAgents').textContent = currentState.total_active || 0;
```

Even if this were counting correctly, for background agents Bug 1 ensures `active_agents` is always empty, so `total_active` is 0 whenever there are no *foreground* agents. The metric label says "Active Agents" but the value is "active sessions" — a semantic mismatch regardless.

---

## Why Timeline DOES show SPAWN events

`fetchEvents()` reads from `/api/events` which returns raw events from Redis — it does not call `computeState()`. The `PreToolUse` event with `is_agent=true` is stored and returned verbatim. In `renderTimeline()` (line 1228):

```javascript
if (e.is_agent && e.phase === 'start') {
  badgeCls = 'tb-spawn'; badgeLabel = 'spawn';
}
```

This just checks the raw event, not computed state. So the timeline correctly shows SPAWN events even though `active_agents` is empty.

---

## Summary Table

| Symptom | Root cause | Code location |
|---|---|---|
| Penguins appear < 1s then vanish | PreToolUse + PostToolUse arrive in same Redis batch; agent is added then immediately removed from `pending[]` | `state.js:57–68` |
| Active Agents counter = 0 | `total_active` computed from `pending[]` which is always empty for background agents | `state.js:78–80` |
| Counter also semantically wrong | Counts sessions not agents | `state.js:78–80`, `index.html:1257` |
| Timeline shows SPAWN | Raw events read, not computed state | `events.js`, `index.html:1228` |

---

## Fix Options (ranked by simplicity)

### Option A — Track background agents by session_id of the spawned agent (Recommended)

**Complexity:** Medium. **Risk:** Low.

Background agents run in their own Claude Code session. They emit `SessionStart`, tool events, and `Stop` from their own `session_id`. The parent session that launched them emits `PreToolUse`/`PostToolUse` for the `Agent` tool.

**Fix:**
1. In `event-collector.py`, when `EventType == 'SessionStart'` and the session was spawned as a background agent, emit a flag: `event['is_background_agent'] = True`. This requires detecting the subagent context — e.g., via an env var Claude Code sets in subagent processes.
2. In `state.js`, treat sessions with `is_background_agent=true` as active agents of the *parent* session, linked by some shared identifier (project path, cwd, or explicit parent_session_id).

**Trade-offs:** Requires reliably detecting background agent sessions. Claude Code may not expose a `PARENT_SESSION_ID` env var. The cwd-based heuristic (child and parent share same cwd) is fragile when agents work in different directories.

---

### Option B — Don't remove agent from `pending[]` on PostToolUse; expire by timeout instead (Simplest)

**Complexity:** Low. **Risk:** Medium (stale agents if PostToolUse is never received for real termination).

**Fix in `state.js`:** Remove the `phase === 'end'` block that moves agents from `pending` to `completed`. Instead, expire agents based on timestamp: if `now - agent.started_at > N seconds`, move to completed.

```javascript
// Replace the phase==='end' removal block with time-based expiry:
// In the final loop after processing all events:
const AGENT_TIMEOUT_S = 300; // 5 minutes
for (const [sid, agents] of Object.entries(pending)) {
  const stillActive = agents.filter(ag => now - ag.started_at < AGENT_TIMEOUT_S);
  const expired = agents.filter(ag => now - ag.started_at >= AGENT_TIMEOUT_S);
  pending[sid] = stillActive;
  if (!completed[sid]) completed[sid] = [];
  completed[sid].push(...expired);
}
```

**Trade-offs:** Agents stay visible for up to 5 minutes even if they complete quickly. No immediate feedback that agent finished. Works for background agents because their `PreToolUse` is stored but expiry is time-based. Simple, no changes to `event-collector.py`.

---

### Option C — Separate `agent_key` tracking using timestamp + type (prevents immediate match)

**Complexity:** Low. **Risk:** Low.

The immediate removal in Bug 1 happens because `findIndex` matches by `agent_type` alone. If two agents of the same type run, the wrong one can be matched. The `PreToolUse` key is `${sid}_${ts}` but `PostToolUse` arrives with a *different* timestamp (a few ms later), so the keys never match — yet the current code matches by `agent_type` only.

The real fix for the matching is: **on `PostToolUse`, match by the closest `started_at` timestamp within a small window, not just by type.**

But this still doesn't solve the background agent problem — the PostToolUse *does* correctly correspond to the completion of the Agent tool call in the parent session. Background agents don't have a PostToolUse in their own session for the overall task.

**Trade-offs:** This only prevents wrong-agent matches with multiple same-type agents. It does not fix background agent visibility. Not a complete solution on its own.

---

## Recommended Fix

**Option B** for immediate unblocking, **Option A** as the correct long-term solution.

Option B is one change in `state.js` (remove 10 lines, add 8 lines). It makes all spawned agents stay visible until timeout. The user-visible downside (agents linger 5 minutes after completion) is acceptable given the current dashboard's purpose is monitoring *running* agents.

### Specific code changes for Option B

**File:** `D:/Claude/agent-dashboard/api/state.js`

1. Remove the `phase === 'end'` agent-removal block (lines 57–68).
2. After the events loop, add time-based expiry before building `sess.active_agents`.

**File:** `D:/Claude/agent-dashboard/api/state.js`, `total_active` (lines 78–80)

Fix semantic mismatch — count agents, not sessions:

```javascript
// Current (counts sessions):
const total_active = visible.filter(
  s => s.status === 'active' || s.active_agents.length > 0
).length;

// Fixed (counts agents):
const total_active = visible.reduce((sum, s) => sum + s.active_agents.length, 0);
```

This makes "Active Agents = 2" when two background agents are running, not "Active Agents = 1" (one session).

---

## Files Involved

| File | Role |
|---|---|
| `D:/Claude/agent-dashboard/api/state.js` | `computeState()` — Bug 1 (premature removal) + Bug 2 (wrong count) |
| `D:/Claude/agent-dashboard/public/index.html` | `applyState()`, `spawnPenguin()`, `despawnPenguin()`, `renderMetrics()` — correct, victim of bad data |
| `D:/Claude/agent-dashboard/event-collector.py` | Emits correct `is_agent=True` on PreToolUse — not the problem |
| `D:/Claude/agent-dashboard/api/events.js` | Raw event passthrough — not the problem |
