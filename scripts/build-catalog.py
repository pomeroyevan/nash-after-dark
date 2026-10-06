"""Build the public guide separately from private visit history. Standard library only."""
from pathlib import Path
import json
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
GENERATED_AT = datetime.now(timezone.utc).isoformat()
RESEARCH_FILES = sorted((ROOT / "research").glob("*.json"))
if not RESEARCH_FILES:
    raise SystemExit("Private research inputs are absent. Keep the included public catalog; regenerate only in the original private workspace.")

def read(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))

# Existing public copy has been reviewed. New research prose must never become
# public automatically; add a reviewed public_copy override for a new record.
catalog_path = ROOT / "public/data/catalog.json"
reviewed_entries = {
    row["id"]: row for row in read(catalog_path).get("entries", [])
} if catalog_path.exists() else {}

def text(value):
    if value is None:
        return "Unknown"
    if isinstance(value, list):
        return "; ".join(text(item) for item in value)
    if isinstance(value, dict):
        return "; ".join(f"{key}: {text(item)}" for key, item in value.items())
    return str(value)

def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

personal_path = ROOT / "data/personal-history.json"
personal = read(personal_path) if personal_path.exists() else {"updated_at": "2026-10-05", "entries": []}
records = {row["id"]: row for row in personal["entries"]}
research = {}
for path in RESEARCH_FILES:
    batch = read(path)
    for row in batch.get("entries", []):
        ident = row["id"]
        research.setdefault(ident, []).append({**row, "checked_at": batch.get("checked_at"), "source_file": path.relative_to(ROOT).as_posix()})

tags = {
    "cobra": ["dancing", "live music", "alternative"],
    "cobra-slc": ["dancing", "goth", "darkwave"],
    "another-night-another-dream": ["dancing", "electronic"],
    "blood-rave": ["dancing", "goth"],
    "rosemary-beauty-queen": ["bars", "dancing"],
    "rudys-jazz-room": ["live music", "jazz"],
    "rudys-sunday-jazz-jam": ["live music", "jazz"],
    "americano-lounge": ["live music", "hangout"],
    "flamingo": ["dancing", "live music"],
    "inglewood-lounge": ["live music", "bars"],
    "five-spot": ["live music", "dancing"],
    "five-spot-funk-night": ["live music", "dancing", "funk"],
    "east-room": ["live music", "alternative"],
    "drkmttr": ["live music", "alternative", "punk"],
    "eastside-bowl": ["live music", "bowling"],
    "phat-bites": ["live music", "food"],
    "skulls-rainbow-room": ["live music", "food"],
    "scary-posh": ["electronic", "dancing"],
    "gerard-alain": ["live music", "funk"],
    "the-office": ["electronic", "dancing"],
    "night-we-met": ["electronic", "dancing"],
    "bourbon-street": ["live music", "blues"],
    "wave-country": ["outdoors", "seasonal"],
}

# Explicit public copy for records whose research contains private matching history.
# Personal recollection and organizer-identification reasoning remain in private research.
public_copy = {
    "golden-unresolved": ("Golden piano bar — unresolved", "A piano-bar entry whose exact business identity is still being researched. Sid Gold's Request Room is a candidate, not a confirmed match."),
    "pletos-unresolved": ("Pletos / Plato's — unresolved", "Exact identity unresolved. Pelato, an Italian restaurant in Germantown, is a candidate requiring confirmation."),
    "camp-night": ("Camp Night / Camp Nightmare", "Night Mass promoted Camp Nightmare at Rosemary & Beauty Queen on August 21, 2026. The past event is a candidate for this entry; the next edition is not confirmed."),
    "five-spot": ("The 5 Spot", "East Nashville live-music bar hosting bands, DJs and dance nights. Check each event's lineup and admission details."),
    "dark-wave": ("Dark Wave — unresolved", "Could refer to a music genre, a named party or another business. CRIMEWAVE is a separately verified darkwave-party listing and is not automatically the same entry."),
    "gerard-alain": ("Gerard Alain", "Nashville funk artist with a documented Musicians Corner appearance. Performance locations vary; follow dated artist and promoter announcements."),
    "bourbon-street": ("Bourbon Street Blues and Boogie Bar", "Downtown blues venue in Printers Alley with dated band listings. Verify the specific Friday lineup and start time before attending."),
    "distrix": ("Distrix / Disctrix — unresolved", "Disctrix appears in a performer's documentation of a Nashville jungle night. Official venue identity and future schedule still need verification."),
    "wildhorse-saloon": ("Wildhorse Saloon — historical venue", "The former Wildhorse Saloon site now points to Category 10. Keep historical venue identity separate from the replacement business and check Category 10 for current programming."),
    "potluck-teahouse": ("Potluck Teahouse", "Inglewood teahouse and pottery studio offering wheel-throwing and handbuilding classes. Check the class calendar for current dates and availability."),
    "blood-rave": ("BLOODRAVE at Cobra", "A She's Lost Control event at Cobra. The official October 3, 2026 edition is historical; no future edition is implied."),
    "basement-east-emo-acid": ("Basement East Emo Night / Acid — unresolved", "The Emo Night Tour has an official Basement East listing. The separate Acid wording and intended exact event remain unresolved."),
}
areas = {
    "inglewood-lounge":"Inglewood", "flamingo":"Wedgewood-Houston", "adeles":"The Gulch",
    "rosemary-beauty-queen":"East Nashville", "camp-night":"East Nashville", "trap-house-wings":"Buchanan Arts District",
    "five-spot":"East Nashville", "five-spot-funk-night":"East Nashville", "rudys-jazz-room":"The Gulch", "rudys-sunday-jazz-jam":"The Gulch",
    "east-room":"East Nashville", "drkmttr":"East Nashville / Dickerson Pike", "cobra":"East Nashville", "cobra-slc":"East Nashville",
    "another-night-another-dream":"East Nashville", "blood-rave":"East Nashville", "basement-east-emo-acid":"East Nashville",
    "eastside-bowl":"Madison — travel check", "phat-bites":"Donelson — travel check", "skulls-rainbow-room":"Downtown / Printers Alley",
    "middleman":"Wedgewood-Houston", "americano-lounge":"Wedgewood-Houston", "mas-tacos":"East Nashville", "taco-mama":"Hillsboro Village",
    "bourbon-street":"Downtown / Printers Alley", "shaokao":"Midtown", "bastion":"Wedgewood-Houston", "the-office":"East Nashville",
    "night-we-met":"Downtown / The Gulch", "martins-bbq":"Downtown; other Nashville branches available", "san-antonio-taco":"Midtown / Vanderbilt",
    "wave-country":"Two Rivers / Donelson — seasonal", "loveless-cafe":"Far west Nashville — outside default outing range",
    "biscuit-love":"The Gulch / Hillsboro Village", "wildhorse-saloon":"Downtown", "folk":"East Nashville", "lockeland-table":"East Nashville",
    "bartaco":"East Nashville / 12 South", "potluck-teahouse":"Inglewood", "crimewave":"Cannery Hall / SoBro",
}
address_overrides = {
    "golden-unresolved": None, "pletos-unresolved": None, "dark-wave": None,
    "night-mass": None, "another-night-another-dream": "Cobra Nashville; verify each edition's venue",
    "taco-mama":"1612 21st Avenue South, Nashville, TN 37212",
    "martins-bbq":"410 4th Avenue South, Nashville, TN 37201 (downtown music venue)",
    "biscuit-love":None, "bartaco":None,
    "camp-night":"1102 Forest Ave, Nashville, TN 37206",
    "potluck-teahouse":"3210 Gallatin Pike Unit B, Nashville, TN 37216",
}
unresolved_ids = {"golden-unresolved", "pletos-unresolved", "five-spot-funk-night", "dark-wave", "distrix", "basement-east-emo-acid"}
candidate_ids = {"camp-night", "trap-house-wings"}
relationships = {
    "cobra":["cobra-slc", "another-night-another-dream", "blood-rave"],
    "camp-night":["rosemary-beauty-queen", "night-mass"],
    "night-mass":["camp-night", "rosemary-beauty-queen"],
    "basement-east":["basement-east-emo-acid"],
    "basement-east-emo-acid":["basement-east"],
    "cannery-hall":["crimewave"],
    "crimewave":["cannery-hall"],
}

all_ids = list(records) + [ident for ident in research if ident not in records]
catalog = []
guide = ["# Nashville guide", "", "Research snapshots are dated; refresh before making plans. Personal history is kept separately and is not included in the public website data.", "", "## Directory", "", "| Entry | Type | Identity confidence |", "|---|---|---|"]
source_guide = ["# Schedule source register", "", "Every entry has an attempted method or an explicit identity/access gap. A failed fetch never means that no events exist. See FUTURE-CHECKS.md for shared rules.", ""]

for ident in all_ids:
    reviewed = reviewed_entries.get(ident, {})
    if ident not in public_copy and not all(reviewed.get(field) for field in ("name", "description")):
        raise SystemExit(f"Public copy review required for {ident}; add its name and description to public_copy before generating.")
    history = records.get(ident, {})
    evidence = sorted(research.get(ident, []), key=lambda item: item.get("checked_at") or "")
    latest = evidence[-1] if evidence else {}
    name = reviewed.get("name", ident)
    if ident in public_copy:
        name = public_copy[ident][0]
    kind = latest.get("kind", "unresolved")
    confidence = latest.get("identity_confidence", "unresolved")
    loc = latest.get("location") or {}
    if not isinstance(loc, dict):
        loc = {"address": str(loc)}
    official = latest.get("official_urls", [])
    row_tags = tags.get(ident, [])
    if any(word in kind.lower() for word in ["restaurant", "food", "cafe", "café", "taco", "barbecue"]):
        row_tags = list(dict.fromkeys([*row_tags, "food"]))
    schedules = [item.get("schedule", {}) for item in evidence]
    sources = [source for schedule in schedules for source in schedule.get("sources", [])]
    seen = set()
    cleaned_sources = []
    for source in sources:
        if isinstance(source, str):
            source = {"url": source}
        if source.get("url") and source["url"] not in seen:
            seen.add(source["url"])
            cleaned_sources.append({"url":source["url"], "role":"Public schedule or official venue reference"})
    entry = {
        "id": ident, "name": name, "kind": kind,
        "description": public_copy[ident][1] if ident in public_copy else reviewed["description"],
        "area": areas.get(ident) or loc.get("area") or loc.get("neighborhood") or "Nashville; location varies",
        "address": address_overrides.get(ident, loc.get("address")), "officialUrl": official[0] if official else None,
        "tags": row_tags, "identityStatus": "unresolved" if ident in unresolved_ids else "candidate" if ident in candidate_ids else reviewed.get("identityStatus", "unresolved"),
        "sourceCheckedAt": latest.get("checked_at"),
        "relatedIds": relationships.get(ident, history.get("related_ids", [])),
        "scheduleSources": cleaned_sources,
        "inScope": ident != "loveless-cafe",
        "scopeNote": "Kept for reference; farther west than the default Nashville evening range." if ident == "loveless-cafe" else "",
    }
    catalog.append(entry)
    guide.append(f"| [{name}](#{ident}) | {kind} | {confidence} |")

guide += [""]
for row in catalog:
    ident = row["id"]
    guide += [f'<a id="{ident}"></a>', f"## {row['name']}", "", row["description"], "", f"- Type: {row['kind']}", f"- Location: {row['address'] or row['area']}", f"- Identity: {row['identityStatus']}", f"- Checked: {row['sourceCheckedAt'] or 'not verified'}"]
    for evidence in research.get(ident, []):
        for finding in evidence.get("findings", []):
            guide.append(f"- {finding.get('claim', '')} [Source]({finding.get('url', '')}). {finding.get('temporal_scope', '')}")
        schedule = evidence.get("schedule", {})
        guide += ["", "Schedule check: " + text(schedule.get("attempt_result", "Not attempted."))]
        if evidence.get("unresolved"):
            guide += ["", "Still unresolved: " + text(evidence["unresolved"])]
        source_guide += [f"## {row['name']}", "", f"Checked: {evidence.get('checked_at')}. Source record: {evidence['source_file']}", "", "Method: " + text(schedule.get("method")), "", "Result: " + text(schedule.get("attempt_result")), ""]
        for source in schedule.get("sources", []):
            source_guide.append("- " + text(source))
        source_guide += ["", "Refresh:", ""]
        steps = schedule.get("refresh_instructions", [])
        if isinstance(steps, str):
            steps = [steps]
        source_guide += [f"{index}. {text(step)}" for index, step in enumerate(steps, 1)]
        source_guide += ["", "Limitations: " + text(schedule.get("limitations", [])), ""]
    guide += [""]

assert len(catalog) == len({row['id'] for row in catalog})
assert all(row['id'] in research for row in personal['entries']), "Every personal entry needs an explicit research record/gap."
assert all(row['identityStatus'] in {"identified", "candidate", "unresolved"} for row in catalog)
write_json(ROOT / "public/data/catalog.json", {"updatedAt": GENERATED_AT[:10], "entries": catalog})
(ROOT / "GUIDE.md").write_text("\n".join(guide), encoding="utf-8")
(ROOT / "SOURCES.md").write_text("\n".join(source_guide), encoding="utf-8")
private_history = {}
for ident, row in records.items():
    score = row.get("rating")
    private_history[ident] = {
        "attendance": row.get("attendance", "unknown"),
        "rating": score.get("value") if isinstance(score, dict) else None,
        "notes": "\n".join(row.get("notes", [])),
        "liked": "\n".join(row.get("notes", [])) if row.get("sentiment") in ["loved", "liked"] else "",
        "disliked": row.get("disliked", ""),
        "favorite": row.get("sentiment") == "loved",
        "watch": row.get("watch", False) or row.get("sentiment") in ["loved", "preferred_event"],
        "updatedAt": GENERATED_AT,
    }
if personal_path.exists():
    write_json(ROOT / "private/history-seed.json", {"version": 1, "exportedAt": GENERATED_AT, "history": private_history, "savedEventIds": []})
    private_lines = ["# Your Nashville history", "", "Saved from your chat and explicitly provided email. Unknown is not the same as never visited. Ratings described as probable remain provisional in the notes.", "", "| Entry | Attendance | Your take | Rating |", "|---|---|---|---|"]
    for row in records.values():
        score = row.get("rating")
        rating = str(score["value"]) + "/" + str(score["out_of"]) if isinstance(score, dict) else "Not rated"
        private_lines.append(f"| {row['name']} | {row.get('attendance', 'unknown')} | {row.get('sentiment', 'unknown')} | {rating} |")
    for row in records.values():
        if row.get("notes"):
            private_lines += ["", "## " + row["name"], "", *["- " + note for note in row["notes"]]]
    (ROOT / "private/MY-PLACES.md").write_text("\n".join(private_lines) + "\n", encoding="utf-8")
print(f"Built {len(catalog)} public entries and {len(private_history)} private history records. Personal records were not bundled publicly.")
