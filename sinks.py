"""Warehouse / database sinks for cleaned frames.

v1 supports SQLite only — stdlib, zero new dependencies. The spec form is a
URI so postgres/mysql can slot in later without changing the CLI::

    --sink sqlite:///warehouse.db                  # table derived from input stem
    --sink sqlite:///warehouse.db:customers        # explicit table
    --sink-if-exists replace|append|fail           # default: replace

Deliberate differences from the CSV export path:

- Cells are stored RAW (no export sanitizer). The ``'=...`` quote prefix
  exists to stop Excel executing formulas; a database never executes cell
  text, so quoting there would corrupt data instead of protecting it.
- A sink failure fails the dataset loudly (``success=False``) — a missing
  warehouse load must never pass silently.
"""
import os
import re
import sqlite3

_TABLE_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")
IF_EXISTS_CHOICES = ("replace", "append", "fail")


def check_db_path(path: str) -> None:
    """Refuse parent-directory escapes, same policy as other export paths."""
    parts = str(path).replace("\\", "/").split("/")
    if ".." in parts:
        raise ValueError(f"refusing sink database path with parent escape: {path!r}")


def derive_table(file_path: str) -> str:
    """Table name from the input stem: slugify, fall back to 'cleaned'."""
    stem = os.path.splitext(os.path.basename(str(file_path)))[0]
    slug = re.sub(r"[^A-Za-z0-9_]", "_", stem).strip("_")
    if not slug or not re.match(r"^[A-Za-z_]", slug):
        slug = "cleaned_" + slug if slug else "cleaned"
    return slug[:64]


def check_table(name: str) -> str:
    if not _TABLE_RE.match(name or ""):
        raise ValueError(
            f"refusing table name {name!r}: use letters, digits, underscores, "
            "starting with a letter/underscore (max 64 chars)")
    return name


def _split_db_table(rest: str) -> tuple[str, str | None]:
    """Split ``rest`` (after ``sqlite://``) into (db_path, table|None).

    Path conventions (SQLAlchemy-style): ``sqlite:///rel.db`` and
    ``sqlite://rel.db`` are cwd-relative, ``sqlite:////abs/x.db`` is a
    POSIX absolute path, ``sqlite:///C:/x.db`` a Windows one. A table
    follows the LAST colon — except the drive colon, which is consumed
    first so ``C:\\x.db`` never parses ``\\x.db`` as a table. A colon
    whose tail is NOT a valid table name is a loud error (a typo'd
    ``db:bad-table!`` must never silently become a weird filename).
    """
    drive = re.match(r"^/?([A-Za-z]:)(.*)$", rest, re.DOTALL)
    if drive:
        path_part = drive.group(1) + drive.group(2)
        head, sep, tail = drive.group(2).rpartition(":")
        if sep and _TABLE_RE.match(tail) and head:
            return drive.group(1) + head, tail
        if sep and tail:
            raise ValueError(
                f"malformed sink table {tail!r}: use letters, digits, "
                "underscores, starting with a letter/underscore")
        return path_part, None
    if rest.startswith("//"):
        path_part = "/" + rest.lstrip("/")
    else:
        path_part = rest.lstrip("/")
    if ":" in path_part:
        head, _, tail = path_part.rpartition(":")
        if head and _TABLE_RE.match(tail):
            return head, tail
        raise ValueError(
            f"malformed sink table {tail!r}: use letters, digits, "
            "underscores, starting with a letter/underscore")
    return path_part, None


def parse_sink(spec: str, file_path: str) -> dict:
    """Parse ``--sink SPEC`` into ``{"kind", "db", "table"}``.

    Only ``sqlite://`` exists in v1; anything else is a loud error (not a
    silent no-op), so a typo'd postgres URI can never masquerade as success.
    """
    if not isinstance(spec, str) or not spec.startswith("sqlite://"):
        raise ValueError(
            f"unsupported sink {spec!r}: v1 supports sqlite:///PATH.DB[:TABLE] only")
    db, table = _split_db_table(spec[len("sqlite://"):])
    if not db:
        raise ValueError(f"sink {spec!r} is missing the database path")
    check_db_path(db)
    return {"kind": "sqlite", "db": db, "table": check_table(table) if table else derive_table(file_path)}


def write_sink(df, spec: dict, *, if_exists: str = "replace") -> dict:
    """Load ``df`` into the sink. Returns ``{"db", "table", "rows"}``."""
    if if_exists not in IF_EXISTS_CHOICES:
        raise ValueError(f"sink-if-exists must be one of {IF_EXISTS_CHOICES}")
    conn = sqlite3.connect(spec["db"])
    try:
        df.to_sql(spec["table"], conn, if_exists=if_exists, index=False)
    finally:
        conn.close()
    return {"db": spec["db"], "table": spec["table"], "rows": len(df)}
