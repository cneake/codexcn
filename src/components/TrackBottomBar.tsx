import React, { useState, useEffect } from 'react';

interface TrackBottomBarProps {
  sidebarCollapsed: boolean;
  isUpdateAvailable: boolean;
  authVersion: number;
  onOpenAccount: () => void;
  onOpenUpdate: () => void;
  currentVersion: string;
  shortcutsOpen: boolean;
  setShortcutsOpen: (v: boolean) => void;
}

export default function TrackBottomBar({
  sidebarCollapsed,
  isUpdateAvailable,
  authVersion,
  onOpenAccount,
  onOpenUpdate,
  currentVersion,
  shortcutsOpen,
  setShortcutsOpen,
}: TrackBottomBarProps) {
  const [userData, setUserData] = useState<{username: string|null; avatar: string|null}>({username: null, avatar: null});

  useEffect(() => {
    setUserData({
      username: localStorage.getItem('genhub_username'),
      avatar: localStorage.getItem('genhub_avatar_url'),
    });
  }, [authVersion]);

  const storedUser = userData.username;
  const [imgError, setImgError] = useState(false);
  const isCollapsed = sidebarCollapsed;
  const userInitial = storedUser ? storedUser.charAt(0).toUpperCase() : '?';

  return (
    <>
      <div style={{ background: 'transparent', padding: '8px 0', flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        {storedUser ? (
          <div className="track-user" onClick={onOpenAccount} title={`${storedUser} - 点击管理账户`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: isCollapsed ? 0 : 8, padding: isCollapsed ? '4px 0' : '4px 8px', cursor: 'pointer', borderRadius: 8, transition: 'all 0.2s', marginBottom: 6 }}>
            <div style={{ width: isCollapsed ? 24 : 28, height: isCollapsed ? 24 : 28, borderRadius: '50%', background: 'linear-gradient(135deg, #00f0ff, #a855f7)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: isCollapsed ? 10 : 12, fontWeight: 700, color: '#fff' }}>
              {userInitial}
            </div>
            {!isCollapsed && <span style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 90 }}>{storedUser}</span>}
          </div>
        ) : (
          <div className="track-user" onClick={onOpenAccount} title="点击登录" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: isCollapsed ? 0 : 8, padding: isCollapsed ? '4px 0' : '4px 8px', cursor: 'pointer', borderRadius: 8, transition: 'all 0.2s', marginBottom: 6 }}>
            <div style={{ width: isCollapsed ? 24 : 28, height: isCollapsed ? 24 : 28, borderRadius: '50%', background: 'var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: isCollapsed ? 10 : 12, fontWeight: 700, color: 'var(--text3)' }}>
              ?
            </div>
            {!isCollapsed && <span style={{ fontSize: 13, color: 'var(--text3)', fontWeight: 500 }}>未登录</span>}
          </div>
        )}
        <div className="track-version" onClick={onOpenUpdate} title="查看更新日志" style={{position:'relative', fontSize: 10, color: 'var(--text3)', cursor: 'pointer', opacity: 0.6}}>{currentVersion}{isUpdateAvailable && (<span style={{position:'absolute',top:-2,right:-8,width:8,height:8,borderRadius:'50%',background:'#f87171'}} />)}</div>
      </div>
    </>
  );
}
