import hashlib
import json
from pathlib import Path

import pytest

from backend import db


def test_sample_matches_legacy_rows(sample_data):
    hashes = json.loads(
        (Path(__file__).parents[1] / "fixtures/seed_hashes.json").read_text()
    )
    for table, rows in sample_data.items():
        canonical = [
            {k: v for k, v in row.items() if k not in ["created_at", "finished_at"]}
            for row in rows
        ]
        actual = hashlib.sha256(
            json.dumps(
                canonical, ensure_ascii=False, sort_keys=True, separators=(",", ":")
            ).encode()
        ).hexdigest()
        assert actual == hashes[table], table


def test_sqlite_read_only_import(sample_db, tmp_path):
    import sqlite3

    path = tmp_path / "source.sqlite"
    with sqlite3.connect(path) as target:
        sample_db.backup(target)
    before = hashlib.sha256(path.read_bytes()).hexdigest()
    data = db.import_sqlite(path)
    assert (
        len(data["orders"])
        == sample_db.execute("SELECT COUNT(*) FROM orders").fetchone()[0]
    )
    assert hashlib.sha256(path.read_bytes()).hexdigest() == before
    missing = tmp_path / "missing.sqlite"
    with pytest.raises(sqlite3.OperationalError):
        db.import_sqlite(missing)
    assert not missing.exists()
