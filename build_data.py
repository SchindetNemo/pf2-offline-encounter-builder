#!/usr/bin/env python3
"""Build the offline encounter-builder creature index from the local pf2e-system packs.

Usage:
  python3 -I encounter-builder/build_data.py              # writes data/creatures.js + data/statblocks/<pack>.js
  python3 -I encounter-builder/build_data.py --no-modules # pf2e system only (leave out module-packs/, e.g. premium Battlezoo)
Module creatures come from module-packs/, refreshed with: node encounter-builder/export_modules.mjs
Rerun after updating pf2e-system. Roles are derived per level from the data itself (see derive_roles).
"""
import bisect
import collections
import glob
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from statblocks import Enricher, statblock  # noqa: E402
PROJECT = os.path.dirname(HERE)
PACKS = os.path.join(PROJECT, "pf2e-system", "packs", "pf2e")
OUT = os.path.join(HERE, "data", "creatures.js")
SB_DIR = os.path.join(HERE, "data", "statblocks")
MODULE_PACKS = os.path.join(HERE, "module-packs")

ROLES = ["Brute", "Magical Striker", "Skill Paragon", "Skirmisher", "Sniper", "Soldier", "Spellcaster"]


def source_group(title):
    if not title:
        return "Other"
    if "Society" in title:
        return "Pathfinder Society"
    if "Adventure Path" in title or re.search(r"#\d+", title) or "Hardcover Compilation" in title:
        return "Adventure Paths"
    if "Blog" in title:
        return "Web & Misc"
    if re.search(r"Adventure|Beginner Box|One-Shot|Kingmaker|Free RPG|Bounty|Quest|Game Night|"
                 r"Claws of the Tyrant|Dead God's Hand", title):
        return "Adventures"
    return "Rulebooks"


def strikes(items):
    out = []
    for i in items:
        if i["type"] != "melee":
            continue
        s = i["system"]
        traits = s.get("traits", {}).get("value", [])
        ranged = bool(s.get("range")) or any(t.startswith("range") for t in traits)
        bonus = (s.get("bonus") or {}).get("value")
        if isinstance(bonus, (int, float)):
            out.append((bonus, ranged))
    return out


def spellcasting(items):
    entries = {i["_id"]: i["system"] for i in items if i["type"] == "spellcastingEntry"}
    counts = collections.Counter(i["system"].get("location", {}).get("value") for i in items if i["type"] == "spell")
    kinds = {e.get("prepared", {}).get("value") for e in entries.values()}
    dc = max([(e.get("spelldc") or {}).get("dc") or 0 for e in entries.values()] or [0])
    nspells = sum(counts[k] for k in entries)
    return kinds, nspells, dc


def title(slug):
    if slug == "low-light-vision":
        return "Low-Light Vision"
    return " ".join(w.capitalize() for w in str(slug).replace("_", " ").split("-"))


def iwr(lst, with_value=True):
    """Immunities / resistances / weaknesses as [type, value, note]."""
    out = []
    for x in lst or []:
        note = []
        exc = [e if isinstance(e, str) else (e.get("label") or e.get("type", "")) for e in x.get("exceptions") or []]
        if exc:
            note.append("except " + ", ".join(e.replace("-", " ") for e in exc))
        dbl = [e if isinstance(e, str) else (e.get("label") or "") for e in x.get("doubleVs") or []]
        if dbl:
            note.append("double vs " + ", ".join(e.replace("-", " ") for e in dbl))
        t = str(x.get("type", "")).replace("-", " ")
        out.append([t, x.get("value"), "; ".join(note)] if with_value else ([t, "; ".join(note)] if note else [t]))
    return out


def damage_text(sysm):
    parts, types = [], []
    for r in (sysm.get("damageRolls") or {}).values():
        dt = r.get("damageType") or "untyped"
        cat = r.get("category")
        parts.append(f"{r.get('damage', '')} {cat + ' ' if cat else ''}{dt}".strip())
        types.append(dt)
    effects = [e.replace("-", " ") for e in (sysm.get("attackEffects") or {}).get("value", [])]
    text = " plus ".join(parts + effects)
    return text, sorted(set(types))


def details(d):
    """Extra fields for the Abilities / Stats / Strikes / Spells views."""
    s = d["system"]
    at = s.get("attributes") or {}
    items = d.get("items", [])
    out = {}

    senses = []
    for x in (s.get("perception") or {}).get("senses") or []:
        det = " ".join(str(p) for p in (x.get("acuity"), f"{x['range']} ft" if x.get("range") else None) if p)
        senses.append([title(x.get("type", "")), det])
    out["se"] = senses
    out["ab"] = [i["name"] for i in items if i["type"] == "action"]
    out["im"] = iwr(at.get("immunities"), with_value=False)
    out["rs"] = iwr(at.get("resistances"))
    out["wk"] = iwr(at.get("weaknesses"))
    hd = at.get("hardness")
    out["hd"] = (hd.get("value") if isinstance(hd, dict) else hd) or None

    speed = at.get("speed") or {}
    sp = [["land", speed.get("value")]] if speed.get("value") else []
    sp += [[str(o.get("type", "")).lower(), o.get("value")] for o in speed.get("otherSpeeds") or []]
    out["sp"] = sp

    ab = s.get("abilities") or {}
    if ab:
        out["at"] = [(ab.get(k) or {}).get("mod", 0) for k in ("str", "dex", "con", "int", "wis", "cha")]
    sk = [[k, v.get("base")] for k, v in (s.get("skills") or {}).items() if isinstance(v.get("base"), (int, float))]
    out["sk"] = sorted(sk, key=lambda x: -x[1])
    if d["type"] == "hazard":
        out["stl"] = (at.get("stealth") or {}).get("value")

    st = []
    for i in items:
        if i["type"] != "melee":
            continue
        m = i["system"]
        traits = m.get("traits", {}).get("value", [])
        ranged = 1 if (m.get("range") or any(t.startswith("range") for t in traits)) else 0
        text, types = damage_text(m)
        st.append([i["name"], (m.get("bonus") or {}).get("value"), ranged, traits, text, types])
    out["st"] = st

    sc = []
    spells = [i for i in items if i["type"] == "spell"]
    for e in (i for i in items if i["type"] == "spellcastingEntry"):
        es = e["system"]
        ranks = collections.defaultdict(list)
        for sp_ in spells:
            loc = sp_["system"].get("location") or {}
            if loc.get("value") != e["_id"]:
                continue
            tr = sp_["system"].get("traits", {}).get("value", [])
            rank = 0 if "cantrip" in tr else (loc.get("heightenedLevel") or (sp_["system"].get("level") or {}).get("value") or 0)
            ranks[rank].append(sp_["name"])
        sc.append([
            e["name"],
            (es.get("tradition") or {}).get("value") or "",
            (es.get("prepared") or {}).get("value") or "",
            (es.get("spelldc") or {}).get("dc"),
            (es.get("spelldc") or {}).get("value"),
            {str(r): sorted(set(n)) for r, n in sorted(ranks.items())},
        ])
    out["sc"] = sc
    # drop empty fields to keep the data file small
    return {k: v for k, v in out.items() if v not in ([], None, {})}


def _read(f):
    try:
        with open(f) as fh:
            d = json.load(fh)
    except (OSError, ValueError):
        return None
    return d if isinstance(d, dict) and d.get("type") in ("npc", "hazard") else None


def load(with_modules=True):
    """Rows of (key, document, module meta or None). key = '<pack>/<path>' without .json."""
    rows = []
    for f in sorted(glob.glob(os.path.join(PACKS, "**", "*.json"), recursive=True)):
        if not os.path.basename(f).startswith("_") and (d := _read(f)):
            rows.append((os.path.relpath(f, PACKS)[:-5], d, None))
    if with_modules:
        for info_file in sorted(glob.glob(os.path.join(MODULE_PACKS, "*", "_module.json"))):
            with open(info_file) as fh:
                info = json.load(fh)
            for pack, pinfo in info["packs"].items():
                meta = {"group": info["group"], "game": pinfo.get("game", info["game"]), "collection": pinfo["collection"]}
                for f in sorted(glob.glob(os.path.join(os.path.dirname(info_file), pack, "*.json"))):
                    if d := _read(f):
                        rows.append((f"{pinfo['collection']}/{d['_id']}", d, meta))
    return rows


def module_names():
    names = {}
    for f in glob.glob(os.path.join(MODULE_PACKS, "*", "_names.json")):
        with open(f) as fh:
            names.update(json.load(fh))
    return names


def features(d):
    s = d["system"]
    at = s.get("attributes", {})
    saves = s.get("saves", {})
    st = strikes(d.get("items", []))
    kinds, nspells, dc = spellcasting(d.get("items", []))
    speed = at.get("speed", {}) or {}
    other = [o.get("value") or 0 for o in speed.get("otherSpeeds", []) or []]
    ab = s.get("abilities", {}) or {}
    return {
        "ac": (at.get("ac") or {}).get("value"),
        "hp": (at.get("hp") or {}).get("max"),
        "fort": (saves.get("fortitude") or {}).get("value"),
        "ref": (saves.get("reflex") or {}).get("value"),
        "will": (saves.get("will") or {}).get("value"),
        "per": (s.get("perception") or {}).get("mod"),
        "atk": max([b for b, _ in st] or [None], key=lambda x: -999 if x is None else x),
        "ratk": max([b for b, r in st if r] or [None], key=lambda x: -999 if x is None else x),
        "skills": [v.get("base") for v in (s.get("skills") or {}).values() if isinstance(v.get("base"), (int, float))],
        "speed": max([speed.get("value") or 0] + other),
        "str": (ab.get("str") or {}).get("mod", 0),
        "dex": (ab.get("dex") or {}).get("mod", 0),
        "kinds": kinds, "nspells": nspells, "dc": dc or None,
    }


class LevelDist:
    """Percentile of a stat among all creatures of the same level."""

    def __init__(self):
        self.vals = collections.defaultdict(lambda: collections.defaultdict(list))

    def add(self, lvl, key, v):
        if isinstance(v, (int, float)):
            self.vals[key][lvl].append(v)

    def finish(self):
        for by_lvl in self.vals.values():
            for lst in by_lvl.values():
                lst.sort()

    def p(self, lvl, key, v):
        lst = self.vals[key].get(lvl)
        if v is None or not lst or len(lst) < 2:
            return 0.5 if v is not None else None
        lo, hi = bisect.bisect_left(lst, v), bisect.bisect_right(lst, v)
        return ((lo + hi) / 2) / len(lst)


def derive_roles(lvl, f, dist):
    """Approximate GM Core creature roles from stat percentiles at the creature's level."""
    P = lambda k, v=None: dist.p(lvl, k, f[k] if v is None else v)  # noqa: E731
    ac, hp, fort, ref, will, per, atk = (P(k) for k in ("ac", "hp", "fort", "ref", "will", "per", "atk"))
    hi = lambda x, t=0.6: x is not None and x >= t  # noqa: E731
    lo = lambda x, t=0.4: x is not None and x <= t  # noqa: E731
    full_caster = bool(f["kinds"] & {"prepared", "spontaneous"}) or (f["nspells"] >= 6 and hi(P("dc"), 0.5))
    any_magic = f["nspells"] >= 2
    roles = []
    if hi(hp) and hi(fort) and (lo(ac, 0.5) or lo(ref) or lo(will)) and f["str"] >= f["dex"]:
        roles.append("Brute")
    if any_magic and not full_caster and hi(atk):
        roles.append("Magical Striker")
    if f["skills"]:
        top = sum(1 for v in f["skills"] if hi(dist.p(lvl, "skill", v), 0.75))
        if top >= 3 and (hi(ref, 0.5) or hi(will, 0.5)):
            roles.append("Skill Paragon")
    if hi(ref) and f["dex"] >= f["str"] and hi(P("speed"), 0.65):
        roles.append("Skirmisher")
    if f["ratk"] is not None and hi(P("atk", f["ratk"]), 0.5) and hi(per, 0.5) and f["dex"] >= f["str"]:
        roles.append("Sniper")
    if hi(ac) and hi(fort, 0.5) and hi(atk, 0.5) and not full_caster:
        roles.append("Soldier")
    if full_caster:
        roles.append("Spellcaster")
    return roles


def compendium_names():
    """Pack folder -> Foundry compendium name (pf2e.<name>), from the system manifest."""
    manifest = os.path.join(PROJECT, "pf2e-system", "system.pf2e.json")
    try:
        with open(manifest) as fh:
            packs = json.load(fh).get("packs", [])
    except (OSError, ValueError):
        return {}
    return {os.path.basename(p.get("path", "")): "pf2e." + p["name"] for p in packs if p.get("type") == "Actor"}


def write_statblocks(creatures, docs):
    """One JS shard per pack: window.EB_SB_ADD({id: statblock, ...})."""
    en = Enricher(PACKS)
    en.names.update(module_names())
    for attempt in (1, 2):
        shards = collections.defaultdict(dict)
        for c in creatures:
            shards[c["id"].split("/")[0]][c["id"]] = statblock(docs[c["id"]], en)
        missing = {k for k in en.used_keys if k not in en.lang}
        # first run (or new keys): pull the strings from the Foundry install, then convert again
        if attempt == 1 and missing and en.refresh_glossary(en.used_keys):
            en.used_keys = set()
            continue
        break
    if os.path.isdir(SB_DIR):
        for f in glob.glob(os.path.join(SB_DIR, "*.js")):
            os.remove(f)
    os.makedirs(SB_DIR, exist_ok=True)
    total = 0
    for pack, blocks in shards.items():
        path = os.path.join(SB_DIR, pack + ".js")
        with open(path, "w") as fh:
            fh.write("window.EB_SB_ADD(")
            json.dump(blocks, fh, separators=(",", ":"), ensure_ascii=False)
            fh.write(");\n")
        total += os.path.getsize(path)
    missing = sorted(k for k in en.used_keys if k not in en.lang)
    print(f"stat blocks: {len(shards)} shards, {total // 1024} KB; unresolved glossary keys: {len(missing)} {missing[:5]}")


def main():
    with_modules = "--no-modules" not in sys.argv
    rows = load(with_modules)
    dist = LevelDist()
    feats = {}
    for path, d, meta in rows:
        if d["type"] != "npc":
            continue
        lvl = d["system"]["details"]["level"]["value"]
        f = feats[path] = features(d)
        for k in ("ac", "hp", "fort", "ref", "will", "per", "atk", "speed", "dc"):
            dist.add(lvl, k, f[k])
        for v in f["skills"]:
            dist.add(lvl, "skill", v)
    dist.finish()

    sources, src_idx = [], {}
    merged = {}
    docs = {}
    for path, d, meta in rows:
        s = d["system"]
        det = s["details"]
        lvl = det["level"]["value"]
        pub = det.get("publication") or {}
        title = pub.get("title") or (meta["group"] if meta else "Unknown")
        if meta and meta["game"] == "sf2e" and "(Pathfinder)" in title:
            title = title.replace("(Pathfinder)", "(Starfinder)")  # Elemental Storm labels both packs "(Pathfinder)"
        if title not in src_idx:
            src_idx[title] = len(sources)
            sources.append({"n": title, "g": meta["group"] if meta else source_group(title)})
        tr = s.get("traits") or {}
        at = s.get("attributes") or {}
        if d["type"] == "hazard":
            kind = "hc" if det.get("isComplex") else "hs"
            roles = []
        else:
            kind = "c"
            roles = derive_roles(lvl, feats[path], dist)
        hp = (at.get("hp") or {}).get("max")
        ac = (at.get("ac") or {}).get("value")
        key = (d["name"].lower(), lvl, kind, hp, ac, meta["game"] if meta else "pf2e")
        if key in merged:
            m = merged[key]
            if src_idx[title] not in m["s"]:
                m["s"].append(src_idx[title])
            m["rm"] = m["rm"] or bool(pub.get("remaster"))
            continue
        saves = s.get("saves") or {}
        docs[path] = d
        merged[key] = {
            "id": path,  # pack/file without .json: key for the stat-block shards
            "u": d["_id"],  # Foundry document id inside the pf2e compendium (for the macro export)
            "n": d["name"],
            "l": lvl,
            "k": kind,
            "r": tr.get("rarity") or "common",
            "z": (tr.get("size") or {}).get("value") or "med",
            "t": sorted(tr.get("value") or []),
            "ro": roles,
            "s": [src_idx[title]],
            "rm": bool(pub.get("remaster")),
            **({"g": meta["game"]} if meta and meta["game"] != "pf2e" else {}),
            "hp": hp,
            "ac": ac,
            "sv": [(saves.get(x) or {}).get("value") for x in ("fortitude", "reflex", "will")],
            "pe": (s.get("perception") or {}).get("mod"),
            **details(d),
        }

    creatures = sorted(merged.values(), key=lambda c: (c["n"].lower(), c["l"]))
    packs = compendium_names()
    packs.update({m["collection"]: m["collection"] for _, _, m in rows if m})
    data = {"version": 1, "roles": ROLES, "sources": sources, "packs": packs, "creatures": creatures}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as fh:
        fh.write("window.EB_DATA = ")
        json.dump(data, fh, separators=(",", ":"), ensure_ascii=False)
        fh.write(";\n")

    write_statblocks(creatures, docs)

    rc = collections.Counter(r for c in creatures for r in c["ro"])
    kinds = collections.Counter(c["k"] for c in creatures)
    print(f"{len(rows)} documents -> {len(creatures)} entries {dict(kinds)}; {len(sources)} sources")
    print("roles:", dict(rc), "| no role:", sum(1 for c in creatures if c["k"] == "c" and not c["ro"]))
    print(f"wrote {os.path.relpath(OUT, PROJECT)} ({os.path.getsize(OUT) // 1024} KB)")


if __name__ == "__main__":
    main()
