# 🚀 Twitch VOD Cloud Worker (VPS)

Self-hosted, autonomous cloud worker daemon for downloading, compressing, and archiving Twitch broadcasts to S3-compatible cloud storage (Cloudflare R2, Backblaze B2, AWS S3) and YouTube.

Works 24/7 in the background on your VPS **even when the desktop app is closed or your local computer is powered off**.

---

## ⚡ Quick Start with Docker (Recommended)

### 1. Clone or copy repository to your VPS
```bash
git clone https://github.com/your-username/twitch-vod-manager.git
cd twitch-vod-manager/crates/worker
```

### 2. Configure Environment
Copy `.env.example` to `.env` and set a secure `WORKER_API_KEY`:
```bash
cp .env.example .env
nano .env
```

### 3. Start the Worker
```bash
docker compose up -d --build
```

Your worker is now running on port `8080` with FFmpeg installed and hardware/software encoding enabled!

---

## Dokploy

Production worker on the netcup Dokploy instance.

- URL: `https://vod.wesley.fyi`
- Image: repo-root context, `crates/worker/Dockerfile`
- Env: `WORKER_PORT=8080`, `WORKER_API_KEY`, `DATA_DIR=/data`, `RUST_LOG=info,vod_worker=debug`
- Volume: `twitch-vod-worker-data` → `/data` (SQLite + temp jobs)
- Health: `GET /health` (unauthenticated)
- Optional `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` in env (same as `YOUTUBE_*` / `GDRIVE_*`). Twitch user tokens + S3/WebDAV still via Sync Settings.

---

## 💻 Native Linux / Systemd Setup (Without Docker)

### 1. Install prerequisites
```bash
sudo apt update
sudo apt install -y ffmpeg curl build-essential
```

### 2. Compile release binary
```bash
cargo build --release -p vod-worker
sudo cp ../../target/release/vod-worker /usr/local/bin/
```

### 3. Create Systemd Service
Create `/etc/systemd/system/twitch-vod-worker.service`:
```ini
[Unit]
Description=Twitch VOD Cloud Worker
After=network.target

[Service]
Type=simple
User=ubuntu
Environment="WORKER_PORT=8080"
Environment="WORKER_API_KEY=your_secret_api_key"
Environment="DATA_DIR=/var/lib/twitch-vod-worker"
ExecStart=/usr/local/bin/vod-worker
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable and start the service:
```bash
sudo mkdir -p /var/lib/twitch-vod-worker
sudo chown -R ubuntu:ubuntu /var/lib/twitch-vod-worker
sudo systemctl daemon-reload
sudo systemctl enable --now twitch-vod-worker
```

---

## 🔗 Connecting to Desktop App

1. Open **Twitch VOD Manager** on your desktop.
2. Go to **Settings** -> **Cloud Worker (VPS)** tab.
3. Enter your VPS Worker URL: e.g. `http://YOUR_VPS_IP:8080` (or `https://worker.yourdomain.com`).
4. Enter your `WORKER_API_KEY`.
5. Click **"Test Connection"** -> You should see **Online**, server CPU/RAM usage, and FFmpeg version.
6. Click **"Sync Settings to VPS"** -> This pushes your Twitch credentials, S3 credentials, and compression preferences directly to your VPS worker!

---

## 🤖 Autonomous Channel Watcher

The worker includes an autonomous background watcher. Once credentials are synced:
- Turn on **"Auto-Archive Channel"** in the worker settings.
- The worker periodically checks Twitch for newly ended broadcasts.
- When you finish streaming on Twitch, the VPS worker detects the new VOD, downloads it at datacenter speeds, compresses it with FFmpeg, and uploads it to your S3 bucket (or YouTube) automatically.
- Your personal computer never needs to be left on!
