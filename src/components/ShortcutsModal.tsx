import React from 'react';

interface ShortcutsModalProps {
  shortcutsOpen: boolean;
  setShortcutsOpen: (v: boolean) => void;
}

export default function ShortcutsModal({ shortcutsOpen, setShortcutsOpen }: ShortcutsModalProps) {
  if (!shortcutsOpen) return null;
  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.6)', zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={(e) => { if (e.target === e.currentTarget) setShortcutsOpen(false); }}>
      <div style={{
        background: 'var(--bg2)', border: '1px solid var(--border)',
        borderRadius: 12, padding: 24, minWidth: 360, maxWidth: 480,
        color: 'var(--text)', fontSize: 13,
      }}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
          <span style={{fontSize:15,fontWeight:600}}>键盘快捷键</span>
          <button onClick={() => setShortcutsOpen(false)} style={{background:'none',border:'none',color:'var(--text3)',cursor:'pointer',fontSize:18}}>×</button>
        </div>
        {[
          ['Ctrl + /', '打开/关闭此弹窗'],
          ['Ctrl + Enter', '发送消息'],
          ['Ctrl + N', '新建会话'],
          ['Ctrl + W', '返回聊天'],
          ['Escape', '关闭弹窗'],
        ].map(([key, desc]) => (
          <div key={key} style={{display:'flex',justifyContent:'space-between',padding:'8px 0',borderBottom:'1px solid var(--border)'}}>
            <kbd style={{background:'var(--bg)',padding:'2px 8px',borderRadius:4,fontSize:12,fontFamily:'monospace',border:'1px solid var(--border)'}}>{key}</kbd>
            <span style={{color:'var(--text2)'}}>{desc}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
