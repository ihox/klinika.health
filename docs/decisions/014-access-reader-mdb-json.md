# ADR 014: Access reader uses `mdb-json`, not pyodbc

Date: 2026-05-17
Status: Accepted — refines [ADR-010](./010-migration-approach.md) and [ADR-012](./012-vizitat-field-mapping-correction.md)

## Context

The migration tool reads `PEDIATRIA.accdb` and inserts into Klinika's Postgres. The reader implementation has shifted twice:

- **ADR-010 (2026-05-13)** specified `mdb-export` CSV staging files.
- **Slice 17, STEP 2 (2026-05-16)** rejected `mdb-export` because memo fields containing newlines / commas broke its CSV escaping, and tentatively chose **pyodbc** via the mdbtools ODBC driver.
- **Slice 17, STEP 6 (2026-05-17)** tried to stand the pyodbc stack up on macOS and discovered the driver no longer exists.

Concretely, on the cutover host (Homebrew, macOS 15.5):

```
$ brew list mdbtools         # 1.0.1
$ find /opt/homebrew -name "libmdbodbc*"
(no matches)
$ ls /opt/homebrew/Cellar/mdbtools/1.0.1/lib/
libmdb.{a,dylib,3.dylib}  libmdbsql.{a,dylib,3.dylib}  pkgconfig
```

mdbtools 1.0 dropped the ODBC driver upstream and only ships the CLI tools and the `libmdb` / `libmdbsql` libraries. Ubuntu 24.04's `mdbtools` package follows the same upstream. Bringing the ODBC path back would mean building an older mdbtools from source plus a unixODBC stack — fragile on the cutover host today, fragile on every future on-prem install.

mdbtools 1.0 also added `mdb-json`: a CLI that streams one JSON object per row on stdout, with all string values JSON-escaped — newlines inside memo fields arrive as `
` and round-trip through `json.loads` cleanly. This is the exact failure mode the original `mdb-export` rejection was about.

## Decision

The migration tool's `AccessReader` wraps **`mdb-json`** (per table) and **`mdb-count`** (for the source row tallies).

- `AccessReader.open(path)` checks both binaries are on `$PATH` and the source file exists. No long-lived connection, no driver setup.
- `iter_table(name)` runs `mdb-json <path> <table>` via `subprocess.Popen`, reads lines from stdout, and yields one dict per line via `json.loads`. Non-zero exit raises so a truncated read can never look like a complete import.
- `count_rows(name)` runs `mdb-count <path> <table>` and parses the integer on stdout. (Empirical aside: `wc -l` of the JSON output is unreliable because memo newlines inflate the line count; `mdb-count` is authoritative — for the audited file it returned 10,187 Pacientet vs. ~13k JSON lines.)

The `AbstractReader` protocol (added in slice 17 STEP 2) stays unchanged, so the import phases and tests are untouched. The 101-test suite continues to use `StubReader` and remains valid.

`pyodbc` is removed from `requirements.txt`. mdbtools moves from an implicit dev convenience to a documented **system** prerequisite (`brew install mdbtools` / `apt install mdbtools`).

## Consequences

- One-line install on every supported host. No unixODBC, no `~/.odbcinst.ini`, no driver registration.
- Memo-field robustness is now the upstream tool's problem (which is its stated purpose) instead of our parser's.
- A new on-prem clinic install needs the mdbtools binary present — captured in the deployment runbook and `config.example.yaml`.
- Each `iter_table` call spawns a subprocess; for the audited file that's two spawns total (Pacientet, Vizitat) plus the cardinality probes. Negligible overhead at the scale of the one-shot migration.

This does **not** change ADR-012's field-mapping decisions or ADR-010's idempotency-via-legacy-id model — those still stand. The reader choice was always orthogonal to both; the prior ADRs simply propagated whichever reader was in scope at the time.

## Revisit when

- mdbtools resurrects an ODBC driver and there's a concrete need for it (none today).
- A new tenant's source isn't Access (a future SQL Server / FHIR cutover would want a different reader altogether).
- `mdb-json` is shown to mis-encode a memo field. The 101-test suite plus the orphans-with-row-content output in production both surface that.

## See also

- [ADR-010](./010-migration-approach.md) — overall migration approach. The "mdb-export CSV staging" sentence is the only part this ADR softens; the idempotency and report design still hold.
- [ADR-012](./012-vizitat-field-mapping-correction.md) — field-mapping correction. Independent decision; unchanged by this ADR.
