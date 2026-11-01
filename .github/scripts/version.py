"""Version rules shared by every workflow (see the header of each workflow).

Formats:
  one dot  X.Y    minor 0-9:            4.7 -> 4.8 -> 4.9 -> 5.0
  two dots X.Y.Z  minor and patch 0-9:  1.0.9 -> 1.1.0, 1.9.9 -> 2.0.0
Two dots are used only after a two-dot override (e.g. 4.8.0); a one-dot
override (e.g. 5.0) switches back. The baseline for the next version is the
release marked Latest (its value AND its format), so an override always
becomes the baseline of the next run.

Commands (results go to $GITHUB_OUTPUT as version=, tag=, code=):
  next   <tags-file> [<latest-tag>]   primary: next version (env VERSION_OVERRIDE)
  label  <tags-file> [<latest-tag>]   test builds of the primary: same, label only
  latest <latest-tag>                 add-ons: the Latest release's version
  label-latest <tags-file> [<latest>] add-on test builds: Latest, else the next
"""
import os
import re
import subprocess
import sys

VERSION_RE = re.compile(r"v?(\d+)\.(\d)(?:\.(\d))?")


def fail(message):
    print("::error::" + message)
    raise SystemExit(1)


def parse(tag):
    """(major, minor, patch, long) or None for tags without a valid version."""
    m = VERSION_RE.fullmatch((tag or "").strip())
    if not m:
        return None
    return (int(m.group(1)), int(m.group(2)), int(m.group(3) or 0), m.group(3) is not None)


def text(v):
    return "%d.%d.%d" % v[:3] if v[3] else "%d.%d" % v[:2]


def key(v):
    return v[:3]  # numeric comparison, one-dot X.Y counts as X.Y.0


def step(v):
    major, minor, patch, long = v
    if long:
        if patch < 9:
            return (major, minor, patch + 1, True)
        return (major, minor + 1, 0, True) if minor < 9 else (major + 1, 0, 0, True)
    return (major, minor + 1, 0, False) if minor < 9 else (major + 1, 0, 0, False)


def read_tags(path):
    raw, valid = set(), []
    if path and os.path.exists(path):
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                tag = line.strip()
                if tag:
                    raw.add(tag)
                    v = parse(tag)
                    if v:
                        valid.append(v)
    return raw, valid


def taken(v, raw):
    return any(t in raw for t in ("v" + text(v), text(v)))


def next_version(tags_path, latest_tag, override):
    raw, valid = read_tags(tags_path)
    highest = max(valid, key=key) if valid else None
    if override:
        v = parse(override if "." in override else override + ".0")
        if not v:
            fail("Version override '%s' must look like 3, 1.4 (one dot) or 1.4.0 (two dots), each digit after a dot 0-9." % override)
        if highest and key(v) < key(highest):
            print("::warning::v%s is lower than the highest existing version v%s. It still becomes the Latest release and the baseline of the next run." % (text(v), text(highest)))
        if taken(v, raw):
            fail("Tag v%s already exists. Leave the override empty to auto-advance, or choose a free version." % text(v))
        return v
    base = parse(latest_tag) or highest
    v = step(base) if base else (1, 0, 0, False)
    while taken(v, raw):  # never reuse an existing tag
        v = step(v)
    return v


def output(**values):
    out = os.environ.get("GITHUB_OUTPUT")
    lines = "".join("%s=%s\n" % kv for kv in values.items())
    if out:
        with open(out, "a", encoding="utf-8") as fh:
            fh.write(lines)
    sys.stdout.write(lines)


def code(v):
    # Android versionCode: rises across X.Y and X.Y.Z (4.7 = 470, 4.8.1 = 481).
    return v[0] * 100 + v[1] * 10 + v[2]


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    args = sys.argv[2:] + ["", ""]
    if cmd in ("next", "label"):
        override = os.environ.get("VERSION_OVERRIDE", "").strip() if cmd == "next" else ""
        v = next_version(args[0], args[1], override)
        if cmd == "next":
            exists = subprocess.run(["gh", "release", "view", "v" + text(v)],
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
            if exists:
                fail("Release v%s already exists. Leave the override empty to auto-advance, or choose a free version." % text(v))
    elif cmd == "latest":
        if not args[0].strip():
            fail("No release exists yet. Run \"Website — Release (Primary)\" first.")
        v = parse(args[0])
        if not v:
            fail("Latest release tag '%s' carries no valid version (vX.Y or vX.Y.Z). Run \"Website — Release (Primary)\" first." % args[0])
    elif cmd == "label-latest":
        v = parse(args[1]) or next_version(args[0], "", "")
    else:
        fail("usage: version.py next|label|latest|label-latest ...")
    output(version=text(v), tag="v" + text(v), code=code(v))


if __name__ == "__main__":
    main()
