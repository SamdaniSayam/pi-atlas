//! Async job registry: scans run on blocking threads; clients poll for
//! status and can cancel. Every job is bounded by a deadline and removed
//! after completion (TTL) or explicit DELETE.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum JobStatus {
    Running,
    Done,
    Cancelled,
    Failed,
    Timeout,
}

pub struct JobState {
    pub id: u64,
    pub kind: String,
    pub status: Mutex<JobStatus>,
    /// (checked, total) progress, if the scan reports it.
    pub progress: Mutex<Option<(u64, u64)>>,
    pub result: Mutex<Option<serde_json::Value>>,
    pub error: Mutex<Option<serde_json::Value>>,
    pub cancel: AtomicBool,
    pub created: Instant,
    pub completed: Mutex<Option<Instant>>,
}

impl JobState {
    fn new(id: u64, kind: &str) -> Self {
        JobState {
            id,
            kind: kind.to_string(),
            status: Mutex::new(JobStatus::Running),
            progress: Mutex::new(None),
            result: Mutex::new(None),
            error: Mutex::new(None),
            cancel: AtomicBool::new(false),
            created: Instant::now(),
            completed: Mutex::new(None),
        }
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancel.load(Ordering::Relaxed)
    }

    pub fn snapshot(&self) -> serde_json::Value {
        let status = *self.status.lock().unwrap();
        let progress = *self.progress.lock().unwrap();
        let result = self.result.lock().unwrap().clone();
        let error = self.error.lock().unwrap().clone();
        let completed = self.completed.lock().unwrap();
        serde_json::json!({
            "id": self.id,
            "kind": self.kind,
            "status": status,
            "progress": progress.map(|(checked, total)| serde_json::json!({
                "checked": checked,
                "total": total,
            })),
            "result": result,
            "error": error,
            "elapsed_ms": self.created.elapsed().as_secs_f64() * 1000.0,
        })
    }

    pub fn finish(&self, status: JobStatus, result: Option<serde_json::Value>, error: Option<serde_json::Value>) {
        *self.status.lock().unwrap() = status;
        *self.result.lock().unwrap() = result;
        *self.error.lock().unwrap() = error;
        *self.completed.lock().unwrap() = Some(Instant::now());
    }
}

pub struct JobRegistry {
    jobs: Mutex<HashMap<u64, Arc<JobState>>>,
    next_id: AtomicU64,
    /// Terminal jobs older than this are evicted.
    ttl: Duration,
}

impl JobRegistry {
    pub fn new(ttl: Duration) -> Self {
        JobRegistry {
            jobs: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
            ttl,
        }
    }

    pub fn create(&self, kind: &str) -> Arc<JobState> {
        self.evict_expired();
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let job = Arc::new(JobState::new(id, kind));
        self.jobs.lock().unwrap().insert(id, Arc::clone(&job));
        job
    }

    pub fn get(&self, id: u64) -> Option<Arc<JobState>> {
        self.jobs.lock().unwrap().get(&id).cloned()
    }

    /// Number of jobs currently Running (queued permits included).
    pub fn active_count(&self) -> u64 {
        self.jobs
            .lock()
            .unwrap()
            .values()
            .filter(|j| *j.status.lock().unwrap() == JobStatus::Running)
            .count() as u64
    }

    pub fn remove(&self, id: u64) -> bool {
        self.jobs.lock().unwrap().remove(&id).is_some()
    }

    fn evict_expired(&self) {
        let ttl = self.ttl;
        let mut jobs = self.jobs.lock().unwrap();
        jobs.retain(|_, job| {
            let status = *job.status.lock().unwrap();
            if status == JobStatus::Running {
                return true;
            }
            let done_at = *job.completed.lock().unwrap();
            match done_at {
                Some(t) => t.elapsed() < ttl,
                None => true,
            }
        });
    }
}
