"use strict";
/* Offline PF2e encounter builder. Data: data/creatures.js (built by tools/build_encounter_data.py). */

const D = window.EB_DATA;
const SRC = D.sources;
const BY_ID = new Map(D.creatures.map(c => [c.id, c]));

// GM Core encounter tables
const XP_CREATURE = { "-4": 10, "-3": 15, "-2": 20, "-1": 30, "0": 40, "1": 60, "2": 80, "3": 120, "4": 160 };
const XP_SIMPLE_HAZARD = { "-4": 2, "-3": 3, "-2": 4, "-1": 6, "0": 8, "1": 12, "2": 16, "3": 24, "4": 32 };
const THREATS = [
  ["trivial", 40, 10], ["low", 60, 15], ["moderate", 80, 20], ["severe", 120, 30], ["extreme", 160, 40],
];
const KIND = { c: "Creature", hs: "Simple hazard", hc: "Complex hazard" };
const SIZE = { tiny: "Tiny", sm: "Small", med: "Medium", lg: "Large", huge: "Huge", grg: "Gargantuan" };
const SIZE_ORDER = Object.keys(SIZE);
const RARITY = ["common", "uncommon", "rare", "unique"];
const NO_ROLE = "No clear role";
const GROUP_ORDER = ["Rulebooks", "Adventure Paths", "Adventures", "Pathfinder Society", "Battlezoo", "Starfinder", "Web & Misc", "Other"];
const edition = c => (c.g === "sf2e" ? "Starfinder" : c.rm ? "Remaster" : "Legacy");
const PAGE = 200;

/* ---------- filter definitions ---------- */

function countValues(get) {
  const m = new Map();
  for (const c of D.creatures) for (const v of get(c)) m.set(v, (m.get(v) || 0) + 1);
  return m;
}

/** "Telepathy 100 feet" / "Tremorsense (Imprecise) 60 feet" / "Fast Healing 10" -> base name for filtering. */
const baseName = n => n.replace(/\s*\([^)]*\)/g, "").replace(/\s+\d+(\s*(feet|ft\.?))?$/i, "").trim();
const baseTrait = t => t.replace(/-(d?\d+|[a-z])$/, "");
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const uniq = a => [...new Set(a)];
const CAST_ORDER = ["prepared", "spontaneous", "innate", "focus", "items"];

// Ability filter: grouped families + abilities seen on at least ABILITY_MIN_COUNT creatures.
// Rarer abilities stay visible in the table and are reachable through the families.
const ABILITY_MIN_COUNT = 5;
const ABILITY_FAMILIES = [
  ["Breath attack (any)", /breath/i, /^(no breath|deep breath|steal breath|breath snatcher|breath control|breathsense|one more breath|dying breath|curse of stolen breath|suffocated by a thousand breaths|breath-seared sword)$/i],
  ["Grab (any)", /\bgrab\b/i],
  ["Constrict (any)", /\bconstrict\b/i],
  ["Swallow (any)", /\bswallow\b/i],
  ["Sneak attack (any)", /\bsneak attack\b/i],
  ["Trample (any)", /\btrample\b/i],
  ["Rend (any)", /\brend\b/i, /^rend (faith|magic)$/i],
  ["Knockdown (any)", /\bknockdown\b/i],
  ["Push / pull (any)", /\b(push|pull)\b/i, /push my luck/i],
  ["Pounce (any)", /\bpounce\b/i],
  ["Regeneration / fast healing (any)", /\b(regeneration|fast healing)\b/i],
  ["Frightful (any)", /\bfrightful\b/i],
  ["Aura (any)", /\baura\b/i],
  ["Gaze (any)", /\bgaze\b/i],
  ["Poison / venom (any)", /\b(poison\w*|venom\w*)\b/i, /^\+\d/],
  ["Drain (any)", /\bdrain\b/i],
  ["Curse (any)", /\bcurse/i],
  ["Web (any)", /\bweb\b/i],
  ["Stench (any)", /\bstench\b/i],
  ["Roar / howl / scream / wail (any)", /\b(roar|howl|scream|wail|shriek)\w*\b/i],
  ["Spray / spit (any)", /\b(spray|spit)\b/i],
  ["Telepathy (any)", /\btelepath/i],
  ["Bonus to saves (any)", /^\+\d+ \w+ to (all )?saves?/i],
].map(([label, re, not]) => ({ label, re, not }));
const FAMILY_LABELS = new Set(ABILITY_FAMILIES.map(f => f.label));
const ABILITY_COUNTS = new Map();
for (const c of D.creatures) for (const a of uniq((c.ab || []).map(baseName))) ABILITY_COUNTS.set(a, (ABILITY_COUNTS.get(a) || 0) + 1);
const SENSE_NAMES = new Set(D.creatures.flatMap(c => (c.se || []).map(s => s[0])));

function abilityValues(c) {
  const names = uniq((c.ab || []).map(baseName).filter(Boolean));
  const out = names.filter(n => ABILITY_COUNTS.get(n) >= ABILITY_MIN_COUNT && !SENSE_NAMES.has(n));
  for (const f of ABILITY_FAMILIES) if (names.some(n => f.re.test(n) && !(f.not && f.not.test(n)))) out.push(f.label);
  for (const s of c.se || []) out.push(s[0]);
  // senses sometimes appear as abilities too (e.g. "Greater Darkvision")
  for (const n of names) if (SENSE_NAMES.has(n)) out.push(n);
  return uniq(out);
}
const abilityGroup = v => (FAMILY_LABELS.has(v) ? "Ability groups" : SENSE_NAMES.has(v) ? "Senses" : "Abilities");

// PF2e creature-type traits. Entries missing one are inferred from ancestry/undead/spirit traits.
const CREATURE_TYPES = new Set(["aberration", "animal", "astral", "beast", "celestial", "construct", "dragon", "dream",
  "elemental", "ethereal", "fey", "fiend", "fungus", "giant", "humanoid", "monitor", "ooze", "petitioner", "plant",
  "shade", "spirit", "time", "undead"]);
const INFER_TYPE = {
  humanoid: ["human", "dwarf", "elf", "gnome", "goblin", "halfling", "orc", "hobgoblin", "kobold", "catfolk", "ratfolk",
    "tengu", "lizardfolk", "aiuvarin", "dromaar", "nephilim", "kitsune", "nagaji", "vanara", "vishkanya", "tanuki", "samsaran"],
  undead: ["zombie", "skeleton", "ghoul", "ghost", "vampire", "mummy", "lich", "wight", "wraith"],
  spirit: ["kami"],
  monitor: ["protean"],
};
function creatureTypes(c) {
  if (c.k !== "c") return [];
  const own = c.t.filter(t => CREATURE_TYPES.has(t));
  if (own.length) return own;
  const inferred = Object.keys(INFER_TYPE).filter(k => c.t.some(t => INFER_TYPE[k].includes(t)));
  return inferred.length ? inferred : ["untyped"];
}

const FILTERS = [
  { key: "role", section: "General", label: "Role", multi: true,
    get: c => (c.k !== "c" ? [] : c.ro.length ? c.ro : [NO_ROLE]),
    order: [...D.roles, NO_ROLE] },
  { key: "ctype", section: "General", label: "Creature type", multi: true, order: "count", get: creatureTypes, fmt: cap },
  { key: "trait", section: "General", label: "Traits", multi: true, search: true, get: c => c.t, order: "alpha" },
  { key: "type", section: "General", label: "Type", get: c => [KIND[c.k]], order: Object.values(KIND) },
  { key: "rarity", section: "General", label: "Rarity", get: c => [c.r], order: RARITY, fmt: cap },
  { key: "size", section: "General", label: "Size", get: c => [c.z], order: SIZE_ORDER, fmt: v => SIZE[v] || v },
  { key: "group", section: "General", label: "Source group", multi: true, get: c => uniq(c.s.map(i => SRC[i].g)), order: GROUP_ORDER },
  { key: "source", section: "General", label: "Source", multi: true, search: true, get: c => c.s.map(i => SRC[i].n),
    order: "alpha", groupOf: v => SRC.find(s => s.n === v).g },
  { key: "edition", section: "General", label: "Edition", get: c => [edition(c)], order: ["Remaster", "Legacy", "Starfinder"] },

  { key: "ability", section: "Abilities & defenses", label: "Abilities & senses", multi: true, search: true, order: "count",
    get: abilityValues, groupOf: abilityGroup, groupOrder: ["Ability groups", "Senses", "Abilities"] },
  { key: "immunity", section: "Abilities & defenses", label: "Immunity", multi: true, search: true, order: "count",
    get: c => uniq((c.im || []).map(x => x[0])) },
  { key: "resistance", section: "Abilities & defenses", label: "Resistance", multi: true, search: true, order: "count",
    get: c => uniq((c.rs || []).map(x => x[0])) },
  { key: "weakness", section: "Abilities & defenses", label: "Weakness", multi: true, search: true, order: "count",
    get: c => uniq((c.wk || []).map(x => x[0])) },

  { key: "movement", section: "Combat", label: "Movement", multi: true, order: "count",
    get: c => uniq((c.sp || []).map(x => x[0])), fmt: cap },
  { key: "strike", section: "Combat", label: "Strikes", multi: true, order: ["Melee", "Ranged"],
    get: c => uniq((c.st || []).map(s => (s[2] ? "Ranged" : "Melee"))) },
  { key: "strikeTrait", section: "Combat", label: "Strike traits", multi: true, search: true, order: "count",
    get: c => uniq((c.st || []).flatMap(s => s[3].map(baseTrait))) },
  { key: "damage", section: "Combat", label: "Damage type", multi: true, order: "count",
    get: c => uniq((c.st || []).flatMap(s => s[5])) },

  { key: "tradition", section: "Spells", label: "Tradition", multi: true, order: "count",
    get: c => uniq((c.sc || []).map(e => e[1]).filter(Boolean)), fmt: cap },
  { key: "casting", section: "Spells", label: "Casting", multi: true, order: CAST_ORDER,
    get: c => uniq((c.sc || []).map(e => e[2]).filter(Boolean)), fmt: cap },
  { key: "spell", section: "Spells", label: "Spell", multi: true, search: true, order: "count",
    get: c => uniq((c.sc || []).flatMap(e => Object.values(e[5]).flat().map(baseName))) },
];
const SECTIONS = uniq(FILTERS.map(f => f.section));
const DD_RENDER_CAP = 300;

for (const f of FILTERS) {
  f.counts = countValues(f.get);
  let opts = [...f.counts.keys()];
  if (f.order === "alpha") opts.sort((a, b) => a.localeCompare(b));
  else if (f.order === "count") opts.sort((a, b) => f.counts.get(b) - f.counts.get(a) || a.localeCompare(b));
  else opts = f.order.filter(v => f.counts.has(v));
  if (f.groupOf) {
    const go = f.groupOrder || GROUP_ORDER;
    opts.sort((a, b) => go.indexOf(f.groupOf(a)) - go.indexOf(f.groupOf(b)) || (f.order === "alpha" ? a.localeCompare(b) : 0));
  }
  f.options = opts;
  f.fmt = f.fmt || (v => v);
}
for (const c of D.creatures) {
  c._f = {};
  for (const f of FILTERS) c._f[f.key] = f.get(c);
  c._name = c.n.toLowerCase();
}

/* ---------- state ---------- */

const state = {
  party: { size: 4, level: 1, difficulty: "moderate" },
  filters: Object.fromEntries(FILTERS.map(f => [f.key, { inc: [], exc: [], mode: "any" }])),
  name: "",
  relMin: -4,
  relMax: 4,
  gen: { structure: "any", max: 8, repeats: true, adjust: true },
  encounter: [],
  sort: { key: "l", dir: 1 },
  tab: "overview",
  hideZero: false,
};
let shown = PAGE;
let uid = 1;

const store = {
  get(k, fallback) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

function loadState() {
  const s = store.get("eb-state", null);
  if (!s) return;
  Object.assign(state.party, s.party || {});
  Object.assign(state.gen, s.gen || {});
  for (const f of FILTERS) if (s.filters && s.filters[f.key]) Object.assign(state.filters[f.key], s.filters[f.key]);
  for (const k of ["name", "relMin", "relMax"]) if (k in s) state[k] = s[k];
  if (s.sort) state.sort = s.sort;
  if (s.tab) state.tab = s.tab;
  if (s.hideZero) state.hideZero = true;
  state.encounter = (s.encounter || []).filter(e => BY_ID.has(e.id)).map(e => ({ ...e, uid: uid++ }));
}
function saveState() { store.set("eb-state", { ...state, encounter: state.encounter.map(({ uid: _, ...e }) => e) }); }

/* ---------- rules math ---------- */

function budgetFor(threat) {
  const t = THREATS.find(x => x[0] === threat);
  return t[1] + (state.party.size - 4) * t[2];
}
function canAdjust(c, adj) {
  if (c.k !== "c") return adj === "normal";
  if (adj === "weak") return c.l >= 0;
  return true;
}
function adjLevel(c, adj) {
  if (adj === "elite") return c.l <= 0 ? c.l + 2 : c.l + 1;
  if (adj === "weak") return c.l === 1 ? -1 : c.l - 1;
  return c.l;
}
/** XP for one creature at its adjusted level; null when more than 4 levels above the party. */
function xpFor(c, adj) {
  const rel = adjLevel(c, adj) - state.party.level;
  if (rel > 4) return null;
  if (rel < -4) return 0;
  return (c.k === "hs" ? XP_SIMPLE_HAZARD : XP_CREATURE)[rel];
}
function threatOf(xp) {
  if (xp <= 0) return "—";
  for (const [name] of THREATS) if (xp <= budgetFor(name)) return name;
  return "beyond";
}

/* ---------- filtering ---------- */

/** skipKey: leave one dropdown out (used for its live option counts). */
function matchesFilters(c, skipKey = null) {
  for (const f of FILTERS) {
    if (f.key === skipKey) continue;
    const st = state.filters[f.key];
    const vals = c._f[f.key];
    if (st.exc.length && vals.some(v => st.exc.includes(v))) return false;
    if (st.inc.length) {
      const ok = st.mode === "all" && f.multi
        ? st.inc.every(v => vals.includes(v))
        : vals.some(v => st.inc.includes(v));
      if (!ok) return false;
    }
  }
  if (state.name) {
    const terms = state.name.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.every(t => c._name.includes(t))) return false;
  }
  return true;
}
function relOk(level) {
  const rel = level - state.party.level;
  return rel >= state.relMin && rel <= state.relMax;
}
/**
 * Option counts for one dropdown among creatures passing every *other* choice and the level window.
 * Its own choices are ignored ("undead" must not grey out "dragon"), except in All mode where they narrow.
 */
function liveCounts(f) {
  const st = state.filters[f.key];
  const skip = st.mode === "all" && f.multi && st.inc.length ? null : f.key;
  const m = new Map();
  for (const c of D.creatures) {
    if (!relOk(c.l) || !matchesFilters(c, skip)) continue;
    for (const v of c._f[f.key]) m.set(v, (m.get(v) || 0) + 1);
  }
  return m;
}

function filtered() {
  return D.creatures.filter(c => relOk(c.l) && matchesFilters(c));
}

/* ---------- random generation ---------- */

const rnd = n => Math.floor(Math.random() * n);
const pick = a => a[rnd(a.length)];

/** All (creature, adjustment) options that pass the filters and land inside the level window. */
function genOptions() {
  const out = [];
  const adjs = state.gen.adjust ? ["normal", "weak", "elite"] : ["normal"];
  for (const c of D.creatures) {
    if (!matchesFilters(c)) continue;
    for (const adj of adjs) {
      if (!canAdjust(c, adj)) continue;
      const lvl = adjLevel(c, adj);
      if (!relOk(lvl)) continue;
      const xp = xpFor(c, adj);
      if (!xp) continue;
      out.push({ c, adj, xp });
    }
  }
  return out;
}

/** XP plans (lists of per-entry XP values) for each encounter structure. */
function planFor(structure, xps, R, M) {
  const fit = r => xps.filter(x => x <= r);
  const plan = [];
  let left = R;
  const push = x => { plan.push(x); left -= x; };
  const topUp = () => {
    while (plan.length < M) {
      const f = fit(left);
      if (!f.length) break;
      push(f[f.length - 1]);
    }
  };
  switch (structure) {
    case "solo": {
      const f = fit(R);
      if (!f.length) return null;
      push(f[f.length - 1]);
      break;
    }
    case "boss": {
      if (M < 2) return null;
      const boss = xps.filter(x => x >= R * 0.4 && x <= R * 0.75);
      if (!boss.length) return null;
      push(pick(boss));
      const minion = xps.filter(x => x <= plan[0] / 2 && x <= left);
      if (!minion.length) return null;
      const m = pick(minion.slice(0, 3));
      while (plan.length < M && left >= m) push(m);
      topUp();
      break;
    }
    case "group": {
      const k = Math.min(M, 2 + rnd(3));
      const f = xps.filter(x => x * k <= R);
      if (!f.length || k < 2) return null;
      const x = f[f.length - 1];
      for (let i = 0; i < k; i++) push(x);
      break;
    }
    case "horde": {
      const small = xps.filter(x => x <= R / 5);
      if (!small.length || M < 4) return null;
      const x = pick(small.slice(0, 3));
      while (plan.length < M && left >= x) push(x);
      if (plan.length < 4) return null;
      topUp();
      break;
    }
    default: { // mixed
      while (plan.length < M) {
        const f = fit(left);
        if (!f.length) break;
        // lean toward bigger pieces so mixed encounters don't become hordes
        push(f[Math.max(0, f.length - 1 - rnd(Math.min(3, f.length)))]);
      }
    }
  }
  return plan.length ? plan : null;
}

/** Turn an XP plan into concrete creatures. Same-XP slots reuse one creature when repeats are allowed. */
function fillPlan(plan, byXp, repeats, takenIds) {
  const used = new Set(takenIds);
  const counts = new Map();
  for (const x of plan) counts.set(x, (counts.get(x) || 0) + 1);
  const result = [];
  for (const [xp, n] of counts) {
    const opts = byXp.get(xp) || [];
    let left = n;
    let guard = 0;
    while (left > 0 && guard++ < 50) {
      const fresh = opts.filter(o => !used.has(o.c.id));
      const pool = fresh.length ? fresh : (repeats ? opts.filter(o => o.c.k === "c") : []);
      if (!pool.length) return null;
      // prefer unadjusted creatures; weak/elite only fill gaps
      const normal = pool.filter(o => o.adj === "normal");
      const o = normal.length && Math.random() < 0.8 ? pick(normal) : pick(pool);
      const stackable = repeats && o.c.k === "c";
      const take = stackable ? (left > 2 && Math.random() < 0.3 ? 1 + rnd(left) : left) : 1;
      used.add(o.c.id);
      result.push({ id: o.c.id, adj: o.adj, count: take });
      left -= take;
    }
    if (left > 0) return null;
  }
  return result;
}

function generate() {
  const msg = document.getElementById("genMsg");
  msg.hidden = true;
  const locked = state.encounter.filter(e => e.locked);
  const lockedXp = locked.reduce((s, e) => s + (xpFor(BY_ID.get(e.id), e.adj) || 0) * e.count, 0);
  const lockedN = locked.reduce((s, e) => s + e.count, 0);
  const R = budgetFor(state.party.difficulty) - lockedXp;
  const M = state.gen.max - lockedN;
  const opts = genOptions();
  const byXp = new Map();
  for (const o of opts) { if (!byXp.has(o.xp)) byXp.set(o.xp, []); byXp.get(o.xp).push(o); }
  const xps = [...byXp.keys()].sort((a, b) => a - b);

  const fail = text => { msg.textContent = text; msg.hidden = false; };
  if (!opts.length) return fail("No creatures match the current filters and level window.");
  if (M <= 0) return fail("Locked entries already use the maximum number of entries.");
  if (R < xps[0]) return fail("Not enough XP left in the budget for any matching creature.");

  const structures = state.gen.structure === "any" ? ["solo", "boss", "group", "horde", "mixed"] : [state.gen.structure];
  const repeats = state.gen.repeats;
  let best = [];
  let bestGap = Infinity;
  for (let i = 0; i < 150; i++) {
    const plan = planFor(pick(structures), xps, R, M);
    if (!plan) continue;
    const fill = fillPlan(plan, byXp, repeats, locked.map(e => e.id));
    if (!fill) continue;
    const gap = R - plan.reduce((a, b) => a + b, 0);
    if (gap < bestGap - 5) { best = [fill]; bestGap = gap; } else if (gap <= bestGap + 5) best.push(fill);
  }
  if (!best.length) {
    return fail(state.gen.structure === "any"
      ? "Couldn't build an encounter from the matching creatures. Try widening the level window or filters."
      : "This structure doesn't fit the matching creatures. Try another structure, allow repeats, or widen the filters.");
  }
  const chosen = pick(best);
  state.encounter = [...locked, ...chosen.map(e => ({ ...e, locked: false, uid: uid++ }))];
  if (bestGap > 0) {
    msg.textContent = `Closest fit leaves ${bestGap} XP unspent.`;
    msg.hidden = bestGap < 10;
    msg.style.color = "var(--muted)";
  }
  renderEncounter();
}

/* ---------- dropdown filters ---------- */

let openDD = null;

function ddSummary(f) {
  const st = state.filters[f.key];
  if (!st.inc.length && !st.exc.length) return "Any";
  const parts = [];
  if (st.inc.length) parts.push(st.inc.map(f.fmt).join(st.mode === "all" && f.multi ? " + " : " / "));
  if (st.exc.length) parts.push(st.exc.map(v => "not " + f.fmt(v)).join(", "));
  return parts.join("; ");
}

function buildFilterBar() {
  const bar = document.getElementById("filterBar");
  bar.innerHTML = "";
  const rows = {};
  for (const s of SECTIONS) {
    const row = document.createElement("div");
    row.className = "filter-row";
    row.innerHTML = `<span class="filter-sec">${s}</span>`;
    bar.appendChild(row);
    rows[s] = row;
  }
  for (const f of FILTERS) {
    const wrap = document.createElement("div");
    wrap.className = "dd";
    const st = state.filters[f.key];
    const btn = document.createElement("button");
    btn.className = "dd-btn" + (st.inc.length || st.exc.length ? " active" : "");
    btn.innerHTML = `<span class="lbl">${f.label}:</span> <span class="sum"></span> <span class="caret">▼</span>`;
    btn.querySelector(".sum").textContent = ddSummary(f);
    btn.addEventListener("click", e => { e.stopPropagation(); toggleDD(f, wrap); });
    wrap.appendChild(btn);
    rows[f.section].appendChild(wrap);
    f._wrap = wrap;
  }
}

function toggleDD(f, wrap) {
  const wasOpen = openDD && openDD.f === f;
  closeDD();
  if (wasOpen) return;
  const panel = document.createElement("div");
  panel.className = "dd-panel";
  panel.addEventListener("click", e => e.stopPropagation());
  const st = state.filters[f.key];

  const tools = document.createElement("div");
  tools.className = "dd-tools";
  if (f.multi) {
    const seg = document.createElement("div");
    seg.className = "seg";
    seg.title = "Any: match at least one checked value. All: match every checked value.";
    for (const m of ["any", "all"]) {
      const b = document.createElement("button");
      b.textContent = m === "any" ? "Any" : "All";
      b.className = st.mode === m ? "on" : "";
      b.addEventListener("click", () => { st.mode = m; seg.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b)); renderList(); onFiltersChanged(); });
      seg.appendChild(b);
    }
    tools.appendChild(seg);
  } else {
    tools.appendChild(document.createElement("span"));
  }
  const clr = document.createElement("button");
  clr.className = "ghost";
  clr.textContent = "Clear";
  clr.addEventListener("click", () => { st.inc = []; st.exc = []; renderList(); onFiltersChanged(); });
  tools.appendChild(clr);
  panel.appendChild(tools);

  const hint = document.createElement("div");
  hint.className = "dd-hint dd-hint-row";
  hint.innerHTML = `<span>Click once to require, twice to exclude.</span>
    <label title="Hide options that would leave no results with the other filters"><input type="checkbox"${state.hideZero ? " checked" : ""}> Hide unavailable</label>`;
  hint.querySelector("input").addEventListener("change", e => { state.hideZero = e.target.checked; saveState(); renderList(); });
  panel.appendChild(hint);

  let search = null;
  let checkAll = null;
  let shownRest = [];
  if (f.search) {
    search = document.createElement("input");
    search.type = "search";
    search.placeholder = `Search ${f.label.toLowerCase()}…`;
    search.addEventListener("input", renderList);
    panel.appendChild(search);
    checkAll = document.createElement("button");
    checkAll.className = "ghost check-all";
    checkAll.addEventListener("click", () => {
      for (const v of shownRest) if (!st.inc.includes(v) && !st.exc.includes(v)) st.inc.push(v);
      st.mode = "any";
      panel.querySelectorAll(".seg button").forEach((b, i) => b.classList.toggle("on", i === 0));
      renderList();
      onFiltersChanged();
    });
    panel.appendChild(checkAll);
  }
  const limits = document.createElement("div");
  limits.className = "dd-hint dd-limits";
  panel.appendChild(limits);
  const list = document.createElement("div");
  list.className = "dd-list";
  panel.appendChild(list);
  const capNote = document.createElement("div");
  capNote.className = "dd-hint";
  panel.appendChild(capNote);

  function renderList() {
    list.innerHTML = "";
    const q = search ? search.value.trim().toLowerCase() : "";
    let lastGroup = null;
    // checked values first so they stay visible in long lists
    const live = liveCounts(f);
    const others = FILTERS.filter(o => o !== f && (state.filters[o.key].inc.length || state.filters[o.key].exc.length)).map(o => o.label);
    if (state.name) others.push("name search");
    const lvl = `levels ${state.party.level + state.relMin}–${state.party.level + state.relMax}`;
    limits.innerHTML = `Counts limited to ${lvl}` + (others.length ? ` and your other filters: <b>${esc(others.join(", "))}</b>` : "");
    const checked = f.options.filter(v => st.inc.includes(v) || st.exc.includes(v));
    const matching = f.options.filter(v => !checked.includes(v) && (!q || f.fmt(v).toLowerCase().includes(q)));
    const available = matching.filter(v => live.get(v));
    const unavailable = state.hideZero ? [] : matching.filter(v => !live.get(v));
    const ordered = [...available, ...unavailable];
    const rest = ordered.slice(0, DD_RENDER_CAP);
    shownRest = q ? available : [];
    if (checkAll) {
      checkAll.hidden = !q || !available.length;
      checkAll.textContent = `Require any of the ${available.length.toLocaleString()} matching “${q}”`;
    }
    capNote.hidden = ordered.length <= DD_RENDER_CAP;
    capNote.textContent = `${(ordered.length - DD_RENDER_CAP).toLocaleString()} more — type to narrow the list.`;
    for (const v of [...checked, ...rest]) {
      const zero = !live.get(v);
      if (zero && !checked.includes(v)) {
        if (lastGroup !== "__none") {
          const gh = document.createElement("div");
          gh.className = "dd-group";
          gh.textContent = "No results with current filters";
          list.appendChild(gh);
          lastGroup = "__none";
        }
      } else if (f.groupOf && !checked.includes(v)) {
        const g = f.groupOf(v);
        if (g !== lastGroup) {
          const gh = document.createElement("div");
          gh.className = "dd-group";
          gh.textContent = g;
          list.appendChild(gh);
          lastGroup = g;
        }
      }
      const row = document.createElement("button");
      const s = st.inc.includes(v) ? "inc" : st.exc.includes(v) ? "exc" : "";
      row.className = "dd-opt " + s + (zero ? " zero" : "");
      row.innerHTML = `<span class="box">${s === "inc" ? "✓" : s === "exc" ? "✕" : ""}</span><span class="name"></span><span class="cnt">${live.get(v) || 0}</span>`;
      row.querySelector(".name").textContent = f.fmt(v);
      row.title = f.fmt(v);
      row.addEventListener("click", () => {
        if (st.inc.includes(v)) { st.inc = st.inc.filter(x => x !== v); st.exc.push(v); }
        else if (st.exc.includes(v)) st.exc = st.exc.filter(x => x !== v);
        else st.inc.push(v);
        renderList();
        onFiltersChanged();
      });
      list.appendChild(row);
    }
  }
  renderList();
  wrap.appendChild(panel);
  openDD = { f, panel };
  if (search) search.focus();
}

function closeDD() {
  if (openDD) { openDD.panel.remove(); openDD = null; }
}

function refreshDDButtons() {
  for (const f of FILTERS) {
    const st = state.filters[f.key];
    const btn = f._wrap.querySelector(".dd-btn");
    btn.classList.toggle("active", !!(st.inc.length || st.exc.length));
    btn.querySelector(".sum").textContent = ddSummary(f);
  }
}

function onFiltersChanged() {
  refreshDDButtons();
  shown = PAGE;
  renderTable();
  saveState();
}

/* ---------- rendering ---------- */

function sel(id, options, value) {
  const el = document.getElementById(id);
  el.innerHTML = options.map(([v, t]) => `<option value="${v}">${t}</option>`).join("");
  el.value = String(value);
  return el;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
}

function relLabel(r) { return r === 0 ? "party" : (r > 0 ? `party +${r}` : `party ${r}`); }

const fmtMod = v => (v == null ? "—" : (v >= 0 ? "+" : "") + v);
const ordinal = n => n + ({ 1: "st", 2: "nd", 3: "rd" }[n] || "th");
const rankLabel = r => (+r === 0 ? "Cantrips" : ordinal(+r));
const fmtIwr = x => esc(x[0]) + (x.length > 2 && x[1] != null ? " " + x[1] : "") +
  ((x.length > 2 ? x[2] : x[1]) ? ` <span class="muted">(${esc(x.length > 2 ? x[2] : x[1])})</span>` : "");
const listCell = (arr, fn = esc) => (arr && arr.length ? arr.map(fn).join(", ") : `<span class="muted">—</span>`);
const fmtSpeeds = c => listCell(c.sp, s => (s[0] === "land" ? "" : esc(s[0]) + " ") + s[1] + " ft");
const fmtSenses = c => listCell(c.se, s => esc(s[0]) + (s[1] ? ` <span class="muted">(${esc(s[1])})</span>` : ""));
const ATTRS = ["Str", "Dex", "Con", "Int", "Wis", "Cha"];
const fmtAttrs = c => (c.at ? c.at.map((v, i) => `<span class="attr">${ATTRS[i]} ${fmtMod(v)}</span>`).join(" ") : "—");
const fmtSkills = (c, n = 99) => listCell((c.sk || []).slice(0, n), s => `${esc(cap(s[0]))} ${fmtMod(s[1])}`);
const fmtStrike = s => `<div class="line"><span class="tag">${s[2] ? "ranged" : "melee"}</span> <b>${esc(s[0])}</b> ${fmtMod(s[1])}` +
  (s[3].length ? ` <span class="muted">(${esc(s[3].map(t => t.replace(/-/g, " ")).join(", "))})</span>` : "") +
  (s[4] ? `, ${esc(s[4])}` : "") + `</div>`;
const fmtCasting = e => `<div class="line"><b>${esc(cap(e[1]))} ${esc(e[2])}</b>` +
  (e[3] ? ` DC ${e[3]}` : "") + (e[4] != null ? `, attack ${fmtMod(e[4])}` : "") + `</div>`;
const fmtSpellList = e => Object.entries(e[5]).sort((a, b) => a[0] - b[0])
  .map(([r, names]) => `<div class="line"><span class="rank">${rankLabel(r)}</span> ${esc(names.join(", "))}</div>`).join("");
const best = (arr, f) => { const v = (arr || []).filter(f).map(s => s[1]).filter(x => x != null); return v.length ? Math.max(...v) : null; };
const skillVal = (c, k) => { const s = (c.sk || []).find(x => x[0] === k); return s ? s[1] : null; };

const COL = {
  add: { label: "", cell: () => `<button class="add" title="Add to encounter">+</button>` },
  n: { label: "Name", sort: c => c.n, cls: "name", cell: c => esc(c.n) },
  l: { label: "Lvl", sort: c => c.l, cls: "num", cell: c => c.l },
  xp: { label: "XP", cls: "num", cell: c => xpFor(c, "normal") ?? "—" },
  type: { label: "Type", cls: "hide-sm", cell: c => (c.k === "c" ? creatureTypes(c).map(cap).join(", ") : KIND[c.k]) },
  role: { label: "Role", cell: c => c.ro.map(r => `<span class="tag">${r}</span>`).join("") },
  traits: { label: "Traits", cls: "traits hide-sm", cell: c => c.t.map(esc).join(", ") },
  z: { label: "Size", sort: c => SIZE_ORDER.indexOf(c.z), cell: c => SIZE[c.z] || c.z },
  r: { label: "Rarity", sort: c => RARITY.indexOf(c.r), cls: "hide-sm", cell: c => `<span class="rar-${c.r}">${c.r}</span>` },
  src: { label: "Source", cls: "src hide-sm", cell: c => {
    const s = SRC[c.s[0]].n.replace(/^Pathfinder /, "") + (c.s.length > 1 ? ` +${c.s.length - 1}` : "");
    return `<span title="${esc(c.s.map(i => SRC[i].n).join("\n"))}">${esc(s)}</span>`;
  } },
  senses: { label: "Senses", cls: "wide-s", cell: fmtSenses },
  abilities: { label: "Abilities", cls: "wide", cell: c => listCell(c.ab) },
  imm: { label: "Immunities", cls: "wide-s", cell: c => listCell(c.im, fmtIwr) },
  res: { label: "Resistances", cls: "wide-s", cell: c => listCell(c.rs, fmtIwr) },
  weak: { label: "Weaknesses", cls: "wide-s", cell: c => listCell(c.wk, fmtIwr) },
  hard: { label: "Hardness", sort: c => c.hd, cls: "num", cell: c => c.hd ?? "—" },
  hp: { label: "HP", sort: c => c.hp, cls: "num", cell: c => c.hp ?? "—" },
  ac: { label: "AC", sort: c => c.ac, cls: "num", cell: c => c.ac ?? "—" },
  fort: { label: "Fort", sort: c => c.sv[0], cls: "num", cell: c => fmtMod(c.sv[0]) },
  ref: { label: "Ref", sort: c => c.sv[1], cls: "num", cell: c => fmtMod(c.sv[1]) },
  will: { label: "Will", sort: c => c.sv[2], cls: "num", cell: c => fmtMod(c.sv[2]) },
  per: { label: "Per", sort: c => c.pe, cls: "num", cell: c => fmtMod(c.pe) },
  stealth: { label: "Stealth", sort: c => c.stl ?? skillVal(c, "stealth"), cls: "num",
    cell: c => (c.stl != null && c.k !== "c" ? "DC " + (c.stl + 10) : fmtMod(c.stl ?? skillVal(c, "stealth"))) },
  speed: { label: "Speed", sort: c => Math.max(0, ...(c.sp || []).map(s => s[1] || 0)), cls: "speed", cell: fmtSpeeds },
  attrs: { label: "Attributes", cls: "attrs", cell: fmtAttrs },
  skills: { label: "Top skills", cls: "nowrap", cell: c => (c.sk || []).slice(0, 4)
    .map(s => `<div>${esc(cap(s[0]))} ${fmtMod(s[1])}</div>`).join("") || `<span class="muted">—</span>` },
  melee: { label: "Melee", sort: c => best(c.st, s => !s[2]), cls: "num", cell: c => fmtMod(best(c.st, s => !s[2])) },
  ranged: { label: "Ranged", sort: c => best(c.st, s => s[2]), cls: "num", cell: c => fmtMod(best(c.st, s => s[2])) },
  strikes: { label: "Strikes", cls: "wide", cell: c => (c.st || []).map(fmtStrike).join("") || `<span class="muted">—</span>` },
  dc: { label: "DC", sort: c => Math.max(0, ...(c.sc || []).map(e => e[3] || 0)) || null, cls: "num",
    cell: c => (c.sc || []).map(e => e[3]).filter(Boolean).join(" / ") || "—" },
  satk: { label: "Atk", sort: c => best((c.sc || []).map(e => [0, e[4]]), () => true), cls: "num",
    cell: c => (c.sc || []).map(e => e[4]).filter(v => v != null).map(fmtMod).join(" / ") || "—" },
  casting: { label: "Spellcasting", cls: "wide-s", cell: c => (c.sc || []).map(fmtCasting).join("") || `<span class="muted">—</span>` },
  spells: { label: "Spells by rank", cls: "wide", cell: c => (c.sc || []).map(e => `<div class="entry">${fmtSpellList(e)}</div>`).join("") || `<span class="muted">—</span>` },
};
const TABS = [
  { id: "overview", label: "Overview", cols: ["add", "n", "l", "xp", "type", "role", "traits", "z", "r", "src"] },
  { id: "abilities", label: "Abilities & defenses", cols: ["add", "n", "l", "senses", "abilities", "imm", "res", "weak", "hard"] },
  { id: "stats", label: "Stats", cols: ["add", "n", "l", "hp", "ac", "fort", "ref", "will", "per", "stealth", "speed", "attrs", "skills"] },
  { id: "strikes", label: "Strikes", cols: ["add", "n", "l", "melee", "ranged", "strikes"] },
  { id: "spells", label: "Spells", cols: ["add", "n", "l", "dc", "satk", "casting", "spells"] },
];
const currentTab = () => TABS.find(t => t.id === state.tab) || TABS[0];

function renderTabs() {
  document.getElementById("tabs").innerHTML = TABS.map(t =>
    `<button class="tab${t.id === currentTab().id ? " on" : ""}" data-tab="${t.id}">${t.label}</button>`).join("");
}

function renderTable() {
  const tab = currentTab();
  if (!tab.cols.includes(state.sort.key) || !COL[state.sort.key].sort) state.sort = { key: "l", dir: 1 };
  const rows = filtered();
  const { key, dir } = state.sort;
  const val = COL[key].sort;
  rows.sort((a, b) => {
    const x = val(a), y = val(b);
    if (x == null || y == null) return (x == null) - (y == null) || a.n.localeCompare(b.n);
    return (typeof x === "string" ? x.localeCompare(y) : x - y) * dir || a.n.localeCompare(b.n);
  });
  document.getElementById("matchCount").textContent = `${rows.length.toLocaleString()} match`;
  document.getElementById("thead").innerHTML = "<tr>" + tab.cols.map(id => {
    const col = COL[id];
    const cls = [col.cls, col.sort ? "sortable" : "", id === key ? "sorted" + (dir < 0 ? " desc" : "") : ""].filter(Boolean).join(" ");
    return `<th${col.sort ? ` data-sort="${id}"` : ""} class="${cls}">${col.label}</th>`;
  }).join("") + "</tr>";
  document.getElementById("tbody").innerHTML = rows.slice(0, shown).map(c =>
    `<tr data-id="${esc(c.id)}">` + tab.cols.map(id => `<td class="${COL[id].cls || ""}">${COL[id].cell(c)}</td>`).join("") + "</tr>"
  ).join("");
  const more = document.getElementById("moreBtn");
  more.hidden = rows.length <= shown;
  more.textContent = `Show more (${(rows.length - shown).toLocaleString()} left)`;
}

function addToEncounter(id) {
  const c = BY_ID.get(id);
  const ex = state.encounter.find(e => e.id === id && e.adj === "normal" && c.k === "c");
  if (ex) ex.count++;
  else state.encounter.push({ uid: uid++, id, adj: "normal", count: 1, locked: false });
  renderEncounter();
}

function renderEncounter() {
  const list = document.getElementById("encounterList");
  const budget = budgetFor(state.party.difficulty);
  let spent = 0;
  let tooHigh = false;
  list.innerHTML = "";
  for (const e of state.encounter) {
    const c = BY_ID.get(e.id);
    const xp = xpFor(c, e.adj);
    if (xp === null) tooHigh = true;
    spent += (xp || 0) * e.count;
    const lvl = adjLevel(c, e.adj);
    const li = document.createElement("li");
    li.className = "enc-item" + (e.locked ? " locked" : "");
    const adjOpts = ["weak", "normal", "elite"].filter(a => canAdjust(c, a))
      .map(a => `<option value="${a}"${a === e.adj ? " selected" : ""}>${a[0].toUpperCase() + a.slice(1)}</option>`).join("");
    li.innerHTML = `
      <div class="enc-name" title="${esc(c.n)}">${esc(c.n)}</div>
      <div class="enc-xp ${xp === null ? "over" : ""}">${xp === null ? "too high" : (xp * e.count) + " XP"}</div>
      <div class="enc-ctrl">
        <span class="lvl">Lvl ${lvl} · ${relLabel(lvl - state.party.level)} · ${KIND[c.k]}</span>
        <span class="spacer"></span>
        ${c.k === "c" ? `<select class="adj" title="Weak / elite adjustment">${adjOpts}</select>` : ""}
        ${c.k === "c" ? `<button class="dec" title="One fewer">−</button><span class="count">${e.count}</span><button class="inc" title="One more">+</button>` : ""}
        <button class="lock${e.locked ? " on" : ""}" title="Lock: keep this entry when re-rolling">${e.locked ? "Locked" : "Lock"}</button>
        <button class="rm ghost" title="Remove">×</button>
      </div>`;
    li.querySelector(".enc-name").addEventListener("click", () => openDrawer(c));
    const adjSel = li.querySelector(".adj");
    if (adjSel) adjSel.addEventListener("change", () => { e.adj = adjSel.value; renderEncounter(); });
    const dec = li.querySelector(".dec");
    if (dec) dec.addEventListener("click", () => { e.count--; if (e.count <= 0) state.encounter = state.encounter.filter(x => x !== e); renderEncounter(); });
    const inc = li.querySelector(".inc");
    if (inc) inc.addEventListener("click", () => { e.count++; renderEncounter(); });
    li.querySelector(".lock").addEventListener("click", () => { e.locked = !e.locked; renderEncounter(); });
    li.querySelector(".rm").addEventListener("click", () => { state.encounter = state.encounter.filter(x => x !== e); renderEncounter(); });
    list.appendChild(li);
  }
  document.getElementById("encEmpty").hidden = state.encounter.length > 0;
  document.getElementById("budget").textContent = budget;
  document.getElementById("spent").textContent = spent;
  const rem = document.getElementById("remaining");
  rem.textContent = budget - spent;
  rem.classList.toggle("over", spent > budget);
  const t = document.getElementById("threat");
  const th = tooHigh ? "beyond" : threatOf(spent);
  t.textContent = th === "beyond" ? "Beyond extreme" : th;
  t.className = "v threat " + th;
  saveState();
}

/* ---------- stat blocks (data/statblocks/<pack>.js, loaded on demand) ---------- */

window.EB_SB = window.EB_SB || {};
window.EB_SB_ADD = blocks => Object.assign(window.EB_SB, blocks);
const shardLoads = new Map();

function loadStatblock(c) {
  const pack = c.id.split("/")[0];
  if (!shardLoads.has(pack)) {
    shardLoads.set(pack, new Promise((resolve, reject) => {
      const el = document.createElement("script");
      el.src = `data/statblocks/${encodeURIComponent(pack)}.js`;
      el.onload = resolve;
      el.onerror = () => { shardLoads.delete(pack); reject(new Error("missing shard " + pack)); };
      document.head.appendChild(el);
    }));
  }
  return shardLoads.get(pack).then(() => window.EB_SB[c.id]);
}

const GLYPH = { 1: "◆", 2: "◆◆", 3: "◆◆◆", r: "⤾", f: "◇" };
const glyph = a => (a && GLYPH[a] ? `<span class="glyph" title="${{ r: "Reaction", f: "Free action" }[a] || a + " action" + (a > 1 ? "s" : "")}">${GLYPH[a]}</span>` : "");
const line = (label, body) => (body ? `<div class="sb-line"><b>${label}</b> ${body}</div>` : "");
const note = s => (s ? ` <span class="muted">(${esc(s)})</span>` : "");

function abilityHtml(a) {
  const traits = a.t.length ? ` <span class="muted">(${esc(a.t.join(", "))})</span>` : "";
  const freq = a.f && !/Frequency/.test(a.d || "") ? `<div class="sb-freq"><b>Frequency</b> ${esc(a.f)}</div>` : "";
  return `<div class="sb-ability"><div class="sb-ab-head"><b>${esc(a.n)}</b> ${glyph(a.a)}${traits}</div>${freq}` +
    (a.d ? `<div class="sb-text">${a.d}</div>` : "") + `</div>`;
}

function strikeHtml(s, sb) {
  const traits = s[3].length ? ` <span class="muted">(${esc(s[3].map(t => t.replace(/-/g, " ")).join(", "))})</span>` : "";
  const extra = sb && sb.strikeNotes && sb.strikeNotes[s[0]] ? `<div class="sb-text">${sb.strikeNotes[s[0]]}</div>` : "";
  return `<div class="sb-line"><b>${s[2] ? "Ranged" : "Melee"}</b> ${GLYPH[1]} ${esc(s[0])} ${fmtMod(s[1])}${traits}` +
    (s[4] ? `, <b>Damage</b> ${esc(s[4])}` : "") + `</div>${extra}`;
}

function spellcastingHtml(e, focus) {
  const head = esc(e[0]);
  const stats = [e[3] ? `DC ${e[3]}` : "", e[4] != null ? `attack ${fmtMod(e[4])}` : "", e[2] === "focus" && focus ? `${focus} Focus Point${focus > 1 ? "s" : ""}` : ""].filter(Boolean).join(", ");
  const ranks = Object.entries(e[5]).sort((a, b) => b[0] - a[0])
    .map(([r, names]) => `<b>${+r === 0 ? "Cantrips" : ordinal(+r)}</b> ${esc(names.join(", "))}`).join("; ");
  return `<div class="sb-line"><b>${head}</b> ${stats}${ranks ? "; " + ranks : ""}</div>`;
}

function statblockHtml(c, sb) {
  const n = (sb && sb.notes) || {};
  const ab = (sb && sb.abilities) || [];
  const byCat = cat => ab.filter(a => a.c === cat).map(abilityHtml).join("");
  const traits = [`<span class="tag rar-${c.r}">${c.r}</span>`, c.k === "c" ? `<span class="tag">${SIZE[c.z] || c.z}</span>` : "",
    ...c.t.map(t => `<span class="tag">${esc(t)}</span>`)].join("");
  const iwr = [line("Immunities", c.im ? c.im.map(fmtIwr).join(", ") : ""),
    line("Weaknesses", c.wk ? c.wk.map(fmtIwr).join(", ") : ""),
    line("Resistances", c.rs ? c.rs.map(fmtIwr).join(", ") : "")].join("");
  const saves = `<b>Fort</b> ${fmtMod(c.sv[0])}, <b>Ref</b> ${fmtMod(c.sv[1])}, <b>Will</b> ${fmtMod(c.sv[2])}${n.saves ? "; " + esc(n.saves) : ""}`;
  const head = `<div class="sb-title"><h3>${esc(c.n)}</h3><span class="sb-kind">${c.k === "c" ? "Creature" : "Hazard"} ${c.l}</span></div>
    <div class="sb-traits">${traits}</div>`;

  if (c.k !== "c") {
    // hazards without HP/Hardness carry placeholder AC and saves
    const physical = !!(c.hp || c.hd);
    return head + `<div class="sb-sec">
        ${line("Stealth", (c.stl != null ? "DC " + (c.stl + 10) : "—") + (sb && sb.stealthNote ? " " + sb.stealthNote : ""))}
        ${sb && sb.description ? `<div class="sb-line"><b>Description</b> ${sb.description}</div>` : ""}
      </div>
      <div class="sb-sec">${sb && sb.disable ? `<div class="sb-line"><b>Disable</b> ${sb.disable}</div>` : ""}</div>
      <div class="sb-sec">
        ${physical && c.ac != null ? line("AC", c.ac) : ""}${physical && c.sv.some(v => v) ? `<div class="sb-line">${saves}</div>` : ""}
        ${line("Hardness", c.hd)}${c.hp ? line("HP", c.hp) : ""}${iwr}
        ${ab.map(abilityHtml).join("")}
      </div>
      ${sb && sb.routine ? `<div class="sb-sec"><div class="sb-line"><b>Routine</b> ${sb.routine}</div></div>` : ""}
      ${sb && sb.reset ? `<div class="sb-sec"><div class="sb-line"><b>Reset</b> ${sb.reset}</div></div>` : ""}`;
  }

  const skills = [...(c.sk || []).map(s => `${esc(cap(s[0]))} ${fmtMod(s[1])}`), ...((sb && sb.lore) || []).map(l => `${esc(l[0])} ${fmtMod(l[1])}`)];
  return head + `<div class="sb-sec">
      ${line("Perception", fmtMod(c.pe) + (c.se ? "; " + c.se.map(s => esc(s[0].toLowerCase()) + (s[1] ? " " + esc(s[1]) : "")).join(", ") : "") + note(n.per))}
      ${line("Languages", sb && sb.lang ? esc(sb.lang.join(", ")) : "")}
      ${line("Skills", skills.join(", "))}
      ${c.at ? `<div class="sb-line">${c.at.map((v, i) => `<b>${ATTRS[i]}</b> ${fmtMod(v)}`).join(", ")}</div>` : ""}
      ${line("Items", sb && sb.gear ? esc(sb.gear.join(", ")) : "")}
      ${byCat("interaction")}
    </div>
    <div class="sb-sec">
      <div class="sb-line"><b>AC</b> ${c.ac ?? "—"}${note(n.ac)}; ${saves}</div>
      <div class="sb-line"><b>HP</b> ${c.hp ?? "—"}${n.hp ? "; " + esc(n.hp) : ""}${c.hd ? `; <b>Hardness</b> ${c.hd}` : ""}</div>
      ${iwr}
      ${byCat("defensive")}
    </div>
    <div class="sb-sec">
      ${line("Speed", c.sp ? c.sp.map(s => (s[0] === "land" ? "" : esc(s[0]) + " ") + s[1] + " feet").join(", ") + note(n.speed) : "")}
      ${(c.st || []).map(s => strikeHtml(s, sb)).join("")}
      ${(c.sc || []).map(e => spellcastingHtml(e, sb && sb.focus)).join("")}
      ${byCat("offensive")}
      ${ab.filter(a => !["interaction", "defensive", "offensive"].includes(a.c)).map(abilityHtml).join("")}
    </div>
    ${sb && sb.flavor ? `<details class="sb-flavor"><summary>Description &amp; lore</summary>${sb.flavor}</details>` : ""}`;
}

function openDrawer(c) {
  const body = document.getElementById("drawerBody");
  const sources = c.s.map(i => esc(SRC[i].n)).join("; ");
  const render = (sb, msg) => {
    body.innerHTML = `<div class="sb">
      <div class="sb-actions">
        <button id="drawerAdd" class="primary">Add to encounter</button>
        <span class="muted">${xpFor(c, "normal") == null ? "Too high" : xpFor(c, "normal") + " XP"} for party level ${state.party.level}${c.ro.length ? " · " + c.ro.join(", ") : ""}</span>
      </div>
      ${statblockHtml(c, sb)}
      ${msg ? `<p class="note">${msg}</p>` : ""}
      <p class="note">${sources} · ${edition(c)}</p>
    </div>`;
    document.getElementById("drawerAdd").addEventListener("click", () => addToEncounter(c.id));
  };
  body.dataset.id = c.id;
  render(window.EB_SB[c.id], window.EB_SB[c.id] ? "" : "Loading ability texts…");
  document.getElementById("drawer").hidden = false;
  body.parentElement.scrollTop = 0;
  if (!window.EB_SB[c.id]) {
    loadStatblock(c).then(sb => { if (body.dataset.id === c.id) render(sb, sb ? "" : "No stat block data for this entry."); })
      .catch(() => { if (body.dataset.id === c.id) render(null, "Stat block file missing. Rerun build_data.py."); });
  }
}

/* ---------- saves ---------- */

function refreshSaves() {
  const saves = store.get("eb-saves", {});
  const el = document.getElementById("loadSelect");
  el.innerHTML = `<option value="">Load saved…</option>` +
    Object.keys(saves).sort().map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join("");
}
function snapshot() {
  return { party: { ...state.party }, encounter: state.encounter.map(({ uid: _, ...e }) => e) };
}
function applySnapshot(s) {
  Object.assign(state.party, s.party || {});
  state.encounter = (s.encounter || []).filter(e => BY_ID.has(e.id)).map(e => ({ ...e, uid: uid++ }));
  syncPartyControls();
  renderTable();
  renderEncounter();
}

/* ---------- Foundry export ---------- */

function encounterSummary() {
  const budget = budgetFor(state.party.difficulty);
  const entries = state.encounter.map(e => {
    const c = BY_ID.get(e.id);
    const pack = c.id.split("/")[0];
    return { name: c.n, pack: D.packs[pack] || "pf2e." + pack, id: c.u, adj: c.k === "c" ? e.adj : "normal", count: e.count, xp: xpFor(c, e.adj) == null ? null : xpFor(c, e.adj) * e.count };
  });
  const xp = entries.reduce((a, e) => a + (e.xp || 0), 0);
  return { budget, xp, threat: entries.some(e => e.xp == null) ? "beyond extreme" : threatOf(xp), entries };
}

/** Folder name: "L5 Moderate – Lich, 3× Goblin Warrior", or "L5 Moderate – <typed name>". */
function folderName(sum, typed) {
  const parts = sum.entries.slice(0, 3).map(e => (e.count > 1 ? `${e.count}× ` : "") + e.name);
  const more = sum.entries.length > 3 ? ` +${sum.entries.length - 3} more` : "";
  return `L${state.party.level} ${cap(state.party.difficulty)} – ${typed || parts.join(", ") + more}`;
}

function foundryMacro() {
  const sum = encounterSummary();
  const name = folderName(sum, document.getElementById("saveName").value.trim());
  const data = {
    name,
    party: { ...state.party },
    budget: sum.budget, xp: sum.xp, threat: sum.threat,
    entries: sum.entries,
  };
  return `// PF2e Encounter Builder export: ${name.replace(/[\r\n]/g, " ")}
// Script macro. Run as GM. Imports each creature from the pf2e compendiums into Actors > Encounters > <this encounter>,
// applies weak/elite through the pf2e system, and whispers a summary to the GM.
const ENCOUNTER = ${JSON.stringify(data, null, 2)};

if (!game.user.isGM) return ui.notifications.warn("Encounter import: run this macro as GM.");
const ROOT = "Encounters";
const root = game.folders.find(f => f.type === "Actor" && !f.folder && f.name.toLowerCase() === ROOT.toLowerCase())
  ?? await Folder.create({ name: ROOT, type: "Actor", color: "#c9a04a" });
const folder = await Folder.create({ name: ENCOUNTER.name, type: "Actor", folder: root.id });
const made = [];
const missing = [];
for (const e of ENCOUNTER.entries) {
  const pack = game.packs.get(e.pack);
  const index = pack ? await pack.getIndex() : null;
  // fall back to a name match in the same compendium if the id changed between system versions
  const id = index?.has(e.id) ? e.id : index?.find(i => i.name === e.name)?._id;
  if (!id) { missing.push(e); continue; }
  // keepId: false -> always a fresh copy; otherwise V12+ silently replaces an earlier import of the same creature
  const actor = await game.actors.importFromCompendium(pack, id, { folder: folder.id }, { keepId: false });
  const canAdjust = typeof actor?.applyAdjustment === "function";
  if (e.adj !== "normal" && canAdjust) await actor.applyAdjustment(e.adj);
  made.push({ e, actor, adjusted: e.adj === "normal" || canAdjust });
}

const adjLabel = a => (a === "normal" ? "" : \` (\${a})\`);
const rows = made.map(({ e, actor, adjusted }) => \`<li>\${e.count}× @UUID[\${actor.uuid}]{\${actor.name}}\${adjLabel(e.adj)}\${adjusted ? "" : " <strong>(apply weak/elite manually)</strong>"}: \${e.xp == null ? "more than 4 levels above the party" : e.xp + " XP"}</li>\`);
const miss = missing.map(e => \`<li>\${e.count}× \${e.name}\${adjLabel(e.adj)} (not found in \${e.pack}, is the module active?)</li>\`);
const p = ENCOUNTER.party;
await ChatMessage.create({
  whisper: ChatMessage.getWhisperRecipients("GM").map(u => u.id),
  content: \`<h3>\${ENCOUNTER.name}</h3>
<p>Party of \${p.size}, level \${p.level}: \${ENCOUNTER.xp} / \${ENCOUNTER.budget} XP (\${ENCOUNTER.threat})</p>
<ul>\${rows.join("")}</ul>\${miss.length ? \`<p><strong>Missing</strong></p><ul>\${miss.join("")}</ul>\` : ""}\`,
});
if (missing.length) ui.notifications.warn(\`Encounter import: \${missing.length} creature(s) not found, see chat.\`);
else ui.notifications.info(\`Encounter "\${ENCOUNTER.name}" imported: \${made.length} actor(s).\`);
`;
}

function openMacroDialog() {
  const msg = document.getElementById("macroMsg");
  msg.textContent = "";
  if (!state.encounter.length) { alert("The encounter is empty."); return; }
  document.getElementById("macroText").value = foundryMacro();
  document.getElementById("macroDialog").showModal();
}

/* ---------- wiring ---------- */

function syncPartyControls() {
  document.getElementById("partySize").value = state.party.size;
  document.getElementById("partyLevel").value = state.party.level;
  document.getElementById("difficulty").value = state.party.difficulty;
}

function init() {
  loadState();
  sel("partySize", Array.from({ length: 8 }, (_, i) => [i + 1, i + 1]), state.party.size);
  sel("partyLevel", Array.from({ length: 21 }, (_, i) => [i, i]), state.party.level);
  sel("difficulty", THREATS.map(([n]) => [n, n[0].toUpperCase() + n.slice(1)]), state.party.difficulty);
  const rels = Array.from({ length: 9 }, (_, i) => i - 4).map(r => [r, relLabel(r)]);
  sel("relMin", rels, state.relMin);
  sel("relMax", rels, state.relMax);
  sel("maxCreatures", Array.from({ length: 12 }, (_, i) => [i + 1, i + 1]), state.gen.max);
  document.getElementById("structure").value = state.gen.structure;
  document.getElementById("allowRepeats").checked = state.gen.repeats;
  document.getElementById("allowAdjust").checked = state.gen.adjust;
  document.getElementById("nameSearch").value = state.name;

  const on = (id, ev, fn) => document.getElementById(id).addEventListener(ev, fn);
  on("partySize", "change", e => { state.party.size = +e.target.value; renderEncounter(); });
  on("partyLevel", "change", e => { state.party.level = +e.target.value; shown = PAGE; renderTable(); renderEncounter(); });
  on("difficulty", "change", e => { state.party.difficulty = e.target.value; renderEncounter(); });
  on("relMin", "change", e => {
    state.relMin = +e.target.value;
    if (state.relMax < state.relMin) { state.relMax = state.relMin; document.getElementById("relMax").value = state.relMax; }
    onFiltersChanged();
  });
  on("relMax", "change", e => {
    state.relMax = +e.target.value;
    if (state.relMin > state.relMax) { state.relMin = state.relMax; document.getElementById("relMin").value = state.relMin; }
    onFiltersChanged();
  });
  let nameTimer;
  on("nameSearch", "input", e => { clearTimeout(nameTimer); nameTimer = setTimeout(() => { state.name = e.target.value.trim(); onFiltersChanged(); }, 150); });
  on("clearFilters", "click", () => {
    for (const f of FILTERS) state.filters[f.key] = { inc: [], exc: [], mode: "any" };
    state.name = ""; document.getElementById("nameSearch").value = "";
    state.relMin = -4; state.relMax = 4;
    document.getElementById("relMin").value = -4; document.getElementById("relMax").value = 4;
    closeDD();
    onFiltersChanged();
  });

  on("structure", "change", e => { state.gen.structure = e.target.value; saveState(); });
  on("maxCreatures", "change", e => { state.gen.max = +e.target.value; saveState(); });
  on("allowRepeats", "change", e => { state.gen.repeats = e.target.checked; saveState(); });
  on("allowAdjust", "change", e => { state.gen.adjust = e.target.checked; saveState(); });
  on("randomBtn", "click", () => { document.getElementById("genMsg").style.color = ""; generate(); });
  on("clearEncounter", "click", () => { state.encounter = state.encounter.filter(e => e.locked); renderEncounter(); });

  on("tbody", "click", e => {
    const tr = e.target.closest("tr");
    if (!tr) return;
    const c = BY_ID.get(tr.dataset.id);
    if (e.target.closest(".add")) addToEncounter(c.id);
    else if (e.target.closest(".name")) openDrawer(c);
  });
  on("moreBtn", "click", () => { shown += PAGE; renderTable(); });
  on("thead", "click", e => {
    const th = e.target.closest("th[data-sort]");
    if (!th) return;
    const k = th.dataset.sort;
    state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : 1 };
    renderTable();
    saveState();
  });
  on("tabs", "click", e => {
    const b = e.target.closest("[data-tab]");
    if (!b) return;
    state.tab = b.dataset.tab;
    renderTabs();
    renderTable();
    saveState();
  });

  on("drawerClose", "click", () => { document.getElementById("drawer").hidden = true; });
  on("drawer", "click", e => { if (e.target.id === "drawer") e.currentTarget.hidden = true; });
  document.addEventListener("click", closeDD);
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") { closeDD(); document.getElementById("drawer").hidden = true; }
  });

  on("saveBtn", "click", () => {
    const name = document.getElementById("saveName").value.trim();
    if (!name || !state.encounter.length) return;
    const saves = store.get("eb-saves", {});
    saves[name] = snapshot();
    store.set("eb-saves", saves);
    refreshSaves();
    document.getElementById("loadSelect").value = name;
  });
  on("loadSelect", "change", e => {
    const s = store.get("eb-saves", {})[e.target.value];
    if (s) { applySnapshot(s); document.getElementById("saveName").value = e.target.value; }
  });
  on("deleteSave", "click", () => {
    const name = document.getElementById("loadSelect").value;
    if (!name || !confirm(`Delete saved encounter "${name}"?`)) return;
    const saves = store.get("eb-saves", {});
    delete saves[name];
    store.set("eb-saves", saves);
    refreshSaves();
  });
  on("exportBtn", "click", () => {
    const name = document.getElementById("saveName").value.trim() || "encounter";
    const out = { name, ...snapshot(), creatures: state.encounter.map(e => ({ name: BY_ID.get(e.id).n, id: e.id, adj: e.adj, count: e.count })) };
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: "application/json" }));
    a.download = name.replace(/[^\w-]+/g, "_") + ".json";
    a.click();
    URL.revokeObjectURL(a.href);
  });
  on("macroBtn", "click", openMacroDialog);
  on("macroClose", "click", () => document.getElementById("macroDialog").close());
  on("macroCopy", "click", async () => {
    const ta = document.getElementById("macroText");
    const msg = document.getElementById("macroMsg");
    try { await navigator.clipboard.writeText(ta.value); msg.textContent = "Copied."; }
    catch { ta.select(); msg.textContent = document.execCommand("copy") ? "Copied." : "Select the text and copy it manually."; }
  });
  on("macroDownload", "click", () => {
    const name = (document.getElementById("saveName").value.trim() || "encounter").replace(/[^\w-]+/g, "_");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([document.getElementById("macroText").value], { type: "text/javascript" }));
    a.download = name + "-foundry-macro.js";
    a.click();
    URL.revokeObjectURL(a.href);
  });
  on("importFile", "change", async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const s = JSON.parse(await file.text());
      applySnapshot(s);
      if (s.name) document.getElementById("saveName").value = s.name;
    } catch { alert("Could not read that file as an encounter export."); }
    e.target.value = "";
  });

  buildFilterBar();
  renderTabs();
  refreshSaves();
  renderTable();
  renderEncounter();
}

init();
