#!/usr/bin/env python3
"""Fetch the hub's RSS feeds into news.json. Standard library only.

Run by .github/workflows/news.yml every few hours; safe to run by hand.
A feed that fails is skipped, and the previous items for its window are kept
so one bad publisher never empties a panel.
"""
import json, re, sys, time, urllib.request, html
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from datetime import datetime, timezone
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "news.json"
PER_WINDOW = 12

# Per-window headline filters: Deadline and Variety mix TV in with the films.
SKIP = {"film": re.compile(r"\b(season \d+|series|sitcom|showrunner|renewed|streamer)\b", re.I)}

WINDOWS = {
    "art": [
        ("The Guardian", "https://www.theguardian.com/artanddesign/art/rss"),
        ("Hyperallergic", "https://hyperallergic.com/feed/"),
        ("ARTnews", "https://www.artnews.com/feed/"),
        ("Artnet News", "https://news.artnet.com/feed"),
    ],
    "film": [
        ("The Guardian", "https://www.theguardian.com/film/rss"),
        ("Deadline", "https://deadline.com/feed/"),
        ("Variety", "https://variety.com/v/film/feed/"),
    ],
    "theatre": [
        ("The Guardian", "https://www.theguardian.com/stage/rss"),
        ("Evening Standard", "https://www.standard.co.uk/culture/theatre/rss"),
    ],
    "doom": [
        ("The Guardian", "https://www.theguardian.com/technology/artificialintelligenceai/rss"),
        ("LessWrong", "https://www.lesswrong.com/feed.xml"),
        ("Alignment Forum", "https://www.alignmentforum.org/feed.xml"),
        ("Don't Worry About the Vase", "https://thezvi.substack.com/feed"),
    ],
}

UA = "Mozilla/5.0 (compatible; bridge-hub-news/1.0)"


def local(tag):
    return tag.rsplit("}", 1)[-1]


def text_of(el):
    return html.unescape(re.sub(r"<[^>]+>", "", el.text or "")).strip() if el is not None else ""


def first(fields, *names):
    # Not `a or b`: an Element with no children is falsy even when it has text.
    for n in names:
        if fields.get(n) is not None:
            return fields[n]
    return None


def parse_date(s):
    if not s:
        return None
    try:
        d = parsedate_to_datetime(s)
    except (TypeError, ValueError):
        try:
            d = datetime.fromisoformat(s.replace("Z", "+00:00"))
        except ValueError:
            return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def fetch(source, url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as r:
        root = ET.fromstring(r.read())
    items = []
    for node in root.iter():
        if local(node.tag) not in ("item", "entry"):
            continue
        f = {}
        for c in node:
            f.setdefault(local(c.tag), c)
        link = f.get("link")
        href = (link.get("href") or text_of(link)) if link is not None else ""
        title = text_of(f.get("title"))
        when = parse_date(text_of(first(f, "pubDate", "published", "updated", "date")))
        summary = text_of(first(f, "description", "summary"))
        if not (title and href.startswith("http")):
            continue
        items.append({
            "title": title,
            "url": href,
            "source": source,
            "date": when.isoformat() if when else None,
            "summary": summary[:220].rsplit(" ", 1)[0] + "…" if len(summary) > 220 else summary,
        })
    return items


def main():
    old = {}
    if OUT.exists():
        try:
            old = json.loads(OUT.read_text()).get("windows", {})
        except ValueError:
            pass
    result, failures = {}, 0
    for win, feeds in WINDOWS.items():
        items = []
        for source, url in feeds:
            try:
                got = fetch(source, url)
                items += got[:PER_WINDOW]
                print(f"ok   {win:8} {source}: {len(got)}")
            except Exception as e:  # one bad feed must not sink the run
                failures += 1
                print(f"FAIL {win:8} {source}: {e}", file=sys.stderr)
        seen, unique = set(), []
        for it in items:
            if it["url"] not in seen:
                seen.add(it["url"])
                unique.append(it)
        if win in SKIP:
            unique = [i for i in unique if not SKIP[win].search(i["title"])]
        unique.sort(key=lambda i: i["date"] or "", reverse=True)
        result[win] = unique[:PER_WINDOW] or old.get(win, [])
    out = {"updated": datetime.now(timezone.utc).isoformat(timespec="seconds"), "windows": result}
    OUT.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
    print(f"wrote {OUT.name}; {failures} feed failure(s)")


if __name__ == "__main__":
    main()
