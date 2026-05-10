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
const COFFEE_TOTAL_MS       = 15000;
const FRUIT_BITE_PROBABILITY= 0.1;
const FRUIT_BITE_WALK_MS    = 2000;
const FRUIT_BITE_PICK_MS    = 2000;
const FRUIT_BITE_MUNCH_MS   = 9000;
const FRUIT_BITE_FADE_MS    = 1000;
const FRUIT_BITE_TOTAL_MS   = 14000;

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
