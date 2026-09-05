use chrono::Utc;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkerJobRecord {
    pub id: String,
    pub vod_id: String,
    pub title: String,
    pub status: String, // "queued", "downloading", "compressing", "uploading", "completed", "failed", "cancelled"
    pub stage: String,
    pub progress_percent: f64,
    pub local_path: Option<String>,
    pub s3_key: Option<String>,
    pub gdrive_file_id: Option<String>,
    pub gdrive_view_url: Option<String>,
    pub webdav_path: Option<String>,
    pub youtube_video_id: Option<String>,
    pub error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobLogRecord {
    pub id: i64,
    pub job_id: String,
    pub message: String,
    pub timestamp: String,
}

pub struct Database {
    conn: Arc<Mutex<Connection>>,
}

impl Database {
    pub fn new(path: &Path) -> Result<Self, rusqlite::Error> {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        let conn = Connection::open(path)?;
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA foreign_keys = ON;

             CREATE TABLE IF NOT EXISTS jobs (
                 id TEXT PRIMARY KEY,
                 vod_id TEXT NOT NULL,
                 title TEXT NOT NULL,
                 status TEXT NOT NULL,
                 stage TEXT NOT NULL DEFAULT '',
                 progress_percent REAL NOT NULL DEFAULT 0.0,
                 local_path TEXT,
                 s3_key TEXT,
                 gdrive_file_id TEXT,
                 gdrive_view_url TEXT,
                 webdav_path TEXT,
                 youtube_video_id TEXT,
                 error TEXT,
                 created_at TEXT NOT NULL,
                 updated_at TEXT NOT NULL
             );

             CREATE TABLE IF NOT EXISTS job_logs (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 job_id TEXT NOT NULL,
                 message TEXT NOT NULL,
                 timestamp TEXT NOT NULL,
                 FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
             );

             CREATE TABLE IF NOT EXISTS config (
                 key TEXT PRIMARY KEY,
                 value TEXT NOT NULL
             );",
        )?;

        let _ = conn.execute("ALTER TABLE jobs ADD COLUMN gdrive_file_id TEXT", []);
        let _ = conn.execute("ALTER TABLE jobs ADD COLUMN gdrive_view_url TEXT", []);
        let _ = conn.execute("ALTER TABLE jobs ADD COLUMN webdav_path TEXT", []);

        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    pub fn insert_job(
        &self,
        id: &str,
        vod_id: &str,
        title: &str,
        status: &str,
    ) -> Result<(), rusqlite::Error> {
        let now = Utc::now().to_rfc3339();
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO jobs (id, vod_id, title, status, stage, progress_percent, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, 'queued', 0.0, ?5, ?5)",
            params![id, vod_id, title, status, now],
        )?;
        Ok(())
    }

    pub fn update_job_status(
        &self,
        id: &str,
        status: &str,
        stage: &str,
        progress_percent: f64,
        error: Option<&str>,
    ) -> Result<(), rusqlite::Error> {
        let now = Utc::now().to_rfc3339();
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE jobs SET status = ?1, stage = ?2, progress_percent = ?3, error = ?4, updated_at = ?5 WHERE id = ?6",
            params![status, stage, progress_percent, error, now, id],
        )?;
        Ok(())
    }

    pub fn update_job_success(
        &self,
        id: &str,
        local_path: Option<&str>,
        s3_key: Option<&str>,
        gdrive_file_id: Option<&str>,
        gdrive_view_url: Option<&str>,
        webdav_path: Option<&str>,
        youtube_video_id: Option<&str>,
    ) -> Result<(), rusqlite::Error> {
        let now = Utc::now().to_rfc3339();
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE jobs SET status = 'completed', stage = 'completed', progress_percent = 100.0,
             local_path = ?1, s3_key = ?2, gdrive_file_id = ?3, gdrive_view_url = ?4, webdav_path = ?5, youtube_video_id = ?6, updated_at = ?7 WHERE id = ?8",
            params![local_path, s3_key, gdrive_file_id, gdrive_view_url, webdav_path, youtube_video_id, now, id],
        )?;
        Ok(())
    }

    pub fn append_log(&self, job_id: &str, message: &str) {
        let now = Utc::now().to_rfc3339();
        if let Ok(conn) = self.conn.lock() {
            let _ = conn.execute(
                "INSERT INTO job_logs (job_id, message, timestamp) VALUES (?1, ?2, ?3)",
                params![job_id, message, now],
            );
        }
    }

    pub fn get_job(&self, id: &str) -> Result<Option<WorkerJobRecord>, rusqlite::Error> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, vod_id, title, status, stage, progress_percent, local_path, s3_key, gdrive_file_id, gdrive_view_url, webdav_path, youtube_video_id, error, created_at, updated_at
             FROM jobs WHERE id = ?1",
        )?;

        let mut rows = stmt.query(params![id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(WorkerJobRecord {
                id: row.get(0)?,
                vod_id: row.get(1)?,
                title: row.get(2)?,
                status: row.get(3)?,
                stage: row.get(4)?,
                progress_percent: row.get(5)?,
                local_path: row.get(6)?,
                s3_key: row.get(7)?,
                gdrive_file_id: row.get(8)?,
                gdrive_view_url: row.get(9)?,
                webdav_path: row.get(10)?,
                youtube_video_id: row.get(11)?,
                error: row.get(12)?,
                created_at: row.get(13)?,
                updated_at: row.get(14)?,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn list_jobs(&self) -> Result<Vec<WorkerJobRecord>, rusqlite::Error> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, vod_id, title, status, stage, progress_percent, local_path, s3_key, gdrive_file_id, gdrive_view_url, webdav_path, youtube_video_id, error, created_at, updated_at
             FROM jobs ORDER BY created_at DESC",
        )?;

        let rows = stmt.query_map([], |row| {
            Ok(WorkerJobRecord {
                id: row.get(0)?,
                vod_id: row.get(1)?,
                title: row.get(2)?,
                status: row.get(3)?,
                stage: row.get(4)?,
                progress_percent: row.get(5)?,
                local_path: row.get(6)?,
                s3_key: row.get(7)?,
                gdrive_file_id: row.get(8)?,
                gdrive_view_url: row.get(9)?,
                webdav_path: row.get(10)?,
                youtube_video_id: row.get(11)?,
                error: row.get(12)?,
                created_at: row.get(13)?,
                updated_at: row.get(14)?,
            })
        })?;

        let mut list = Vec::new();
        for job in rows {
            list.push(job?);
        }
        Ok(list)
    }

    pub fn get_job_logs(&self, job_id: &str) -> Result<Vec<JobLogRecord>, rusqlite::Error> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, job_id, message, timestamp FROM job_logs WHERE job_id = ?1 ORDER BY id ASC",
        )?;

        let rows = stmt.query_map(params![job_id], |row| {
            Ok(JobLogRecord {
                id: row.get(0)?,
                job_id: row.get(1)?,
                message: row.get(2)?,
                timestamp: row.get(3)?,
            })
        })?;

        let mut logs = Vec::new();
        for log in rows {
            logs.push(log?);
        }
        Ok(logs)
    }

    pub fn delete_job(&self, id: &str) -> Result<(), rusqlite::Error> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM jobs WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn get_config(&self, key: &str) -> Result<Option<String>, rusqlite::Error> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT value FROM config WHERE key = ?1")?;
        let mut rows = stmt.query(params![key])?;
        if let Some(row) = rows.next()? {
            Ok(Some(row.get(0)?))
        } else {
            Ok(None)
        }
    }

    pub fn set_config(&self, key: &str, value: &str) -> Result<(), rusqlite::Error> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO config (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn has_vod_been_archived(&self, vod_id: &str) -> bool {
        if let Ok(conn) = self.conn.lock() {
            if let Ok(mut stmt) = conn.prepare("SELECT 1 FROM jobs WHERE vod_id = ?1 AND status = 'completed' LIMIT 1") {
                if let Ok(mut rows) = stmt.query(params![vod_id]) {
                    return rows.next().unwrap_or(None).is_some();
                }
            }
        }
        false
    }
}
