//! Minimal TTL + capacity cache for completed search results.

use std::collections::HashMap;
use std::time::{Duration, Instant};

pub struct TtlCache {
    entries: HashMap<String, (Instant, serde_json::Value)>,
    capacity: usize,
    ttl: Duration,
}

impl TtlCache {
    pub fn new(capacity: usize, ttl: Duration) -> Self {
        TtlCache { entries: HashMap::new(), capacity, ttl }
    }

    pub fn get(&self, key: &str) -> Option<serde_json::Value> {
        match self.entries.get(key) {
            Some((inserted, value)) if inserted.elapsed() < self.ttl => Some(value.clone()),
            _ => None,
        }
    }

    pub fn insert(&mut self, key: String, value: serde_json::Value) {
        if self.entries.len() >= self.capacity {
            self.evict_oldest();
        }
        self.entries.insert(key, (Instant::now(), value));
    }

    fn evict_oldest(&mut self) {
        if let Some(key) = self
            .entries
            .iter()
            .min_by_key(|(_, (t, _))| *t)
            .map(|(k, _)| k.clone())
        {
            self.entries.remove(&key);
        }
    }
}
