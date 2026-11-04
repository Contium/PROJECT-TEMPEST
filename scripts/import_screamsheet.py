"""Builds a TEMPEST screamsheet table pack from your own copy of R. Talsorian's
free "Screamsheet Generator" DLC (Cyberpunk RED).

The table text is RTG's copyrighted writing, so TEMPEST doesn't ship it: this
script reads it from the PDF on your machine and writes a pack into your local
TEMPEST data folder.

    python scripts/import_screamsheet.py <path-to-pdf> [<output-dir>]

Requires pypdf (pip install pypdf). Prints the written pack path and a summary
as JSON on success; exits non-zero with a message on failure.
"""

import json
import os
import re
import sys
from datetime import datetime, timezone

PACK_ID = "rtg-cpr-screamsheet-generator"
TABLE_HEADER = re.compile(r"^\s*X\s+table\s+([a-d])(\d)\s*:", re.IGNORECASE)
TABLE_A_HEADER = re.compile(r"^\s*X\s+table\s+a\s*:", re.IGNORECASE)
CODES = r"(?:(?:NF|NL|HW)\d[\s,]*(?:or\s+)?)+"
CODE_LINE = re.compile(rf"^\s*(?:{CODES}|Any)\s*$")
TRAILING_CODES = re.compile(rf"\s+({CODES}|Any)\s*$")
# Lines that are page furniture or pull quotes rather than table content.
NOISE = [
    re.compile(r"^\s*SCREAMSHEET GENERATOR\s*$"),
    re.compile(r"^\s*=+ PAGE \d+ =+\s*$"),
    re.compile(r"^\s*The\s*$"),
    re.compile(r"^\s*Augmented\s*$"),
    re.compile(r"^\s*Optic\s*$"),
    re.compile(r"Most Accessed Screamsheets"),
    re.compile(r"Live and Direct"),
]
# A table ends at its footnote, at the next section ("c: in neon lights content"),
# or at a decorative pull quote, whose extracted text opens with two quote marks
# before any closing one. (Rows themselves may start with in-world dialogue.)
END_MARKERS = re.compile(r"^(Once you|[a-d]: |“[^”]{0,40}“)", re.IGNORECASE)


def fail(message):
    print(json.dumps({"error": message}))
    sys.exit(1)


def read_pages(path):
    try:
        from pypdf import PdfReader
    except ImportError:
        fail("pypdf is not installed. Run: pip install pypdf")
    try:
        reader = PdfReader(path)
    except Exception as exc:  # noqa: BLE001 - report any PDF problem to the user
        fail(f"Could not read the PDF: {exc}")
    return [page.extract_text() or "" for page in reader.pages]


def dehyphenate(text):
    # "enter -\ntainment" -> "entertainment"; "neighbor -\nhood" -> "neighborhood"
    return re.sub(r"(\w) -\s*\n\s*(\w)", r"\1\2", text)


def clean_lines(text):
    out = []
    for line in text.split("\n"):
        if any(p.search(line) for p in NOISE):
            continue
        out.append(line.rstrip())
    return out


def to_paragraphs(lines):
    """Join wrapped lines; a short line ending a sentence ends a paragraph."""
    if not lines:
        return ""
    width = max(len(l) for l in lines)
    paragraphs, current = [], []
    for line in lines:
        current.append(line.strip())
        ends_sentence = re.search(r"[.!?”\"]\s*$", line)
        if ends_sentence and len(line.strip()) < width * 0.8:
            paragraphs.append(" ".join(current))
            current = []
    if current:
        paragraphs.append(" ".join(current))
    return "\n\n".join(re.sub(r"\s{2,}", " ", p).strip() for p in paragraphs if p.strip())


def split_tables(lines):
    """{ 'b1': [lines...], ... } for every 'X tAble <letter><n>:' block."""
    tables, key = {}, None
    for line in lines:
        m = TABLE_HEADER.match(line)
        if m:
            key = (m.group(1) + m.group(2)).lower()
            tables[key] = []
            continue
        if key is None:
            continue
        if END_MARKERS.match(line.strip()):
            key = None
            continue
        tables[key].append(line)
    return tables


def numbered_rows(lines, count=6, first_header=True):
    """Rows numbered 1..count, either '3 text' or a bare '3' line followed by text."""
    body = lines[1:] if first_header else lines  # drop the "1d6 Content" header row
    rows, expected = [], 1
    for line in body:
        m = re.match(r"^\s*(\d)(?:\s+(.*))?$", line)
        if m and int(m.group(1)) == expected and expected <= count:
            rows.append([m.group(2)] if m.group(2) else [])
            expected += 1
        elif rows:
            rows[-1].append(line)
    return rows


def parse_codes(raw):
    raw = raw.strip()
    if raw.lower() == "any":
        return "any"
    return re.findall(r"(?:NF|NL|HW)\d", raw)


def parse_content_table(lines, conclusions=False):
    out = []
    for row in numbered_rows(lines):
        if not conclusions:
            out.append(to_paragraphs(row))
            continue
        # Suggested-headline codes close each conclusion: on their own line(s)
        # ("HW1, HW2, HW4," / "HW5, or HW6"), or at the end of the last text line.
        lines_left, code_parts = list(row), []
        while lines_left and CODE_LINE.match(lines_left[-1]):
            code_parts.insert(0, lines_left.pop())
        if lines_left:
            m = TRAILING_CODES.search(lines_left[-1])
            if m:
                code_parts.insert(0, m.group(1))
                lines_left[-1] = lines_left[-1][: m.start()]
        codes = parse_codes(" ".join(code_parts)) if code_parts else "any"
        out.append({"text": to_paragraphs(lines_left), "headlines": codes})
    return out


def parse_headlines(lines, prefix):
    out = {}
    for line in lines[1:]:
        m = re.match(r"^\s*((?:NF|NL|HW)?\d)\s+(.+)$", line)
        if m:
            code = m.group(1) if m.group(1)[0].isalpha() else f"{prefix}{m.group(1)}"
            out[code] = re.sub(r"\s{2,}", " ", m.group(2)).strip()
        elif out:
            last = list(out)[-1]
            out[last] = f"{out[last]} {line.strip()}".strip()
    return out


def parse_article_types(lines):
    """Table A: '1-2 News Flash! (Violence and' / 'Mishaps) Table B1' ..."""
    text = " ".join(l.strip() for l in lines[1:])
    types = []
    for m in re.finditer(r"(\d)-(\d)\s+(.+?)\s+Table\s+([B-D])1", text):
        lo, hi, name, letter = int(m.group(1)), int(m.group(2)), m.group(3).strip(), m.group(4).lower()
        types.append({"letter": letter, "name": name, "rolls": list(range(lo, hi + 1))})
    return types


def parse_bylines(raw_page):
    m = re.search(r"Adding A Byline(.*)$", raw_page, re.S)
    if not m:
        return []
    text = re.sub(r"\s+", " ", dehyphenate(m.group(1)))
    text = re.sub(r"^.*?expertise\.\s*", "", text)
    # A new entry starts after a sentence ending in a lowercase word ("history.", not
    # the initials in "G.F. Bits") and opens with 1-4 capitalised name tokens and a colon.
    name = r"(?:[A-Z0-9“\"][\w.“”\"’'-]*\s?){1,4}:"
    entries = re.split(rf"(?<=[a-z]\.)\s+(?={name})", text)
    out = []
    for entry in entries:
        name, _, beat = entry.partition(":")
        if beat.strip():
            out.append({"name": name.strip(), "beat": beat.strip()})
    return out


def main():
    if len(sys.argv) < 2:
        fail("Usage: import_screamsheet.py <pdf> [<output-dir>]")
    pdf = sys.argv[1]
    out_dir = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.environ.get("LOCALAPPDATA", "."), "TEMPEST", "packs", "screamsheet")
    if not os.path.isfile(pdf):
        fail(f"No file at {pdf}")

    pages = read_pages(pdf)
    # Each page opens with its page number; strip it there only (bare "1"-"6" lines are row numbers).
    bodies = [re.sub(r"^\s*\d+\s*\n", "", page, count=1) for page in pages]
    lines = clean_lines(dehyphenate("\n".join(bodies)))
    tables = split_tables(lines)

    # Table A's header has no number ("X tAble A: type of Article"), so find it directly.
    table_a = None
    for i, line in enumerate(lines):
        if TABLE_A_HEADER.match(line):
            table_a = lines[i + 1 : i + 8]
            break
    if not table_a:
        fail("Could not find Table A (type of article). Is this the Screamsheet Generator PDF?")

    prefixes = {"b": "NF", "c": "NL", "d": "HW"}
    article_types, problems = [], []
    for t in parse_article_types(table_a):
        k = t["letter"]
        intros = parse_content_table(tables.get(f"{k}1", []))
        bodies = parse_content_table(tables.get(f"{k}2", []))
        conclusions = parse_content_table(tables.get(f"{k}3", []), conclusions=True)
        headlines = parse_headlines(tables.get(f"{k}4", []), prefixes[k])
        for label, rows in (("intros", intros), ("bodies", bodies), ("conclusions", conclusions)):
            if len(rows) != 6:
                problems.append(f"Table {k.upper()} {label}: found {len(rows)} of 6 rows")
        if len(headlines) != 6:
            problems.append(f"Table {k.upper()}4 headlines: found {len(headlines)} of 6")
        article_types.append({
            "id": {"b": "news-flash", "c": "in-neon-lights", "d": "help-wanted"}[k],
            "name": t["name"],
            "rolls": t["rolls"],
            "intros": intros,
            "bodies": bodies,
            "conclusions": conclusions,
            "headlines": headlines,
        })

    if len(article_types) != 3:
        problems.append(f"Table A: found {len(article_types)} of 3 article types")
    if problems:
        fail("The PDF didn't match the expected layout: " + "; ".join(problems))

    byline_page = next((p for p in pages if "Adding A Byline" in p), "")
    pack = {
        "id": PACK_ID,
        "name": "Screamsheet Generator (R. Talsorian Games)",
        "source": os.path.basename(pdf),
        "importedAt": datetime.now(timezone.utc).isoformat(),
        "die": 6,
        "articleTypes": article_types,
        "bylines": parse_bylines(byline_page),
        "outlets": [
            {"name": "Night City Today", "style": "broadsheet"},
            {"name": "The Augmented Optic", "style": "crt"},
        ],
    }
    os.makedirs(out_dir, exist_ok=True)
    target = os.path.join(out_dir, f"{PACK_ID}.json")
    with open(target, "w", encoding="utf-8") as f:
        json.dump(pack, f, ensure_ascii=False, indent=2)
    print(json.dumps({
        "path": target,
        "id": PACK_ID,
        "articleTypes": [{"id": t["id"], "rows": [len(t["intros"]), len(t["bodies"]), len(t["conclusions"])], "headlines": len(t["headlines"])} for t in article_types],
        "bylines": len(pack["bylines"]),
    }))


if __name__ == "__main__":
    main()
