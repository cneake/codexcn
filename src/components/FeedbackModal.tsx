import React, { useState } from 'react';
import { createPortal } from 'react-dom';

interface FeedbackModalProps {
  onClose: () => void;
}

export default function FeedbackModal({ onClose }: FeedbackModalProps) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [contact, setContact] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ok: boolean, msg: string} | null>(null);

  const handleSubmit = async () => {
    if (!content.trim()) { setResult({ok:false, msg:'请填写反馈内容'}); return; }
    setSubmitting(true);
    try {
      const res = await fetch('https://agent.eake.cn/wp-json/wp/v2/comments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Basic ' + btoa('eakecn:qjag 2LCM BB9r OTQz qPjj tDV2'),
        },
        body: JSON.stringify({
          post: 2177,
          author_name: 'GenHub 用户',
          author_email: contact || 'noreply@genhub.app',
          content: `${title ? `【${title}】\n\n` : ''}${content}`,
        }),
      });
      if (res.ok) {
        setResult({ ok: true, msg: '感谢反馈!' });
        setTitle(''); setContent(''); setContact('');
      } else {
        const err = await res.json().catch(() => null);
        setResult({ ok: false, msg: `提交失败: ${err?.message || res.statusText}` });
      }
    } catch (e: any) {
      setResult({ ok: false, msg: '网络错误,请检查连接' });
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div className="overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()} style={{maxWidth:480}}>
        <h3>💬 反馈</h3>
        {result && (
          <div style={{
            padding:'8px 12px', borderRadius:6, marginBottom:12, fontSize:13,
            background: result.ok ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
            color: result.ok ? '#10b981' : '#ef4444'
          }}>
            {result.msg}
          </div>
        )}
        <div style={{marginBottom:12}}>
          <div style={{fontSize:12, color:'var(--text2)', marginBottom:4}}>标题(可选)</div>
          <input value={title} onChange={e => setTitle(e.target.value)}
            style={{
              padding:'8px 10px', borderRadius:6, border:'1px solid var(--border)',
              background:'var(--card)', color:'var(--text)', fontSize:13, width:'100%'
            }} placeholder="简要描述" />
        </div>
        <div style={{marginBottom:12}}>
          <div style={{fontSize:12, color:'var(--text2)', marginBottom:4}}>内容 *</div>
          <textarea value={content} onChange={e => setContent(e.target.value)}
            style={{
              padding:'8px 10px', borderRadius:6, border:'1px solid var(--border)',
              background:'var(--card)', color:'var(--text)', fontSize:13, width:'100%',
              minHeight:120, resize:'vertical', fontFamily:'inherit'
            }} placeholder="请详细描述您的问题或建议..." />
        </div>
        <div style={{marginBottom:16}}>
          <div style={{fontSize:12, color:'var(--text2)', marginBottom:4}}>联系方式(可选)</div>
          <input value={contact} onChange={e => setContact(e.target.value)}
            style={{
              padding:'8px 10px', borderRadius:6, border:'1px solid var(--border)',
              background:'var(--card)', color:'var(--text)', fontSize:13, width:'100%'
            }} placeholder="邮箱/微信(方便我们联系您)" />
        </div>
        <div className="modal-btns">
          <button className="btn-sm" onClick={onClose}>取消</button>
          <button className="btn-accent" onClick={handleSubmit} disabled={submitting || !content.trim()}>
            {submitting ? '提交中...' : '提交反馈'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
