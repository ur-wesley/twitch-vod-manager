# Worker Storage Quota Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Configurable worker `max_storage_gb` (default 100), report configured free from `completed/`, hard-stop new jobs when full.

**Architecture:** Desktop settings field syncs via `/api/sync`. Worker measures `completed/` bytes, exposes `storage_*_gb` on status, rejects create-job/watcher when used ≥ max (HTTP 507).

**Tech Stack:** Rust (vod-core settings, worker axum), SolidJS settings/workers UI, Tauri sync command.

**Spec:** `docs/superpowers/specs/2026-09-05-worker-storage-quota-design.md`

---

### Task 1: Settings field (core + tauri + TS)

**Files:**
- Modify: `crates/core/src/settings.rs`
- Modify: `src-tauri/src/modules/settings.rs`
- Modify: `src/types/index.ts`

- [x] Add `max_storage_gb: Option<u32>` default `Some(100)` to both AppSettings + Default
- [x] Add to TS `AppSettings` and `WorkerStatus` (`storage_max_gb`, `storage_used_gb`, `storage_free_gb`)

### Task 2: Worker quota helpers + status + sync + gate

**Files:**
- Modify: `crates/worker/src/api/mod.rs`
- Modify: `crates/worker/src/watcher.rs`

- [x] Helpers: `completed_used_bytes`, `resolve_max_storage_gb`, `storage_quota_gb` (max/used/free as f64, bytes/1e9)
- [x] Extend `WorkerStatusResponse` + status handler
- [x] `SyncSettingsRequest.max_storage_gb` + persist; include in get_config keys
- [x] `create_job_handler`: before `insert_job`, if used ≥ max return `(507, Json({job_id:"", message}))`
- [x] `watcher`: before queueing any new VOD (once per check is enough — break/return early when over), skip with `info!` log
- [x] Unit tests for used/free math (temp dir with files)

### Task 3: Desktop sync + UI

**Files:**
- Modify: `src-tauri/src/commands/mod.rs` (`worker_sync_settings` payload)
- Modify: `src/features/settings/SettingsView.tsx`
- Modify: `src/features/workers/CloudWorkersView.tsx`

- [x] Sync includes `max_storage_gb`
- [x] Settings: number input near worker section; status line shows configured free/max
- [x] Workers disk card: primary configured free of max; host disk secondary

### Task 4: Verify

- [x] `rtk cargo test -p twitch-vod-worker` (or crate name) for unit tests
- [x] `graphify update .` after code changes
