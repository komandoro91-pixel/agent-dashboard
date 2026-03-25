#!/usr/bin/env node
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import { execSync } from 'child_process';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Idempotency check — skip if already updated today
const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;
async function redisGet(key) {
  const res = await fetch(`${upstashUrl}/get/${key}`, {
    headers: { Authorization: `Bearer ${upstashToken}` },
  });
  const json = await res.json();
  return json.result ?? null;
}
async function redisSet(key, value) {
  const res = await fetch(`${upstashUrl}/set/${key}/${encodeURIComponent(value)}`, {
    headers: { Authorization: `Bearer ${upstashToken}` },
  });
  return res.ok;
}
const isManual = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch';
if (!isManual) {
  const lastTs = await redisGet('last_release_ts');
  if (lastTs) {
    const lastDate = new Date(parseFloat(lastTs) * 1000).toISOString().split('T')[0];
    const today = new Date().toISOString().split('T')[0];
    if (lastDate === today) {
      console.log(`Already updated today (${today}). Skipping.`);
      process.exit(0);
    }
  }
}

const HTML_PATH = 'public/index.html';
const HISTORY_PATH = 'scripts/improvement-history.json';

const html = fs.readFileSync(HTML_PATH, 'utf-8');
const history = fs.existsSync(HISTORY_PATH) ? JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf-8')) : [];

const recentNotes = history.slice(-14).map(h => h.note).join('\n- ');

const systemPrompt = `You are an expert UI/UX engineer improving a real-time AI agent dashboard.
The dashboard is built with vanilla JS, Three.js, and CSS glassmorphism.
It shows penguins (active AI subagents), genies (open Claude sessions), and a timeline of events.
The color palette uses CSS variables: --indigo, --purple, --green, --amber, --red, --blue, --cyan.
Constraint: This week, make UI/UX improvements ONLY (visual, CSS, animations, layout micro-polish).
Do NOT change JavaScript logic, Three.js code, or API calls.`;

const userPrompt = `Recent improvements (do NOT repeat these):
${recentNotes || '(none yet)'}

Generate ONE small, impactful UI/UX improvement for the dashboard.

Rules:
1. Must be a targeted string replacement — provide exact old_string and new_string
2. old_string must exist VERBATIM in the HTML (copy-paste exact, including whitespace/quotes)
3. new_string should be the improved replacement
4. The change must be purely visual/CSS (no JS logic changes)
5. Write a concise release note (max 50 chars, English)

Here are some CSS variables and a sample of the current HTML structure for context:
\`\`\`
${html.substring(0, 8000)}
\`\`\`

Respond with ONLY valid JSON (no markdown, no explanation):
{"note":"...", "old_string":"...", "new_string":"..."}`;

let patch;
try {
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    messages: [{ role: 'user', content: userPrompt }],
    system: systemPrompt,
  });
  patch = JSON.parse(msg.content[0].text.trim());
} catch (e) {
  console.error('Claude API error or invalid JSON:', e.message);
  process.exit(1);
}

if (!patch.old_string || !patch.new_string || !patch.note) {
  console.error('Invalid patch structure:', patch);
  process.exit(1);
}

if (!html.includes(patch.old_string)) {
  console.error('old_string not found in HTML. Aborting.');
  process.exit(1);
}

const newHtml = html.replace(patch.old_string, patch.new_string);
fs.writeFileSync(HTML_PATH, newHtml, 'utf-8');
console.log('Patch applied:', patch.note);

let testsPassed = false;
try {
  execSync('npx jest tests/state.test.js --no-coverage', { stdio: 'inherit' });
  testsPassed = true;
} catch {
  console.error('Tests FAILED. Reverting patch.');
  fs.writeFileSync(HTML_PATH, html, 'utf-8');
  process.exit(1);
}

// Write to Redis
const ts = Math.floor(Date.now() / 1000);
await redisSet('last_release_ts', String(ts));
await redisSet('last_release_note', patch.note);
console.log('Redis updated with release info.');

// Update history
history.push({ date: new Date().toISOString().split('T')[0], note: patch.note });
fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2), 'utf-8');
console.log('History updated.');

// Signal to GitHub Actions that changes were made
if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, 'changed=true\n');
}
