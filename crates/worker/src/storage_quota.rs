use std::path::Path;

pub fn completed_used_bytes(completed_dir: &Path) -> u64 {
    if !completed_dir.exists() {
        return 0;
    }
    let mut total = 0u64;
    let Ok(entries) = std::fs::read_dir(completed_dir) else {
        return 0;
    };
    for entry in entries.flatten() {
        let Ok(ft) = entry.file_type() else {
            continue;
        };
        if ft.is_symlink() {
            continue;
        }
        let path = entry.path();
        if ft.is_file() {
            if let Ok(meta) = entry.metadata() {
                total = total.saturating_add(meta.len());
            }
        } else if ft.is_dir() {
            total = total.saturating_add(completed_used_bytes(&path));
        }
    }
    total
}

pub fn resolve_max_storage_gb(raw: Option<&str>) -> u32 {
    raw.and_then(|v| v.parse::<u32>().ok())
        .filter(|&v| v >= 1)
        .unwrap_or(100)
}

pub fn storage_quota_stats(completed_dir: &Path, max_gb: u32) -> (f64, f64, f64) {
    let used_bytes = completed_used_bytes(completed_dir);
    let max = max_gb as f64;
    let used = used_bytes as f64 / 1_000_000_000.0;
    let free = (max - used).max(0.0);
    (max, used, free)
}

pub fn is_over_quota(completed_dir: &Path, max_gb: u32) -> bool {
    let (_, used, _) = storage_quota_stats(completed_dir, max_gb);
    used >= max_gb as f64
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;

    #[test]
    fn missing_dir_is_zero() {
        let dir = std::env::temp_dir().join(format!("vod-quota-missing-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        assert_eq!(completed_used_bytes(&dir), 0);
        let (max, used, free) = storage_quota_stats(&dir, 100);
        assert_eq!(max, 100.0);
        assert_eq!(used, 0.0);
        assert_eq!(free, 100.0);
        assert!(!is_over_quota(&dir, 100));
    }

    #[test]
    fn sums_file_sizes_and_free() {
        let dir = std::env::temp_dir().join(format!("vod-quota-sum-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let mut f = fs::File::create(dir.join("a.bin")).unwrap();
        f.write_all(&[0u8; 500]).unwrap();
        drop(f);

        assert_eq!(completed_used_bytes(&dir), 500);
        let (max, used, free) = storage_quota_stats(&dir, 1);
        assert_eq!(max, 1.0);
        assert!((used - 500.0 / 1_000_000_000.0).abs() < 1e-15);
        assert!((free - (1.0 - used)).abs() < 1e-15);
        assert!(!is_over_quota(&dir, 1));
        assert!(is_over_quota(&dir, 0));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn resolve_max_defaults() {
        assert_eq!(resolve_max_storage_gb(None), 100);
        assert_eq!(resolve_max_storage_gb(Some("")), 100);
        assert_eq!(resolve_max_storage_gb(Some("0")), 100);
        assert_eq!(resolve_max_storage_gb(Some("abc")), 100);
        assert_eq!(resolve_max_storage_gb(Some("50")), 50);
    }
}
