"""Stat-block extraction for the encounter builder: ability texts with Foundry enrichers made readable.

Used by build_data.py. Output is one JS shard per pack in data/statblocks/, loaded on demand by the page.
"""
import glob
import html
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
GLOSSARY = os.path.join(HERE, "lang-glossary.json")
# Installed Foundry pf2e system; only read to refresh lang-glossary.json when it is reachable.
FOUNDRY_LANG = "/home/nemo/.local/share/FoundryVTT/Data/systems/pf2e/lang/en.json"

ALLOWED_TAGS = {"p", "strong", "b", "em", "i", "hr", "ul", "ol", "li", "br", "table", "tr", "td", "th", "tbody", "thead", "h2", "h3", "h4"}
ACTION_GLYPH = {1: "1", 2: "2", 3: "3", "reaction": "r", "free": "f"}
EQUIPMENT = {"weapon", "armor", "equipment", "consumable", "shield", "treasure", "ammo", "backpack"}


def title(s):
    s = re.sub(r"([a-z])([A-Z])", r"\1 \2", str(s)).replace("-", " ").replace("_", " ")
    return s[:1].upper() + s[1:]


class Enricher:
    """Turns @Damage/@Check/@Template/@UUID/@Localize and [[/r ...]] into plain readable text."""

    def __init__(self, packs_root):
        self.names = {}
        for f in glob.glob(os.path.join(packs_root, "**", "*.json"), recursive=True):
            try:
                with open(f) as fh:
                    d = json.load(fh)
            except (OSError, ValueError):
                continue
            if isinstance(d, dict) and d.get("_id") and d.get("name"):
                self.names[d["_id"]] = d["name"]
        self.lang = self._load_lang()
        self.used_keys = set()

    @staticmethod
    def _load_lang():
        if os.path.exists(GLOSSARY):
            with open(GLOSSARY) as fh:
                return json.load(fh)
        return {}

    def refresh_glossary(self, keys):
        """Copy the needed localisation strings from the Foundry install into lang-glossary.json."""
        if not os.path.exists(FOUNDRY_LANG):
            return False
        with open(FOUNDRY_LANG) as fh:
            full = json.load(fh)
        out = dict(self.lang)
        for k in keys:
            o = full
            for p in k.split("."):
                o = o.get(p) if isinstance(o, dict) else None
            if isinstance(o, str):
                out[k] = o
        with open(GLOSSARY, "w") as fh:
            json.dump(out, fh, indent=1, sort_keys=True, ensure_ascii=False)
        self.lang = out
        return True

    # -- scanning helpers --
    @staticmethod
    def _balanced(text, i, open_ch, close_ch):
        depth = 0
        for j in range(i, len(text)):
            if text[j] == open_ch:
                depth += 1
            elif text[j] == close_ch:
                depth -= 1
                if depth == 0:
                    return j
        return -1

    def _label(self, text, j):
        """Optional {label} right after position j; returns (label, end index)."""
        if j < len(text) and text[j] == "{":
            k = self._balanced(text, j, "{", "}")
            if k != -1:
                return text[j + 1:k], k + 1
        return None, j

    def convert(self, text, depth=0):
        if not text or depth > 3:
            return text or ""
        out, i = [], 0
        pat = re.compile(r"@(\w+)\[|\[\[/(\w+)\s?")
        while True:
            m = pat.search(text, i)
            if not m:
                out.append(text[i:])
                break
            out.append(text[i:m.start()])
            if m.group(1):
                start = m.end() - 1
                end = self._balanced(text, start, "[", "]")
                if end == -1:
                    out.append(text[m.start():])
                    break
                inner = text[start + 1:end]
                label, nxt = self._label(text, end + 1)
                out.append(self._enricher(m.group(1), inner, label, depth))
            else:
                end = text.find("]]", m.end())
                if end == -1:
                    out.append(text[m.start():])
                    break
                inner = text[m.end():end]
                label, nxt = self._label(text, end + 2)
                out.append(self._inline(m.group(2), inner, label))
            i = nxt
        return "".join(out)

    def _enricher(self, kind, inner, label, depth):
        if kind == "Localize":
            self.used_keys.add(inner)
            s = self.lang.get(inner)
            return self.convert(s, depth + 1) if s else title(inner.rsplit(".", 1)[-1])
        if label:
            return f'<span class="ref">{label}</span>' if kind == "UUID" else label
        if kind == "UUID":
            seg = re.split(r"\.(?:Item|Actor|JournalEntryPage|JournalEntry|Macro|RollTable)\.", inner)[-1]
            name = self.names.get(seg, seg if not re.fullmatch(r"[A-Za-z0-9]{16}", seg) else "")
            return f'<span class="ref">{name}</span>' if name else ""
        if kind == "Damage":
            return self._damage(inner.split("|")[0])
        params = inner.split("|")
        opts = dict(p.split(":", 1) if ":" in p else (p, True) for p in params[1:])
        if kind == "Check":
            typ = params[0]
            parts = []
            if opts.get("dc"):
                parts.append(f"DC {opts['dc']}")
            if "basic" in opts:
                parts.append("basic")
            parts.append(title(opts.get("name") if typ == "flat" and opts.get("name") else typ))
            s = " ".join(parts)
            vs = opts.get("against") or opts.get("defense")
            return s + (f" vs. {title(vs)} DC" if vs else "")
        if kind == "Template":
            p = dict(x.split(":", 1) for x in params if ":" in x)
            typ = p.get("type", params[0])
            dist = p.get("distance")
            return f"{dist}-foot {typ}" if dist else typ
        return label or ""

    @staticmethod
    def _damage(expr):
        parts, depth, cur = [], 0, ""
        for ch in expr:
            if ch == "," and depth == 0:
                parts.append(cur)
                cur = ""
                continue
            depth += ch in "([{"
            depth -= ch in ")]}"
            cur += ch
        parts.append(cur)
        out = []
        for p in parts:
            m = re.match(r"^(.*)\[([^\[\]]*)\]$", p.strip())
            if not m:
                out.append(p.strip())
                continue
            formula, types = m.group(1).strip(), m.group(2)
            if formula.startswith("(") and formula.endswith(")"):
                formula = formula[1:-1]
            # nested category form: (1d6[persistent,fire])
            formula = re.sub(r"\[([^\]]*)\]", lambda x: " " + x.group(1).replace(",", " "), formula)
            out.append(f"{formula} {types.replace(',', ' ')}".strip())
        return " plus ".join(out)

    @staticmethod
    def _inline(kind, inner, label):
        if label:
            return label
        if kind == "act":
            return title(inner.split()[0]) if inner.split() else ""
        formula = inner.split("#")[0].strip()
        formula = re.sub(r"\[([^\]]*)\]", lambda x: " " + x.group(1).replace(",", " "), formula)
        return formula.strip("() ")


def clean_html(s):
    """Keep simple formatting tags only; drop attributes and anything else."""
    def tag(m):
        closing, name = m.group(1), m.group(2).lower()
        if name not in ALLOWED_TAGS:
            return ""
        return f"<{closing}{name}>" if name not in ("hr", "br") else f"<{name}>"
    s = re.sub(r"<(/?)([a-zA-Z0-9]+)[^>]*>", tag, s)
    return re.sub(r"(<p>\s*</p>)+", "", s).strip()


def frequency(f):
    if not f or not f.get("max"):
        return ""
    per = {"day": "day", "PT1M": "minute", "PT10M": "10 minutes", "PT1H": "hour", "turn": "turn", "round": "round",
           "PT24H": "day", "P1W": "week", "P1M": "month", "P1Y": "year", "encounter": "encounter"}.get(f.get("per"), f.get("per"))
    n = {1: "once", 2: "twice"}.get(f["max"], f"{f['max']} times")
    return f"{n} per {per}"


def statblock(d, en):
    s = d["system"]
    det = s.get("details") or {}
    at = s.get("attributes") or {}
    items = d.get("items", [])
    conv = lambda x: clean_html(en.convert(x or ""))  # noqa: E731
    sb = {}

    if d["type"] == "npc":
        lang = det.get("languages") or {}
        langs = [title(x) for x in lang.get("value") or []]
        if lang.get("details"):
            langs.append(lang["details"])
        if langs:
            sb["lang"] = langs
        lores = [[i["name"], (i["system"].get("mod") or {}).get("value")] for i in items if i["type"] == "lore"]
        if lores:
            sb["lore"] = lores
        gear = [i["name"] + (f" ({i['system']['quantity']})" if (i["system"].get("quantity") or 1) > 1 else "")
                for i in items if i["type"] in EQUIPMENT]
        if gear:
            sb["gear"] = gear
        notes = {"hp": (at.get("hp") or {}).get("details"), "ac": (at.get("ac") or {}).get("details"),
                 "saves": (at.get("allSaves") or {}).get("value"), "per": (s.get("perception") or {}).get("details"),
                 "speed": (at.get("speed") or {}).get("details")}
        notes = {k: v for k, v in notes.items() if v}
        if notes:
            sb["notes"] = notes
        focus = ((s.get("resources") or {}).get("focus") or {}).get("max")
        if focus:
            sb["focus"] = focus
        flavor = conv(det.get("publicNotes"))
        if flavor:
            sb["flavor"] = flavor
    else:
        for k in ("description", "disable", "reset", "routine"):
            v = conv(det.get(k))
            if v:
                sb[k] = v
        st = (at.get("stealth") or {}).get("details")
        if st:
            sb["stealthNote"] = conv(st)

    abilities = []
    for i in items:
        if i["type"] != "action":
            continue
        m = i["system"]
        at_type = (m.get("actionType") or {}).get("value")
        glyph = ACTION_GLYPH.get((m.get("actions") or {}).get("value")) if at_type == "action" else ACTION_GLYPH.get(at_type)
        cat = m.get("category") or ("offensive" if glyph else "defensive")
        abilities.append({
            "n": i["name"],
            "a": glyph,
            "c": cat,
            "t": (m.get("traits") or {}).get("value") or [],
            "f": frequency(m.get("frequency")),
            "d": conv((m.get("description") or {}).get("value")),
        })
    if abilities:
        sb["abilities"] = abilities

    strike_notes = {}
    for i in items:
        if i["type"] == "melee":
            desc = conv((i["system"].get("description") or {}).get("value"))
            if desc:
                strike_notes[i["name"]] = desc
    if strike_notes:
        sb["strikeNotes"] = strike_notes
    return sb
