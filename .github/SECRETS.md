# GitHub Actions secrets (Windows release)

Workflow: [`.github/workflows/build-windows.yml`](workflows/build-windows.yml)  
Triggers: push tag `v*`, or `workflow_dispatch`.

## Required for auto-update

Set under **Repo → Settings → Secrets and variables → Actions**:

| Secret                               | Required?                     | Purpose                                                                                       |
| ------------------------------------ | ----------------------------- | --------------------------------------------------------------------------------------------- |
| `GITHUB_TOKEN`                       | Auto                          | Create/upload GitHub Release. Actions provides this; do not add manually unless you override. |
| `TAURI_SIGNING_PRIVATE_KEY`          | **Yes**                       | Minisign private key. Signs updater artifacts (`createUpdaterArtifacts: true`).               |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | **Yes if key has a password** | Unlocks the private key during `tauri-action`.                                                |

Public key must match and is baked in [`src-tauri/tauri.conf.json`](../src-tauri/tauri.conf.json) (`plugins.updater.pubkey`).  
Update endpoint: `https://github.com/ur-wesley/twitch-vod-manager/releases/latest/download/latest.json`.

Generate a keypair if needed:

```bash
npx @tauri-apps/cli signer generate -w ~/.tauri/twitch-vod-manager.key
```

Put private key contents in `TAURI_SIGNING_PRIVATE_KEY`, password in `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, and the printed public key in `tauri.conf.json`.

## OAuth (build env)

Wired into [`build-windows.yml`](workflows/build-windows.yml) `tauri-action` `env` and baked into the compiled release binary via `option_env!` (while still allowing runtime override via Settings UI or local `.env`). Create these under **Actions secrets** or **Actions variables**:

| Secret                  | Required?         | Purpose                                              |
| ----------------------- | ----------------- | ---------------------------------------------------- |
| `TWITCH_CLIENT_ID`      | For Twitch login  | Helix OAuth client id                                |
| `TWITCH_CLIENT_SECRET`  | For code flow     | Empty → implicit flow; non-empty → auth code         |
| `YOUTUBE_CLIENT_ID`     | For YouTube login | Google OAuth desktop client id                       |
| `YOUTUBE_CLIENT_SECRET` | For YouTube login | Google OAuth client secret                           |
| `GDRIVE_CLIENT_ID`      | Optional          | Drive OAuth; falls back to `YOUTUBE_*` then built-in |
| `GDRIVE_CLIENT_SECRET`  | Optional          | Drive OAuth secret                                   |

Redirects (must match console config exactly, http, no trailing slash):

- Twitch: `http://localhost:17563/auth/callback`
- YouTube: `http://localhost:17564/auth/callback`
- GDrive: `http://localhost:17565/auth/callback`

Example / worker deploy: [`crates/worker/.env.example`](../crates/worker/.env.example).  
Local desktop also loads root `.env` at runtime via `load_oauth_dotenv`.

Worker/VPS (Dokploy) may still set the same `TWITCH_*` / `YOUTUBE_*` / `GDRIVE_*` plus `WORKER_API_KEY`, `DATA_DIR`, etc.

## Release checklist

1. Set `TAURI_SIGNING_PRIVATE_KEY` (+ password if used)
2. Confirm `plugins.updater.pubkey` matches that key
3. Set OAuth secrets above when ready
4. Push tag `vX.Y.Z` (or run workflow manually)
