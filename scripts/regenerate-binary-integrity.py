#!/usr/bin/env python3
"""One-off generator: enumerate node_modules binaries, verify each against the
official npm tarball, and emit scripts/binary-integrity.json.

Run once (with network) to (re)build the anchor the integrity guard checks.
Not shipped; deleted after use.
"""
import base64
import gzip
import hashlib
import io
import json
import os
import re
import sys
import tarfile
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

BIN = re.compile(r"\.(exe|node|dll)$", re.I)

lock = json.load(open("package-lock.json"))
pkgs = lock["packages"]

# Package keys that are not registry tarballs (workspace links, local paths).
def is_registry(info):
    return bool(info.get("resolved")) and str(info.get("resolved", "")).startswith("http")

found = []
for root, dirs, files in os.walk("node_modules"):
    if os.sep + ".bin" in root:
        continue
    for f in files:
        if BIN.search(f):
            found.append(os.path.join(root, f).replace(os.sep, "/"))


def owner(path):
    d = os.path.dirname(path)
    best = None
    for k in pkgs:
        if k == "":
            continue
        if (d == k or d.startswith(k + "/")) and (best is None or len(k) > len(best)):
            best = k
    return best


tarcache = {}
out = []
problems = []

for p in sorted(found):
    key = owner(p)
    info = pkgs.get(key, {})
    rel = os.path.relpath(p, key).replace(os.sep, "/")
    if not is_registry(info):
        problems.append((p, key, "no registry tarball for owning package"))
        continue

    resolved = info["resolved"]
    integrity = info.get("integrity", "")
    if resolved not in tarcache:
        raw = urllib.request.urlopen(resolved, timeout=120).read()
        got = "sha512-" + base64.b64encode(hashlib.sha512(raw).digest()).decode()
        tarcache[resolved] = (
            tarfile.open(fileobj=io.BytesIO(gzip.decompress(raw))),
            got == integrity,
            integrity,
        )
    tf, tarball_ok, _ = tarcache[resolved]
    if not tarball_ok:
        problems.append((p, key, "tarball sha512 != package-lock integrity"))
        continue

    official = None
    for m in tf.getmembers():
        if m.name == "package/" + rel:
            official = hashlib.sha256(tf.extractfile(m).read()).hexdigest()
            break

    local = hashlib.sha256(open(p, "rb").read()).hexdigest()
    if official is None:
        # Binary exists on disk but the published tarball does not ship it:
        # exactly the shape of the esbuild tamper (planted .ico / renamed exe).
        problems.append((p, key, "NOT IN OFFICIAL TARBALL (planted file?)"))
        continue
    if official != local:
        problems.append((p, key, "LOCAL HASH != OFFICIAL TARBALL"))
        continue

    pkg_name = info.get("name") or key.split("node_modules/")[-1]
    out.append(
        {
            "package": pkg_name,
            "version": info.get("version", ""),
            "file": p.split("node_modules/", 1)[1],
            "sha256": local,
        }
    )

inventory = {
    "_comment": (
        "SHA-256 of every native binary shipped by a registry dependency, "
        "captured from the official npm tarball. Regenerate with the documented "
        "procedure if dependencies change; scripts/verify-binaries.mjs checks "
        "installed files against these hashes."
    ),
    # npm installs only the binaries matching the host, so an anchor is
    # inherently per-platform. The guard enforces it on this platform and skips
    # elsewhere (with a message) instead of reporting every row as MISSING.
    "platform": {"os": "win32", "cpu": "x64"},
    "binaries": sorted(out, key=lambda r: (r["package"], r["file"])),
}

with open("scripts/binary-integrity.json", "w", newline="\n") as fh:
    json.dump(inventory, fh, indent=2)
    fh.write("\n")

print(f"binaries verified against official tarballs : {len(out)}")
print(f"packages downloaded                          : {len(tarcache)}")
if problems:
    print(f"\nPROBLEMS ({len(problems)}):")
    for p, k, why in problems:
        print(f"  {p}  [{k}]  {why}")
    sys.exit(1)
print("\nall binaries matched their official tarballs")