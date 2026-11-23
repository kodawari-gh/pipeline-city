"""Package consistency check (ACCEPTANCE §1.4). Fails (exit 1) unless:
 1. every audio file named in SPEC.md, IMPLEMENTATION.md, mix-tokens.json or public/audio/music/music-spec.json exists under public/audio/,
 2. every shipped asset is covered by the SPEC.md map (named directly or by a pattern),
 3. mix-tokens cue files == the sfx/ui files on disk, and assets/manifest.json == every asset on disk,
 4. every logRules cue id is a token cue.
Patterns understood in the docs: {a,b,c} and {a|b|c} alternatives, {1..3} numbers, {KEY} / {C..B} (12 key tokens),
{C3..C6} chromatic notes (sharp tokens: Cs4). References containing `$` or `<` are code templates and are skipped.
Run: python3 check_refs.py   (stdlib only)"""
import os, re, sys, json, glob, itertools
HERE = os.path.dirname(os.path.abspath(__file__)); PKG = os.path.dirname(HERE); A = os.path.join(PKG, "..", "..", "..", "public", "audio")  # shipped audio (ticket #50)
KEYS = ["C", "Cs", "D", "Ds", "E", "F", "Fs", "G", "Gs", "A", "As", "B"]
def notes(a, b):
    m = lambda s: KEYS.index(s[:-1].replace("#", "s")) + 12 * (int(s[-1]) + 1)
    return [KEYS[n % 12] + str(n // 12 - 1) for n in range(m(a), m(b) + 1)]
def alts(body):
    if body in ("KEY", "NEW_KEY", "C..B"): return KEYS
    m = re.fullmatch(r"(\d+)\.\.(\d+)", body)
    if m: return [str(i) for i in range(int(m[1]), int(m[2]) + 1)]
    m = re.fullmatch(r"([A-G]s?\d)\.\.([A-G]s?\d)", body)
    if m: return notes(m[1], m[2])
    return [x.strip() for x in re.split(r"[,|]", body)]
def expand(ref):
    parts = re.split(r"(\{[^}]*\})", ref)
    opts = [alts(p[1:-1]) if p.startswith("{") else [p] for p in parts]
    return ["".join(c) for c in itertools.product(*opts)]
REF = re.compile(r"(?:public/)?(?:audio/|assets/)?((?:sfx|ui|ambience|music/stems|music/notes|stems|notes)/[A-Za-z0-9_{},.|#\-]+?\.ogg)")
def refs_in(text):
    out = set()
    for m in REF.finditer(text):
        r = m[1]
        if r.startswith(("stems/", "notes/")): r = "music/" + r
        out.update(expand(r))
    return out
fail = []
disk = {os.path.relpath(p, A) for p in glob.glob(os.path.join(A, "**", "*.ogg"), recursive=True)}
docs = {n: open(os.path.join(PKG, n)).read() for n in ("SPEC.md", "IMPLEMENTATION.md")}
tok = json.load(open(os.path.join(PKG, "mix-tokens.json")))
ms = json.load(open(os.path.join(A, "music", "music-spec.json")))
sources = {n: refs_in(t) for n, t in docs.items()}
sources["mix-tokens.json"] = refs_in(json.dumps(tok))
sources["music-spec.json manifest"] = {"music/" + m["path"] for m in ms["manifest"] if not m["path"].startswith("previews/")}
for m in ms["manifest"]:
    if m["path"].startswith("previews/") and not os.path.exists(os.path.join(PKG, m["path"])): fail.append(f"preview missing: {m['path']}")
for n, rs in sources.items():
    missing = sorted(rs - disk)
    if missing: fail.append(f"{n}: {len(missing)} referenced files missing, e.g. {missing[:5]}")
    print(f"{n}: {len(rs)} references, {len(rs & disk)} exist")
uncovered = sorted(disk - sources["SPEC.md"])
if uncovered: fail.append(f"SPEC.md map does not cover {len(uncovered)} assets, e.g. {uncovered[:8]}")
tokfiles = {f.replace("audio/", "", 1) for c in tok["cues"] for f in c["files"]} | {f"ambience/{k}.ogg" for k in tok["ambience"]}
nonmusic = {d for d in disk if not d.startswith("music/")}
if tokfiles != nonmusic: fail.append(f"tokens vs disk (sfx/ui/ambience): only tokens {sorted(tokfiles - nonmusic)[:5]}, only disk {sorted(nonmusic - tokfiles)[:5]}")
man = {f["file"].replace("assets/", "", 1) for f in json.load(open(os.path.join(PKG, "assets", "manifest.json")))["files"]}
if man != disk: fail.append(f"manifest vs disk: only manifest {sorted(man - disk)[:5]}, only disk {sorted(disk - man)[:5]}")
cues = {c["id"] for c in tok["cues"]}
bad = [r["cue"] for r in tok["logRules"] if r["cue"] and r["cue"] not in cues]
if bad: fail.append(f"logRules name unknown cues {bad}")
print(f"{len(disk)} assets on disk ({len(nonmusic)} sfx/ui/ambience, {len(disk) - len(nonmusic)} music); SPEC covers {len(disk) - len(uncovered)}")
for f in fail: print("FAIL:", f)
print("OK" if not fail else f"{len(fail)} problem(s)"); sys.exit(1 if fail else 0)
