---
id: feature-coffee-station
type: feature
status: pending
agent: senior-developer
created: 2026-05-10
project: agent-dashboard
priority: MED
trello:
  card_id: null
  url: null
  last_synced: null
---

## Задача

Добавить **Coffee Station** в Three.js-сцену дашборда: после `PostToolUse[Agent]` пингвин-субагент идёт к кофейному столику, наливается кофе, пьёт, исчезает (~15 сек total). Несколько агентов получают свои стаканы параллельно. Тарелка с фруктами рядом — декоративная, с easter-egg «bite» при низкой вероятности.

## Контекст

- Проект: agent-dashboard (UI визуализации работы агентов Claude Code)
- CLAUDE.md / spec: `D:/Obsidian/ClaudeLocalSetup/projects/d--projects/memory/project_agent_dashboard.md`
- Single FE file: `public/index.html` (и для prod, и для local server.py)
- Today: 2026-05-10
- Worktree: `D:/worktrees/agent-dashboard-coffee` (создаст orchestrator перед запуском агента)
- Branch: `feature/coffee-station`
- AUTONOMOUS PR + merge разрешён для этого репо (`feedback_dashboard_autonomous_pr_merge.md`)

**Текущее поведение (что меняем):**
- `event-collector.py` шлёт `is_agent:true` на `PreToolUse[Agent]` → spawnPenguin
- На `PostToolUse[Agent]` → пингвин остаётся ещё `MIN_ALIVE_MS=30s` минимум, потом `retireCharacter` → `removePenguin3D`
- TTL 60s safety на сервере + 600s в `api/state.js`

**Что заменяем:** Lifecycle от `PostToolUse[Agent]` до retire — теперь не таймер 30с, а 4-фазный coffee animation cycle. Server-side TTL не трогаем (safety net остаётся).

## Локация Coffee Station

- Top-left области canvas, **выше** `#kanban-panel` overlay (kanban живёт в `bottom-left`: `position:absolute; bottom:14px; left:14px; width:320px` — НЕ пересекается)
- Three.js scene element (НЕ HTML overlay)
- Координаты canvas-space: примерно `x ≈ 100, y ≈ 80` (left edge + small inset, top inset)
- За пределами рабочего круга станций (центр стола `(CX,CY)` радиус 145+ — не пересекаются)

## Visual spec (3D примитивы как пингвины)

**Coffee Station Group** (THREE.Group `coffeeStation`):

1. **Стол (BoxGeometry):** `width=80, depth=50, height=8`. Material `MeshBasicMaterial #6b4423` (тёмное дерево). Позиция: на высоте «пола» сцены (~ совпадает с deskY уровнем станций).

2. **Кофемашина (compound):**
   - Base: `BoxGeometry(20, 30, 16)` — silver `#9ca3af`
   - Dispenser top: `CylinderGeometry(8, 8, 4)` — чёрный `#1f2937`
   - Spout: маленький `CylinderGeometry(1.5, 1.5, 4)` — `#1f2937`, вертикальный, торчит из dispenser вниз
   - LED: маленькая `SphereGeometry(1.2)` зелёная `#10b981` (емкая `MeshBasicMaterial`, без shadow) — индикатор «включена»
   - Позиция machine: на столе, у задней кромки (z = -10 относительно центра стола)

3. **Стакан под машиной (per-penguin spawn):**
   - `CylinderGeometry(3, 2.5, 8)` — нижний радиус меньше (стакан suzun), высота 8
   - Material: `MeshBasicMaterial({color: 0xffffff, transparent: true, opacity: 0.4})` — стекло
   - Coffee level inside (child mesh): `CylinderGeometry(2.7, 2.3, 0.1)` — `#5d2f0d` (кофе), `scale.y` растёт от 0 до 7 за brew phase
   - Каждый стакан spawn'ится при transition `walking → brewing` для конкретного penguin'а
   - Уничтожается (dispose geometry/material) при transition `fading → done`

4. **Тарелка с фруктами:**
   - Plate: `CylinderGeometry(12, 12, 1.5)` — `#e5e7eb` (light)
   - Apple: `SphereGeometry(3.5)` — `#dc2626`
   - Banana: `SphereGeometry(3.5)` со `scale.set(1.5, 0.6, 0.8)` — `#facc15` (yellow elongated)
   - Orange: `SphereGeometry(3.2)` — `#fb923c`
   - 3 фрукта на плате, расставлены треугольником
   - Позиция плате: на столе справа от машины (x +25 relative)

**Z-order:** Coffee Station в той же `THREE.Scene` что пингвины, нет отдельного render pass. Camera tilt -15° применяется как у всего остального.

## Behaviour spec — penguin lifecycle

**Новые поля на penguin object:**
```js
{
  // existing: agent_type, started_at, station_idx, mesh_group, ...
  coffee_phase: null,        // null | 'walking' | 'brewing' | 'sipping' | 'fading' | 'fruit_bite'
  coffee_started_at: 0,      // ts когда phase change (relative)
  coffee_slot_idx: null,     // 0..5, какой slot занят у coffee station
  coffee_target_mode: null,  // 'machine' | 'fruit'
  cup_mesh: null,            // own CylinderGeometry-based group (создаётся при brewing)
  fruit_held_mesh: null      // только для fruit_bite — клон-фрукт привязан к penguin'у
}
```

**Триггер (заменяет MIN_ALIVE_MS retire timer):**
- На `PostToolUse[Agent]` (subagent finished):
  - Старая логика `MIN_ALIVE_MS=30000` retire — **убрать** (или оставить как fallback при `coffee_slot=null`)
  - Назначить `coffee_phase = 'walking'`, `coffee_started_at = performance.now()`
  - Найти free slot из `COFFEE_SLOTS` (cap=6), занять его
  - **Easter egg:** `Math.random() < FRUIT_BITE_PROBABILITY (0.1)` → `coffee_target_mode = 'fruit'`, иначе `'machine'`
  - Если все 6 слотов заняты → fallback на старый MIN_ALIVE_MS retire (без animation; не блокируем queue)

**Phases в animate3D loop (каждый кадр):**

```
walking (t = 0 → 2000ms):
  lerp penguin.position.x/y → coffee_slot.world_pos
  rotation.z согласно direction of motion
  walking-bobbing animation (small sin вверх-вниз)
  переход → brewing (machine) | fruit_bite (fruit)

brewing (t = 2000 → 5000ms):  — только для machine target
  spawn cup_mesh при entry
  cup_mesh coffee_level.scale.y от 0 → full over 3000ms
  penguin slight forward lean (rotation.x += 0.1)
  переход → sipping

sipping (t = 5000 → 14000ms):  — 9 sec
  attach cup_mesh as child of penguin (cup follows penguin)
  cup_mesh.position на уровне «лица» (above body)
  head nod every ~1.5s (rotation.x sin)
  occasional cup-to-mouth (z lift cup ~3 units на ~600ms каждые ~2.5s)
  переход → fading

fading (t = 14000 → 15000ms):  — 1 sec
  material.opacity: 1 → 0 (для всех meshes пингвина — рекурсивно)
  scale.set(0.95, 0.95, 0.95) → (0.85, 0.85, 0.85)
  cup_mesh fade синхронно
  done (t > 15000ms): removePenguin3D, free slot, dispose cup_mesh

fruit_bite (alt path):
  walking → у фруктовой тарелки (target = plate centre)
  bite phase (t = 2000 → 4000ms): pick fruit (clone SphereGeometry as child of penguin), original fruit на тарелке scale → 0.7 (визуально «уменьшилась»)
  munch phase (t = 4000 → 13000ms): held fruit маленькие rotation.y oscillations
  fading (t = 13000 → 14000ms): 1 sec
  done: removePenguin3D, plate fruit вернуть scale=1
  total: 14 sec (немного короче чем coffee path — компенсация)
```

**Multi-agent (parallel):**
- 6 COFFEE_SLOTS вокруг столика (например по 60° на радиусе ~35 от центра стола)
- Каждый penguin занимает свой slot — animations независимы
- Free slots → fallback retire 30s (старая логика), penguin на сцене не "висит" неограниченно

## Constants block

```js
// Coffee Station
const COFFEE_TABLE_POS = { x: 100, y: 80 };  // canvas coords, top-left
const COFFEE_SLOTS_COUNT = 6;
const COFFEE_SLOT_RADIUS = 35;
const COFFEE_WALK_MS = 2000;
const COFFEE_BREW_MS = 3000;
const COFFEE_SIP_MS = 9000;
const COFFEE_FADE_MS = 1000;
const COFFEE_TOTAL_MS = 15000;  // walk + brew + sip + fade
const FRUIT_BITE_PROBABILITY = 0.1;
const FRUIT_BITE_WALK_MS = 2000;
const FRUIT_BITE_PICK_MS = 2000;
const FRUIT_BITE_MUNCH_MS = 9000;
const FRUIT_BITE_FADE_MS = 1000;
const FRUIT_BITE_TOTAL_MS = 14000;
```

## Backend impact

**None.** Pure frontend:
- `api/collect.js` / `state.js` / `events.js` — не меняются
- `event-collector.py` — не меняется
- TTL 600s в `api/state.js` остаётся как safety net (если frontend сломается, server всё равно retire'ит penguin'а)

## Файлы которые меняем

1. **`public/index.html`** — единственный target:
   - +Constants block (15 строк)
   - +`makeCoffeeStation()` factory функция (~80 строк): создаёт THREE.Group со столом, машиной, тарелкой, фруктами
   - +`COFFEE_SLOTS` array (вычислить позиции от COFFEE_TABLE_POS)
   - +`startCoffeeAnimation(penguin)` — entry point, заменяет старый retire timer logic
   - +`updateCoffeePhase(penguin, dt)` — вызывается из animate3D на каждом кадре для penguinов с `coffee_phase !== null`
   - +`makeCupMesh()` factory (~25 строк)
   - +`disposeCoffeeMesh(mesh)` — geometry/material dispose helper
   - **Изменить:** retire trigger в обработчике PostToolUse — вместо setTimeout MIN_ALIVE_MS, сразу `startCoffeeAnimation(penguin)`
   - **Сохранить:** старая retireCharacter logic как fallback при no-free-slot

2. **`tests/coffee.test.js`** (новый) — Jest unit:
   - phase transitions at correct time deltas
   - free-slot allocation / release
   - fruit-bite probability path (mock Math.random)
   - cup_mesh spawn/dispose at right phases
   - fallback retire когда все slots заняты

## Edge cases

- [x] **Все 6 slots заняты** → fallback retire 30s, не block penguin
- [x] **Penguin завершился но Three.js group уже dispose** (race) → guard в startCoffeeAnimation на `penguin.mesh_group` exists
- [x] **Stop hook сработал mid-animation** → coffee_phase сохраняется, animation продолжается до fading. Server-side TTL 600s — safety
- [x] **Tab switch / Visibility hidden** → animate3D скипает кадры (browser RAF pause); по resume времена пересчитываются по `performance.now()` дельтам
- [x] **Multiple PostToolUse для одного penguin** (theoretical race) → idempotency: если `coffee_phase != null` уже — skip второй trigger
- [x] **Mobile viewport** (DPR 1.5, shadowMap off): coffee station должен быть видимым; проверить что top-left координат (100, 80) не залезает под header (header h ≈ 64px, viewport coords vs canvas coords — внутри canvas top-left, header HTML поверх НЕ пересекается)
- [x] **Performance:** 6 параллельных coffee animations + 6+ пингвинов на станциях → проверить FPS не падает ниже 60. Если падает: BufferGeometry reuse для cup, instance меньше material churn

## ЗАПРЕЩЕНО

- Менять backend (`api/*.js`, server.py, `event-collector.py`)
- Менять server TTL (600s safety net остаётся)
- Удалять `retireCharacter` / `removePenguin3D` — fallback path для no-free-slot
- Менять Redis schema или event format
- Трогать GH Actions / daily-update.mjs
- Коммитить пока не пройдёт `npm test` GREEN
- Менять `.env`, `vercel.json`, `package.json` (новых зависимостей не нужно)

## DoD — measurable acceptance criteria

- [ ] `npm test` exit 0, **all 27 existing + new ~6 coffee tests** PASS
- [ ] `python server.py` запускается, открывается `http://localhost:3737` без 500/404
- [ ] `python scripts/parade_sim.py` (с `DASHBOARD_URL=http://localhost:3737/api/collect`) триггерит ≥3 fake agent событий → визуально видно: пингвины идут к кофейному столику, наливается кофе, пьют, исчезают
- [ ] Coffee Station mesh видим в top-left области, выше kanban-panel, не пересекает kanban визуально
- [ ] Console DevTools: 0 errors during 30s наблюдения
- [ ] FPS counter в header не опускается ниже 55 при ≥3 одновременно coffee animations (целевое 60)
- [ ] Один из ~10 пингвинов идёт к фрукту вместо машины (визуально проверить через 10+ событий или mock Math.random)
- [ ] Mobile viewport (DevTools 393×852): coffee station виден, не сломан layout

## Верификация (proof для verification gate)

- команда: `cd D:/worktrees/agent-dashboard-coffee && npm test`
  ожидаемо: `Tests: NN passed`, exit 0
- команда: `node -e "const fs=require('fs'); const html=fs.readFileSync('public/index.html','utf8'); console.log('coffeeStation:', html.includes('coffeeStation')); console.log('COFFEE_SLOTS:', html.includes('COFFEE_SLOTS_COUNT'));"`
  ожидаемо: оба `true`
- команда: integration smoke (orchestrator делает локально перед merge): `python server.py` + browser + parade_sim
  ожидаемо: визуально подтверждённое поведение

## Ожидаемый вывод

Финальный response от senior-developer:
- diff-summary: какие куски index.html изменились + новый tests/coffee.test.js
- npm test output (полный, exit code 0)
- node smoke check output (true/true)
- список новых constants
- комит SHA в worktree
- `**Lesson candidate:** none | <Lesson template>` блок (опционально)

## Результат

(заполнит main agent после receiving response от senior-developer)

## Evaluation Loop

(заполнит main agent на основе tester + reviewer + /review-cross findings)

## Lesson candidate

(валидируется main agent'ом если subagent поднял recurring pattern)
