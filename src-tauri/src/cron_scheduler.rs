use crate::db::{CronJob, Database};
use chrono::{DateTime, Local, Utc};
use cron::Schedule;
use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::OnceLock;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tokio::time::sleep;

/// 调度器状态
pub struct CronScheduler {
    jobs: Arc<Mutex<HashMap<String, tauri::async_runtime::JoinHandle<()>>>>,
    db: Arc<Mutex<Database>>,
}

impl CronScheduler {
    pub fn new(db: Arc<Mutex<Database>>) -> Self {
        Self {
            jobs: Arc::new(Mutex::new(HashMap::new())),
            db,
        }
    }

    /// 启动所有已启用的任务
    pub async fn start_all(&self, app: AppHandle) {
        // 收集所有工具的任务
        let tool_ids = [
            "claude-code", "codex", "gemini-cli", "opencode",
            "openclaw", "hermes-agent", "qoder-cli", "deepseek-cli",
            "claude-desktop", "grok-build",
        ];
        let mut all_jobs = Vec::new();
        for tid in &tool_ids {
            match self.db.lock().get_cron_jobs(tid) {
                Ok(jobs) => {
                    let enabled_jobs: Vec<_> = jobs.into_iter().filter(|j| j.enabled).collect();
                    log::info!("[CronScheduler] Tool '{}' has {} enabled jobs", tid, enabled_jobs.len());
                    all_jobs.extend(enabled_jobs);
                }
                Err(e) => {
                    log::error!("[CronScheduler] Failed to get jobs for tool '{}': {}", tid, e);
                }
            }
        }

        let job_count = all_jobs.len();
        for job in all_jobs {
            self.start_job(job, app.clone());
        }
        log::info!("[CronScheduler] Loaded {} jobs from DB", job_count);
    }

    /// 启动单个任务
    pub fn start_job(&self, job: CronJob, app: AppHandle) {
        if !job.enabled {
            return;
        }

        let job_id = job.id.clone();
        let job_id_for_log = job_id.clone();
        let expr = job.cron_expr.clone();
        let message = job.message.clone();
        let tool_id = job.tool_id.clone();
        let db = self.db.clone();

        // 解析 cron 表达式（cron crate 需要 6 字段：秒 分 时 日 月 周）
        // 标准 Unix 5 字段格式 → 前面补 "0 "
        let expr_with_sec = if expr.split_whitespace().count() == 5 {
            format!("0 {}", expr)
        } else {
            expr.clone()
        };
        eprintln!("[CronScheduler] Parsing cron: '{}' (normalized: '{}')", expr, expr_with_sec);
        let schedule: Schedule = match expr_with_sec.parse() {
            Ok(s) => s,
            Err(e) => {
                log::error!("[CronScheduler] Invalid cron expr '{}': {}", expr, e);
                return;
            }
        };

        // 停止旧任务（如果有）
        self.stop_job(&job_id);

        let job_id_for_insert = job_id.clone();
        let handle = tauri::async_runtime::spawn(async move {
            loop {
                // 计算下次运行时间（使用本地时间）
                let now = Local::now();
                let next = schedule.after(&now).next();

                if let Some(next_time) = next {
                    let delay = next_time - now;
                    let delay_secs = delay.num_seconds().max(0) as u64;

                    log::info!("[CronScheduler] Firing: job={} tool={} msg={} at {}", job_id_for_log, tool_id, message, Local::now().with_timezone(&Local).format("%H:%M:%S"));

                    // 更新 next_run（转换为 UTC timestamp 存储）
                    let _ = db.lock().update_cron_job_next_run(&job_id, next_time.with_timezone(&Utc).timestamp());

                    // 等待
                    sleep(Duration::from_secs(delay_secs)).await;

                    // 执行
                    log::info!(
                        "[CronScheduler] Firing job '{}' for tool '{}': {} (local time: {})",
                        job_id_for_log,
                        tool_id,
                        message,
                        Local::now().format("%Y-%m-%d %H:%M:%S")
                    );

                    let log_msg = format!("[CronScheduler] Firing: job={} tool={} msg={} at {}", job_id_for_log, tool_id, message, Local::now().with_timezone(&Local).format("%H:%M:%S"));
                    let _ = app.emit(
                        "cron_trigger",
                        serde_json::json!({
                            "job_id": job_id_for_log,
                            "tool_id": tool_id,
                            "message": message,
                            "log": log_msg,
                        }),
                    );

                    // 更新 last_run
                    let now_ts = Utc::now().timestamp();
                    let _ = db.lock().update_cron_job_last_run(&job_id, now_ts);
                } else {
                    log::error!("[CronScheduler] No next time for job '{}'", job_id_for_log);
                    break;
                }
            }
        });

        self.jobs.lock().insert(job_id_for_insert.clone(), handle);
    }

    /// 停止单个任务
    pub fn stop_job(&self, job_id: &str) {
        if let Some(handle) = self.jobs.lock().remove(job_id) {
            handle.abort();
            log::info!("[CronScheduler] Stopped job '{}'", job_id);
        }
    }

    /// 重启任务（修改后调用）
    pub fn restart_job(&self, job: CronJob, app: AppHandle) {
        self.stop_job(&job.id);
        self.start_job(job, app);
    }

    /// 获取调度器状态
    pub fn get_status(&self) -> String {
        let count = self.jobs.lock().len();
        log::info!("[CronScheduler] get_status: {} active jobs", count);
        format!("Scheduler running with {} active jobs", count)
    }
}

/// 全局调度器实例（线程安全，无需 unsafe）
static SCHEDULER: OnceLock<Mutex<Option<Arc<CronScheduler>>>> = OnceLock::new();

/// 初始化调度器
pub fn init_scheduler(db: Arc<Mutex<Database>>) -> Arc<CronScheduler> {
    let scheduler = Arc::new(CronScheduler::new(db));
    let _ = SCHEDULER.set(Mutex::new(Some(scheduler.clone())));
    scheduler
}

/// 获取调度器（线程安全）
pub fn get_scheduler() -> Option<Arc<CronScheduler>> {
    SCHEDULER.get()?.lock().clone()
}
