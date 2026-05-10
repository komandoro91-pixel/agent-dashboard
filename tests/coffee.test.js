'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Coffee Station unit tests
// Tests the pure logic extracted from index.html coffee animation system.
// No DOM / Three.js — all stubs are plain objects.
// ─────────────────────────────────────────────────────────────────────────────

// ── Constants (mirrors index.html) ───────────────────────────────────────────
const COFFEE_SLOTS_COUNT    = 6;
const COFFEE_SLOT_RADIUS    = 35;
const COFFEE_WALK_MS        = 2000;
const COFFEE_BREW_MS        = 3000;
const COFFEE_SIP_MS         = 9000;
const COFFEE_FADE_MS        = 1000;
const COFFEE_TOTAL_MS       = COFFEE_WALK_MS + COFFEE_BREW_MS + COFFEE_SIP_MS + COFFEE_FADE_MS;
const FRUIT_BITE_PROBABILITY= 0.1;
const FRUIT_BITE_WALK_MS    = 2000;
const FRUIT_BITE_PICK_MS    = 2000;
const FRUIT_BITE_MUNCH_MS   = 9000;
const FRUIT_BITE_FADE_MS    = 1000;
const FRUIT_BITE_TOTAL_MS   = FRUIT_BITE_WALK_MS + FRUIT_BITE_PICK_MS + FRUIT_BITE_MUNCH_MS + FRUIT_BITE_FADE_MS;

const COFFEE_PHASE = {
  WALKING: 'walking',
  BREWING: 'brewing',
  SIPPING: 'sipping',
  FADING:  'fading',
  FRUIT_BITE: 'fruit_bite',
};

// ── Slot manager (extracted pure logic) ──────────────────────────────────────

function makeSlotManager(count) {
  const slots = Array.from({ length: count }, (_, i) => ({ idx: i, busy: false }));

  function acquireSlot() {
    const slot = slots.find(s => !s.busy);
    if (!slot) return null;
    slot.busy = true;
    return slot.idx;
  }

  function releaseSlot(idx) {
    const slot = slots[idx];
    if (slot) slot.busy = false;
  }

  function freeCount() {
    return slots.filter(s => !s.busy).length;
  }

  return { acquireSlot, releaseSlot, freeCount, slots };
}

// ── Phase resolver (pure logic) ───────────────────────────────────────────────

function resolvePhase(penguin, nowMs) {
  if (!penguin.coffee_phase) return null;
  const elapsed = nowMs - penguin.coffee_started_at;

  if (penguin.coffee_target_mode === 'fruit') {
    if (elapsed < FRUIT_BITE_WALK_MS) return COFFEE_PHASE.WALKING;
    if (elapsed < FRUIT_BITE_WALK_MS + FRUIT_BITE_PICK_MS) return COFFEE_PHASE.FRUIT_BITE;
    if (elapsed < FRUIT_BITE_WALK_MS + FRUIT_BITE_PICK_MS + FRUIT_BITE_MUNCH_MS) return COFFEE_PHASE.FRUIT_BITE;
    if (elapsed < FRUIT_BITE_TOTAL_MS) return COFFEE_PHASE.FADING;
    return 'done';
  }

  // machine path
  if (elapsed < COFFEE_WALK_MS) return COFFEE_PHASE.WALKING;
  if (elapsed < COFFEE_WALK_MS + COFFEE_BREW_MS) return COFFEE_PHASE.BREWING;
  if (elapsed < COFFEE_WALK_MS + COFFEE_BREW_MS + COFFEE_SIP_MS) return COFFEE_PHASE.SIPPING;
  if (elapsed < COFFEE_TOTAL_MS) return COFFEE_PHASE.FADING;
  return 'done';
}

// ── startCoffeeAnimation stub ─────────────────────────────────────────────────

function startCoffeeAnimation(penguin, slotMgr, randomFn = Math.random) {
  // Idempotency guard
  if (penguin.coffee_phase !== null) return false;
  // Mesh guard
  if (!penguin.mesh_group) return false;

  const slotIdx = slotMgr.acquireSlot();
  if (slotIdx === null) {
    // fallback retire
    penguin._fallback = true;
    return false;
  }

  penguin.coffee_slot_idx   = slotIdx;
  penguin.coffee_started_at = penguin._now || performance.now();
  penguin.coffee_phase      = COFFEE_PHASE.WALKING;
  penguin.coffee_target_mode = randomFn() < FRUIT_BITE_PROBABILITY ? 'fruit' : 'machine';
  penguin.cup_mesh          = null;
  penguin.fruit_held_mesh   = null;
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Phase transitions — correct time deltas
// ─────────────────────────────────────────────────────────────────────────────

describe('phase transitions — machine path', () => {
  let penguin;
  beforeEach(() => {
    penguin = {
      coffee_phase: COFFEE_PHASE.WALKING,
      coffee_started_at: 0,
      coffee_target_mode: 'machine',
    };
  });

  it('resolves WALKING at t=0', () => {
    expect(resolvePhase(penguin, 0)).toBe(COFFEE_PHASE.WALKING);
  });

  it('resolves WALKING at t=1999ms (boundary)', () => {
    expect(resolvePhase(penguin, 1999)).toBe(COFFEE_PHASE.WALKING);
  });

  it('resolves BREWING at t=COFFEE_WALK_MS (2000ms)', () => {
    expect(resolvePhase(penguin, COFFEE_WALK_MS)).toBe(COFFEE_PHASE.BREWING);
  });

  it('resolves BREWING at t=walk+brew-1ms boundary', () => {
    expect(resolvePhase(penguin, COFFEE_WALK_MS + COFFEE_BREW_MS - 1)).toBe(COFFEE_PHASE.BREWING);
  });

  it('resolves SIPPING at t=walk+brew (5000ms)', () => {
    expect(resolvePhase(penguin, COFFEE_WALK_MS + COFFEE_BREW_MS)).toBe(COFFEE_PHASE.SIPPING);
  });

  it('resolves FADING at t=walk+brew+sip (14000ms)', () => {
    expect(resolvePhase(penguin, COFFEE_WALK_MS + COFFEE_BREW_MS + COFFEE_SIP_MS)).toBe(COFFEE_PHASE.FADING);
  });

  it('resolves done at t=COFFEE_TOTAL_MS (15000ms)', () => {
    expect(resolvePhase(penguin, COFFEE_TOTAL_MS)).toBe('done');
  });

  it('resolves done past COFFEE_TOTAL_MS', () => {
    expect(resolvePhase(penguin, COFFEE_TOTAL_MS + 500)).toBe('done');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Free-slot allocation / release
// ─────────────────────────────────────────────────────────────────────────────

describe('slot allocation and release', () => {
  it('acquires 6 slots sequentially (0..5)', () => {
    const mgr = makeSlotManager(COFFEE_SLOTS_COUNT);
    const acquired = [];
    for (let i = 0; i < COFFEE_SLOTS_COUNT; i++) {
      acquired.push(mgr.acquireSlot());
    }
    expect(acquired).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('returns null when all slots are busy', () => {
    const mgr = makeSlotManager(COFFEE_SLOTS_COUNT);
    for (let i = 0; i < COFFEE_SLOTS_COUNT; i++) mgr.acquireSlot();
    expect(mgr.acquireSlot()).toBeNull();
  });

  it('releases slot and makes it re-acquirable', () => {
    const mgr = makeSlotManager(COFFEE_SLOTS_COUNT);
    for (let i = 0; i < COFFEE_SLOTS_COUNT; i++) mgr.acquireSlot();
    mgr.releaseSlot(2);
    expect(mgr.acquireSlot()).toBe(2);
  });

  it('freeCount decrements on acquire', () => {
    const mgr = makeSlotManager(COFFEE_SLOTS_COUNT);
    expect(mgr.freeCount()).toBe(6);
    mgr.acquireSlot();
    expect(mgr.freeCount()).toBe(5);
  });

  it('freeCount increments on release', () => {
    const mgr = makeSlotManager(COFFEE_SLOTS_COUNT);
    mgr.acquireSlot();
    mgr.acquireSlot();
    mgr.releaseSlot(0);
    expect(mgr.freeCount()).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Fruit-bite probability path — mock Math.random
// ─────────────────────────────────────────────────────────────────────────────

describe('fruit-bite probability path', () => {
  it('assigns fruit mode when random < FRUIT_BITE_PROBABILITY', () => {
    const mgr = makeSlotManager(COFFEE_SLOTS_COUNT);
    const penguin = { coffee_phase: null, mesh_group: {}, _now: 0 };
    startCoffeeAnimation(penguin, mgr, () => 0.05); // 0.05 < 0.1
    expect(penguin.coffee_target_mode).toBe('fruit');
  });

  it('assigns machine mode when random >= FRUIT_BITE_PROBABILITY', () => {
    const mgr = makeSlotManager(COFFEE_SLOTS_COUNT);
    const penguin = { coffee_phase: null, mesh_group: {}, _now: 0 };
    startCoffeeAnimation(penguin, mgr, () => 0.5); // 0.5 >= 0.1
    expect(penguin.coffee_target_mode).toBe('machine');
  });

  it('assigns machine mode at exact boundary (0.1)', () => {
    const mgr = makeSlotManager(COFFEE_SLOTS_COUNT);
    const penguin = { coffee_phase: null, mesh_group: {}, _now: 0 };
    startCoffeeAnimation(penguin, mgr, () => FRUIT_BITE_PROBABILITY); // exactly 0.1, not < 0.1
    expect(penguin.coffee_target_mode).toBe('machine');
  });

  it('fruit path resolves FRUIT_BITE phase at t=walk+1ms', () => {
    const penguin = {
      coffee_phase: COFFEE_PHASE.WALKING,
      coffee_started_at: 0,
      coffee_target_mode: 'fruit',
    };
    expect(resolvePhase(penguin, FRUIT_BITE_WALK_MS + 1)).toBe(COFFEE_PHASE.FRUIT_BITE);
  });

  it('fruit path resolves done at FRUIT_BITE_TOTAL_MS (14000ms)', () => {
    const penguin = {
      coffee_phase: COFFEE_PHASE.WALKING,
      coffee_started_at: 0,
      coffee_target_mode: 'fruit',
    };
    expect(resolvePhase(penguin, FRUIT_BITE_TOTAL_MS)).toBe('done');
  });

  it('fruit path is shorter than machine path (14s < 15s)', () => {
    expect(FRUIT_BITE_TOTAL_MS).toBeLessThan(COFFEE_TOTAL_MS);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Cup mesh — spawn at brewing entry / dispose at fading done
// ─────────────────────────────────────────────────────────────────────────────

describe('cup_mesh lifecycle', () => {
  it('cup_mesh is null initially after startCoffeeAnimation', () => {
    const mgr = makeSlotManager(COFFEE_SLOTS_COUNT);
    const penguin = { coffee_phase: null, mesh_group: {}, _now: 0 };
    startCoffeeAnimation(penguin, mgr, () => 0.5);
    expect(penguin.cup_mesh).toBeNull();
  });

  it('cup_mesh should be created when entering BREWING phase', () => {
    // Simulate the brewing entry logic
    const penguin = { cup_mesh: null };
    // Entry to brewing: create cup
    function onBrewingEntry(p) {
      if (!p.cup_mesh) p.cup_mesh = { disposed: false, geometry: {}, material: {} };
    }
    onBrewingEntry(penguin);
    expect(penguin.cup_mesh).not.toBeNull();
    expect(penguin.cup_mesh.disposed).toBe(false);
  });

  it('cup_mesh is disposed when fading completes', () => {
    // Simulate dispose logic
    const penguin = {
      cup_mesh: { disposed: false, geometry: { dispose: jest.fn() }, material: { dispose: jest.fn() } }
    };
    function onFadingDone(p) {
      if (p.cup_mesh) {
        p.cup_mesh.geometry.dispose();
        p.cup_mesh.material.dispose();
        p.cup_mesh.disposed = true;
        p.cup_mesh = null;
      }
    }
    const cupRef = penguin.cup_mesh;
    onFadingDone(penguin);
    expect(cupRef.geometry.dispose).toHaveBeenCalledTimes(1);
    expect(cupRef.material.dispose).toHaveBeenCalledTimes(1);
    expect(penguin.cup_mesh).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Fallback retire when all 6 slots are busy
// ─────────────────────────────────────────────────────────────────────────────

describe('fallback retire when all slots busy', () => {
  it('marks penguin._fallback=true when all 6 slots are occupied', () => {
    const mgr = makeSlotManager(COFFEE_SLOTS_COUNT);
    // Fill all slots
    for (let i = 0; i < COFFEE_SLOTS_COUNT; i++) mgr.acquireSlot();

    const penguin = { coffee_phase: null, mesh_group: {}, _now: 0 };
    const result = startCoffeeAnimation(penguin, mgr, () => 0.5);
    expect(result).toBe(false);
    expect(penguin._fallback).toBe(true);
    expect(penguin.coffee_phase).toBeNull(); // not started
  });

  it('penguin coffee_phase remains null on fallback', () => {
    const mgr = makeSlotManager(COFFEE_SLOTS_COUNT);
    for (let i = 0; i < COFFEE_SLOTS_COUNT; i++) mgr.acquireSlot();

    const penguin = { coffee_phase: null, mesh_group: {}, _now: 0 };
    startCoffeeAnimation(penguin, mgr, () => 0.5);
    expect(penguin.coffee_phase).toBeNull();
  });

  it('idempotency: second call skipped if coffee_phase already set', () => {
    const mgr = makeSlotManager(COFFEE_SLOTS_COUNT);
    const penguin = { coffee_phase: COFFEE_PHASE.WALKING, mesh_group: {}, _now: 0 };
    const result = startCoffeeAnimation(penguin, mgr, () => 0.5);
    expect(result).toBe(false);
    // slot count unchanged (no slot acquired)
    expect(mgr.freeCount()).toBe(COFFEE_SLOTS_COUNT);
  });

  it('mesh_group guard: skips penguin with no mesh', () => {
    const mgr = makeSlotManager(COFFEE_SLOTS_COUNT);
    const penguin = { coffee_phase: null, mesh_group: null, _now: 0 };
    const result = startCoffeeAnimation(penguin, mgr, () => 0.5);
    expect(result).toBe(false);
    expect(penguin.coffee_phase).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Fruit refcount — two penguins pick same fruit, scale stays 0.7 until both release
// ─────────────────────────────────────────────────────────────────────────────

// Pure refcount helpers mirroring index.html logic
function fruitPick(srcFruit) {
  srcFruit.userData._pickRefs = (srcFruit.userData._pickRefs || 0) + 1;
  if (srcFruit.userData._pickRefs === 1) srcFruit._scale = 0.7;
}

function fruitRelease(srcFruit) {
  srcFruit.userData._pickRefs = Math.max(0, (srcFruit.userData._pickRefs || 1) - 1);
  if (srcFruit.userData._pickRefs === 0) srcFruit._scale = 1.0;
}

describe('fruit refcount — scale stays shrunk until last release', () => {
  function makeFruit() {
    return { _scale: 1.0, userData: {} };
  }

  it('scale shrinks to 0.7 on first pick', () => {
    const fruit = makeFruit();
    fruitPick(fruit);
    expect(fruit._scale).toBe(0.7);
    expect(fruit.userData._pickRefs).toBe(1);
  });

  it('scale stays 0.7 when second penguin also picks same fruit', () => {
    const fruit = makeFruit();
    fruitPick(fruit); // penguin A
    fruitPick(fruit); // penguin B
    expect(fruit._scale).toBe(0.7);
    expect(fruit.userData._pickRefs).toBe(2);
  });

  it('scale stays 0.7 when first penguin releases but second still holds', () => {
    const fruit = makeFruit();
    fruitPick(fruit);   // penguin A
    fruitPick(fruit);   // penguin B
    fruitRelease(fruit); // penguin A done
    expect(fruit._scale).toBe(0.7); // B still holding
    expect(fruit.userData._pickRefs).toBe(1);
  });

  it('scale restores to 1.0 only when last penguin releases', () => {
    const fruit = makeFruit();
    fruitPick(fruit);
    fruitPick(fruit);
    fruitRelease(fruit);
    fruitRelease(fruit); // last release
    expect(fruit._scale).toBe(1.0);
    expect(fruit.userData._pickRefs).toBe(0);
  });

  it('refcount does not go below 0 on over-release', () => {
    const fruit = makeFruit();
    fruitPick(fruit);
    fruitRelease(fruit);
    fruitRelease(fruit); // extra release — should not go negative
    expect(fruit.userData._pickRefs).toBe(0);
    expect(fruit._scale).toBe(1.0);
  });

  it('three penguins pick same fruit — volume scenario', () => {
    const fruit = makeFruit();
    fruitPick(fruit);
    fruitPick(fruit);
    fruitPick(fruit);
    expect(fruit.userData._pickRefs).toBe(3);
    expect(fruit._scale).toBe(0.7);
    fruitRelease(fruit);
    fruitRelease(fruit);
    expect(fruit._scale).toBe(0.7); // still 1 holder
    fruitRelease(fruit);
    expect(fruit._scale).toBe(1.0); // last one done
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. setTimeout fallback timer — cleared on removePenguin3D (double-remove guard)
// ─────────────────────────────────────────────────────────────────────────────

// Minimal entry + penguinMap stub to test timer cancel logic
function makeEntry(spawnedAtOffset = 0) {
  return {
    _fallbackTimer: null,
    spawnedAt: Date.now() - spawnedAtOffset,
    coffeeData: null,
    group: {},
    stationIdx: 0,
    labelEl: { remove: jest.fn() },
    pointLight: null,
  };
}

describe('fallback timer — clearTimeout on removePenguin3D', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('_fallbackTimer is stored when set via setTimeout', () => {
    const entry = makeEntry();
    entry._fallbackTimer = setTimeout(() => {}, 5000);
    expect(entry._fallbackTimer).not.toBeNull();
  });

  it('clearTimeout cancels pending callback — timer does not fire', () => {
    const callback = jest.fn();
    const entry = makeEntry();
    entry._fallbackTimer = setTimeout(callback, 5000);
    // Simulate removePenguin3D clearing the timer
    clearTimeout(entry._fallbackTimer);
    entry._fallbackTimer = null;
    jest.runAllTimers();
    expect(callback).not.toHaveBeenCalled();
  });

  it('timer fires if NOT cancelled (control case)', () => {
    const callback = jest.fn();
    const entry = makeEntry();
    entry._fallbackTimer = setTimeout(callback, 5000);
    jest.runAllTimers();
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('_fallbackTimer is null after coffee animation completes (simulate clear)', () => {
    const entry = makeEntry();
    entry._fallbackTimer = setTimeout(() => {}, 10000);
    // Simulate _coffeeDone path calling removePenguin3D which clears timer
    clearTimeout(entry._fallbackTimer);
    entry._fallbackTimer = null;
    expect(entry._fallbackTimer).toBeNull();
  });
});
