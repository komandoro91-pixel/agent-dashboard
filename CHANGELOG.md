# Changelog — agent-dashboard

## 2026-06-10 (wave 1-2 фиксы по ревью)
- **security:** `/api/state` и `/api/events` требуют token (header `x-token` или `?token=`) когда `COLLECT_TOKEN` задан — закрыта публичная утечка cwd/bash-команд (подтверждена probe: state=200 без токена до фикса). `collect.js` fail-closed при пустом env. **⚠ Дашборд теперь открывать с `?token=<COLLECT_TOKEN>` один раз — сохранится в localStorage.**
- **fix:** коллизия station index при 7+ параллельных агентах (count-based → first-free scan).
- **fix:** `AGENT_COLORS` + `librarian`, `claude` (новые subagent_type).
- **parity server.py ↔ api/state.js:** реактивация сессии после mid-session Stop, VS Code dual-process dedup, `provider`/antigravity detection. +5 pytest-кейсов.
- **hardening server.py:** normpath-guard в `/mockups/` route, 400 на нечисловые `since/limit`, Origin-check на `POST /api/clear`.
- Тесты: pytest 38/38, jest 28/28, ruff clean.

## 2026-06-10
- Полное ревью кодабазы (Fable 5): отчёт `D:/Obsidian/reports/dashboard-review-2026-06-10.md` — 2 HIGH (публичные read-endpoints Vercel; auth bypass collect.js при пустом COLLECT_TOKEN), 5 MED, 7 LOW + план улучшений. Jest 28/28 PASS.
- Добавлен мокап дизайн-рефреша `mockups/refresh-2026-06.html` — Variant A «Mission Control» (тихий telemetry) / Variant B «Hologrid» (голограммная станция). Решение owner pending.
- Создан этот CHANGELOG.md (по правилу changelog_practice; ранее отсутствовал).
