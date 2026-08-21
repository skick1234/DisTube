#!/usr/bin/env python3
"""Extract a release-candidate bundle without trusting tar paths or entry types."""

from __future__ import annotations

import shutil
import sys
import tarfile
from pathlib import Path, PurePosixPath

CANDIDATE_ROOT = PurePosixPath(".artifacts/release-candidate")
ALLOWED_ROOTS = {PurePosixPath(".artifacts"), CANDIDATE_ROOT}
MAX_MEMBERS = 8192
MAX_TOTAL_BYTES = 4 * 1024 * 1024 * 1024
ALLOWED_TYPES = {tarfile.REGTYPE, tarfile.AREGTYPE, tarfile.DIRTYPE}


class UnsafeBundle(ValueError):
    pass


def member_path(member: tarfile.TarInfo) -> PurePosixPath:
    raw = member.name[:-1] if member.isdir() and member.name.endswith("/") else member.name
    if not raw or "\\" in raw:
        raise UnsafeBundle(f"unsafe candidate member path: {member.name!r}")
    parts = raw.split("/")
    if any(part in {"", ".", ".."} for part in parts):
        raise UnsafeBundle(f"unsafe candidate member path: {member.name!r}")
    path = PurePosixPath(*parts)
    if path.is_absolute() or (path not in ALLOWED_ROOTS and CANDIDATE_ROOT not in path.parents):
        raise UnsafeBundle(f"candidate member is outside {CANDIDATE_ROOT}: {member.name!r}")
    return path


def validate(archive: tarfile.TarFile) -> list[tuple[tarfile.TarInfo, PurePosixPath]]:
    members: list[tuple[tarfile.TarInfo, PurePosixPath]] = []
    paths: set[PurePosixPath] = set()
    total_bytes = 0
    manifest_found = False

    for member in archive:
        if len(members) >= MAX_MEMBERS:
            raise UnsafeBundle(f"candidate bundle exceeds {MAX_MEMBERS} members")
        if member.type not in ALLOWED_TYPES:
            raise UnsafeBundle(f"unsafe candidate member type for {member.name!r}")
        path = member_path(member)
        if path in paths:
            raise UnsafeBundle(f"duplicate candidate member: {member.name!r}")
        paths.add(path)
        if member.isfile():
            if member.size < 0:
                raise UnsafeBundle(f"invalid candidate member size: {member.name!r}")
            total_bytes += member.size
            if total_bytes > MAX_TOTAL_BYTES:
                raise UnsafeBundle("candidate bundle exceeds the extracted size limit")
        if path == CANDIDATE_ROOT / "manifest.json" and member.isfile():
            manifest_found = True
        members.append((member, path))

    if not manifest_found:
        raise UnsafeBundle("candidate bundle omits .artifacts/release-candidate/manifest.json")
    return members


def extract(archive_path: Path, destination: Path) -> None:
    if destination.exists() or destination.is_symlink():
        raise UnsafeBundle(f"candidate destination already exists: {destination}")

    with tarfile.open(archive_path, mode="r:gz") as archive:
        members = validate(archive)
        destination.mkdir(parents=True)
        try:
            for member, path in members:
                target = destination.joinpath(*path.parts)
                if member.isdir():
                    target.mkdir(parents=True, exist_ok=True)
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                source = archive.extractfile(member)
                if source is None:
                    raise UnsafeBundle(f"candidate member has no file data: {member.name!r}")
                with source, target.open("xb") as output:
                    shutil.copyfileobj(source, output)
        except BaseException:
            shutil.rmtree(destination, ignore_errors=True)
            raise


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: extract-release-candidate.py <candidate.tar.gz> <destination>")
    extract(Path(sys.argv[1]), Path(sys.argv[2]))


if __name__ == "__main__":
    main()
