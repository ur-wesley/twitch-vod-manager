# GitHub Actions secrets (Windows release)

Workflow: [`.github/workflows/build-windows.yml`](workflows/build-windows.yml)  
Triggers: push tag `v*`, or `workflow_dispatch`.

## Required for auto-update

Set under **Repo → Settings → Secrets and variables → Actions**:

| Secret | Required? | Purpose |
| --- | --- | --- |
| `GITHUB_TOKEN` | Auto | Create/upload GitHub Release. Actions provides this; do not add manually unless you override. |
| `TAURI_SIGNING_PRIVATE_KEY` | **Yes** | Minisign private key. Signs updater artifacts (`createUpdaterArtifacts: true`). |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | **Yes if key has a password** | Unlocks the private key during `tauri-action`. |

Public key must match and is baked in [`src-tauri/tauri.conf.json`](../src-tauri/tauri.conf.json) (`plugins.updater.pubkey`).  
Update endpoint: `https://github.com/ur-wesley/twitch-vod-manager/releases/latest/download/latest.json`.

Generate a keypair if needed:

```bash
npx @tauri-apps/cli signer generate -w ~/.tauri/twitch-vod-manager.key
```

Put private key contents in `TAURI_SIGNING_PRIVATE_KEY`, password in `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, and the printed public key in `tauri.conf.json`.

## OAuth — not GHA build secrets

Desktop OAuth is **runtime** (`std::env::var`), then built-in defaults. Putting OAuth vars in this workflow does **not** embed them in the shipped `.exe`.

| Env | Fallback |
| --- | --- |
| `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` | Built-in Twitch web client (`kimne78…`); empty secret → implicit flow |
| `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` | Built-in Google desktop client |
| `GDRIVE_CLIENT_ID` / `GDRIVE_CLIENT_SECRET` | `YOUTUBE_*`, then same built-in Google client |

Example values / worker deploy env: [`crates/worker/.env.example`](../crates/worker/.env.example).

Worker/VPS (Dokploy) may still set `TWITCH_*`, `YOUTUBE_*`, optional `GDRIVE_*`, plus `WORKER_API_KEY`, `DATA_DIR`, etc. That is **deploy** env, not this Windows build workflow.

## Release checklist

1. Set `TAURI_SIGNING_PRIVATE_KEY` (+ password if used)
2. Confirm `plugins.updater.pubkey` matches that key
3. Push tag `vX.Y.Z` (or run workflow manually)
4. OAuth: no extra GHA secrets for current architecture
