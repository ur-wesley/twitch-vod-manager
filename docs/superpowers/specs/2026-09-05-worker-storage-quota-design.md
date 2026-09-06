# Worker Storage Quota Design

Date: 2026-09-05  
Status: Approved for planning

## Problem

Workers report host mount disk free/total only. Operators need a **configured local usage cap** (default 100 GB) so a VPS with a large disk does not fill `completed/` unboundedly. UI must show free space **within that cap**, not only host free space.

Cloud upload destinations (S3, GDrive, WebDAV, YouTube) already work via job flags and synced credentials — **out of scope**.

## Goals

1. Configurable `max_storage_gb` (default 100), set in desktop settings and synced to the worker.
2. Measure used space as sum of file sizes under `{DATA_DIR}/completed` only.
3. Report configured free: `max(0, max_storage_gb − used_gb)`.
4. Hard-stop new work when used ≥ max (API create-job and auto-watcher enqueue).
5. Surface configured free in Workers UI and Settings worker status line.

## Non-goals

- Upload destination changes.
- Estimating upcoming VOD size before accept.
- Enforcing host disk fullness (separate from quota).
- Tracking usage in DB instead of filesystem walk.
- Auto-evicting old completed files.

## Behavior

### Quota math

| Field             | Meaning                                            |
| ----------------- | -------------------------------------------------- |
| `storage_max_gb`  | Configured cap (from settings / sync; default 100) |
| `storage_used_gb` | Sum of file sizes in `{DATA_DIR}/completed` / 1e9  |
| `storage_free_gb` | `max(0, storage_max_gb − storage_used_gb)`         |

Existing `disk_total_gb` / `disk_free_gb` (host mount) remain unchanged and stay secondary in UI.

### Hard stop

- When `storage_used_gb >= storage_max_gb`, refuse new jobs.
- API: `POST` create-job returns **507 Insufficient Storage** with a clear JSON/message body (used, max, free).
- Auto-watcher: do not start a new archive when over quota; log reason.
- Jobs already queued or running may finish and increase used further; only _new_ accepts are blocked.
- No preflight estimate of VOD size — gate is current completed usage only.

### Config defaults / validation

- `max_storage_gb: Option<u32>` on `AppSettings`, default `Some(100)`.
- Valid range: ≥ 1. Invalid or missing on worker → treat as **100**.
- Synced via existing `/api/sync` (`SyncSettingsRequest` + `worker_sync_settings`).
- Worker stores value in its config KV (same pattern as `auto_archive_*`).

## Data / API changes

### Settings

Add to `AppSettings` (core, tauri twin, TypeScript):

- `max_storage_gb: Option<u32>` (default 100)

### Sync payload

Add optional `max_storage_gb: Option<u32>` to `SyncSettingsRequest`; persist with `db.set_config("max_storage_gb", ...)`.

### Status response

Extend `WorkerStatusResponse` / `WorkerStatus`:

- `storage_max_gb: f64` (or u64)
- `storage_used_gb: f64`
- `storage_free_gb: f64`

## UI

1. **Settings → Cloud Worker**: number input “Max local storage (GB)” (default 100); included in save/sync.
2. **Workers status disk card**: primary line e.g. `42.3 GB free of 100 GB` (configured quota); host disk as secondary line.
3. **Settings test-connection status**: show configured free (and max), not only host `disk_free_gb`.
4. Dispatch/create failures due to quota: show worker error message to the user.

## Implementation touchpoints

- `crates/core/src/settings.rs` — field + default
- `src-tauri/src/modules/settings.rs` — twin
- `src/types/index.ts` — TS types
- `crates/worker/src/api/mod.rs` — status fields, sync field, create-job gate, `completed/` size helper
- `crates/worker/src/watcher.rs` — same gate before archive
- `src-tauri/src/commands/mod.rs` — include field in sync
- `src/features/settings/SettingsView.tsx` — input + status line
- `src/features/workers/CloudWorkersView.tsx` — disk card

Helper (worker): walk `{data_dir}/completed`, sum file lengths; ignore missing dir as 0 used.

## Testing

1. Unit: used/free calculation for empty dir, files under cap, files over cap.
2. API: create-job returns 507 when used ≥ max; succeeds when under.
3. Sync: `max_storage_gb` persists and appears on status.
4. Watcher: skips new archive when over quota (log assertion or equivalent).

## Out of scope reminder

Do not change S3 / GDrive / WebDAV / YouTube upload paths; they already work.
