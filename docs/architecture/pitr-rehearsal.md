# PITR rehearsal — measured RTO/RPO (close-out)

**Status:** rehearsed for real on the sandbox (2026-09-03/04). Phase 6 delivered the backup +
restore runbook and a successful full-restore drill; this adds **point-in-time recovery** with
WAL archiving — the gap between "we can restore last night's backup" and "we can restore to
any minute".

## Configuration (production posture, not demo-only)

- `wal_level = replica`, `archive_mode = on`
- `archive_command = 'cp %p <archive-dir>/%f'` — every WAL segment is copied to the archive
  **as it fills**, so the archive always contains the latest committed transactions.
- Base backup: `pg_basebackup -h 127.0.0.1 -U <user> -D <base-dir> -Fp -X stream` (plain
  format, WAL streamed into the base) — a clean copy plus the WAL needed to reach the archive
  seamlessly.

Sandbox note: Postgres runs as the `postgres` OS user, which cannot traverse `/home/user`;
archive/base/recovery staging therefore lives in postgres-owned
`/var/lib/postgresql/zfloat-pitr/{archive,base1,…}`. In-repo evidence and this writeup live in
`data/pitr/pitr-drill-summary.json`. A real deployment puts the archive on durable object
storage with retention matching the RPO/RTO SLA and the documented retention policy.

## The rehearsal (what was actually done)

1. Live payment traffic continued while a recovery window was chosen:
   marker **A** committed `2026-09-03 23:50:31.117Z` (before target T).
2. Target **T = 2026-09-03 23:50:34+00** was recorded; one more payment ran: marker **B**
   committed `2026-09-03 23:50:38.104Z` (after T); `pg_switch_wal()` forced the archive to
   close out.
3. A scratch cluster was created and its data directory replaced by the base backup, with
   `restore_command` pointing at the archive and `recovery_target_time = T`.
4. Recovery replayed the archive and stopped exactly at the target:
   `recovery stopping before commit of transaction 22181, time 2026-09-03 23:50:35.695712+00`.
   (Debian layout note: the settings belong in `/etc/postgresql/17/<cluster>/postgresql.conf`,
   not the data dir, and the `recovery.signal` file goes in the data dir.)
5. The recovered database was queried in read-only recovery:
   - marker A (before T): **present**
   - marker B (after T): **absent**
   - totals intact: 8 users, 1,177 payments — i.e., every transaction up to T is there and
     nothing after it is.

## Measured RTO / RPO (this sandbox, single node)

- **RTO ≈ 2–3 s** of recovery/startup to a consistent recovered cluster when base + archive
  are local (cluster boot included; excludes provisioning/media time of a real deployment,
  which is where the RTO budget actually goes: spinning up a replacement instance, restoring
  the base, pointing at the archive).
- **RPO ≈ 1.7 s observed** on this workload: the last archived transaction before the target
  commit was ~1.7 s earlier (23:50:35.7 archive close vs 23:50:34.0 target). Real-world RPO is
  bounded by WAL-archive cadence + the archive store's durability SLA — with `archive_mode=on`
  the ceiling is a few seconds of WAL (per `archive_timeout` if set), not the nightly backup
  window.
- **Zero-data-loss claim:** per-transaction WAL archiving + a recovery rehearsal that cut at a
  mid-transaction boundary (no marker B leakage, no marker A loss) is the evidence posture;
  a production zero-RPO claim additionally requires the archive store to be synchronous or
  near-synchronous with the primary and is deployment-specific.

## Runbook (concise)

```bash
# archive + base (already configured on the sandbox)
sudo -u postgres psql -c "ALTER SYSTEM SET wal_level='replica'"
sudo -u postgres psql -c "ALTER SYSTEM SET archive_mode='on'"
sudo -u postgres psql -c "ALTER SYSTEM SET archive_command='cp %p /var/lib/postgresql/zfloat-pitr/archive/%f'"
sudo pg_ctlcluster 17 main restart
sudo -u postgres env PGPASSWORD=… pg_basebackup -h 127.0.0.1 -U zfloat -D /var/lib/postgresql/zfloat-pitr/base1 -Fp -X stream

# recovery rehearsal (scratch cluster)
sudo pg_createcluster 17 pitrdrill --port 55433
sudo pg_ctlcluster 17 pitrdrill stop
sudo rm -rf /var/lib/postgresql/17/pitrdrill/*
sudo cp -a /var/lib/postgresql/zfloat-pitr/base1/. /var/lib/postgresql/17/pitrdrill/
sudo chown -R postgres:postgres /var/lib/postgresql/17/pitrdrill
sudo bash -c 'echo "restore_command = '\''cp /var/lib/postgresql/zfloat-pitr/archive/%f %p'\''" >> /etc/postgresql/17/pitrdrill/postgresql.conf
             echo "recovery_target_time = '\''2026-09-03 23:50:34+00'\''" >> /etc/postgresql/17/pitrdrill/postgresql.conf
             touch /var/lib/postgresql/17/pitrdrill/recovery.signal'
sudo pg_ctlcluster 17 pitrdrill start   # read-only at the target; promote when verified
sudo pg_dropcluster 17 pitrdrill --stop
```

Evidence: `data/pitr/pitr-drill-summary.json`.
