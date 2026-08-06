import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import './CronPanel.css';
import { useDraggable } from './useDraggable';

interface CronJob {
  id: string;
  name: string;
  schedule: string;
  enabled: boolean;
  last_run: string | null;
  next_run: string | null;
  payload_text: string;
}

interface Props {
  toolId: string;
  onClose: () => void;
}

export default function CronPanel({ toolId, onClose }: Props) {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(false);
  const dragContainerRef = useRef<HTMLDivElement>(null);
  const dragHandleRef = useRef<HTMLDivElement>(null);
  useDraggable(dragHandleRef, dragContainerRef);

  useEffect(() => {
    loadJobs();
  }, [toolId]);

  const loadJobs = async () => {
    setLoading(true);
    try {
      const result = await invoke<CronJob[]>('get_cron_jobs', { toolId });
      setJobs(result);
    } catch (e: any) {
      console.error('Failed to load cron jobs:', e);
      // 如果后端命令不存在，显示空列表
      setJobs([]);
    } finally {
      setLoading(false);
    }
  };

  const toggleJob = async (jobId: string, enabled: boolean) => {
    try {
      await invoke('toggle_cron_job', { jobId, enabled: !enabled });
      setJobs(jobs.map(j => j.id === jobId ? { ...j, enabled: !enabled } : j));
    } catch (e: any) {
      console.error('Failed to toggle cron job:', e);
    }
  };

  const deleteJob = async (jobId: string) => {
    try {
      await invoke('delete_cron_job', { jobId });
      setJobs(jobs.filter(j => j.id !== jobId));
    } catch (e: any) {
      console.error('Failed to delete cron job:', e);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box cron-panel" ref={dragContainerRef} onClick={e => e.stopPropagation()}>
        <div className="modal-header drag-handle" ref={dragHandleRef} style={{ cursor: 'move' }}>
          <h3>⏰ 定时任务 — {toolId}</h3>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {loading ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text2)' }}>加载中...</div>
          ) : jobs.length === 0 ? (
            <div className="cron-empty">
              <div className="cron-empty-icon">⏰</div>
              <p>暂无定时任务</p>
              <p className="cron-empty-hint">通过各工具的命令行添加定时任务后，将在此处显示</p>
            </div>
          ) : (
            <div className="cron-list">
              {jobs.map(job => (
                <div key={job.id} className={`cron-job-item${job.enabled ? '' : ' disabled'}`}>
                  <div className="cron-job-header">
                    <span className="cron-job-name">{job.name || job.id}</span>
                    <div className="cron-job-actions">
                      <button
                        className={`btn-sm ${job.enabled ? 'btn-danger' : 'btn-success'}`}
                        onClick={() => toggleJob(job.id, job.enabled)}
                      >
                        {job.enabled ? '禁用' : '启用'}
                      </button>
                      <button className="btn-sm btn-danger" onClick={() => deleteJob(job.id)}>删除</button>
                    </div>
                  </div>
                  <div className="cron-job-schedule">📅 {job.schedule}</div>
                  <div className="cron-job-meta">
                    {job.last_run && <span>上次运行: {job.last_run}</span>}
                    {job.next_run && <span>下次运行: {job.next_run}</span>}
                  </div>
                  <div className="cron-job-payload">{job.payload_text}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
