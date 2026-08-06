import React, { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

interface WeixinAccount {
  account_id: string;
  bot_token: string;
  base_url: string;
  user_id: string;
  created_at: string;
}

interface InboundMessage {
  from_user_id: string;
  text: string;
  message_id: string;
  context_token?: string;
}

interface WeChatPanelProps {
  theme: string;
}

const WeChatPanel: React.FC<WeChatPanelProps> = ({ theme }) => {
  const [connectedAccounts, setConnectedAccounts] = useState<WeixinAccount[]>([]);
  const [messages, setMessages] = useState<InboundMessage[]>([]);
  const [loginState, setLoginState] = useState<'idle' | 'qr' | 'polling' | 'connected' | 'error'>('idle');
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [sessionKey, setSessionKey] = useState('');
  const [statusMsg, setStatusMsg] = useState('Ready');
  const [verifyCode, setVerifyCode] = useState('');
  const [needVerify, setNeedVerify] = useState(false);
  const pollRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => { scrollToBottom(); }, [messages]);

  // Restore saved accounts on mount
  useEffect(() => {
    (async () => {
      try {
        const accounts: WeixinAccount[] = await invoke('wechat_restore_accounts');
        setConnectedAccounts(accounts);
        if (accounts.length > 0) {
          setLoginState('connected');
          setStatusMsg('已连接');
        }
      } catch (e) {
        console.error('Restore accounts failed:', e);
      }
    })();
  }, []);

  // Start polling for messages when connected
  const startMessagePoll = useCallback((accountId: string) => {
    pollRef.current = true;
    const poll = async () => {
      while (pollRef.current) {
        try {
          const msgs: InboundMessage[] = await invoke('wechat_poll_messages', { account_id: accountId });
          if (msgs.length > 0) {
            setMessages(prev => [...prev, ...msgs]);
          }
        } catch (e) {
          console.error('Poll error:', e);
          // retry after error
          await new Promise(r => setTimeout(r, 3000));
        }
        // Small delay between polls
        await new Promise(r => setTimeout(r, 500));
      }
    };
    poll();
  }, []);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => { pollRef.current = false; };
  }, []);

  // Listen for inbound messages from Tauri events
  useEffect(() => {
    const unlisten = listen<InboundMessage[]>('wechat-inbound-messages', (event) => {
      setMessages(prev => [...prev, ...event.payload]);
    });
    return () => { unlisten.then(fn => fn()); };
  }, []);

  const handleStartLogin = async () => {
    console.log('[WeChat] 扫描二维码 clicked');
    setStatusMsg('正在连接微信服务器...');
    const key = `qr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    setSessionKey(key);
    setLoginState('qr');
    setNeedVerify(false);
    setVerifyCode('');

    try {
      console.log('[WeChat] invoking wechatStartQr, key:', key);
      const result: { success: boolean; qrcode_url?: string; message: string } = await invoke('wechat_start_qr', { sessionKey: key });
      console.log('[WeChat] wechatStartQr result:', JSON.stringify(result));
      if (result.success && result.qrcode_url) {
        setQrUrl(result.qrcode_url);
        setStatusMsg(result.message);
        pollQrStatus(key);
      } else {
        setStatusMsg(`错误：${result.message || '获取二维码失败'}`);
        setLoginState('error');
      }
    } catch (e) {
      console.error('[WeChat] invoke error:', e);
      setStatusMsg(`连接失败：${e}`);
      setLoginState('error');
    }
  };

  const pollQrStatus = async (key: string) => {
    setLoginState('polling');
    let pollCount = 0;
    const maxPolls = 60; // 60 * 40s = 40 minutes max

    const poll = async () => {
      while (pollCount < maxPolls) {
        pollCount++;
        try {
          const result: { connected: boolean; message: string; account_id?: string; bot_token?: string; base_url?: string; user_id?: string } = await invoke('wechat_poll_qr', { sessionKey: key });

          setStatusMsg(result.message);

          if (result.message === 'need_verifycode') {
            setNeedVerify(true);
            return; // Wait for user to input verify code
          }

          if (result.connected) {
            setLoginState('connected');
            setConnectedAccounts(prev => [...prev, {
              account_id: result.account_id!,
              bot_token: result.bot_token!,
              base_url: result.base_url!,
              user_id: result.user_id!,
              created_at: new Date().getTime().toString(),
            }]);
            // Start message polling
            if (result.account_id) {
              startMessagePoll(result.account_id);
            }
            return;
          }

          if (result.message.includes('expired')) {
            setLoginState('idle');
            return;
          }

          // Still waiting, poll again
          await new Promise(r => setTimeout(r, 3000));
        } catch (e) {
          console.error('QR poll error:', e);
          await new Promise(r => setTimeout(r, 3000));
        }
      }
      setLoginState('idle');
      setStatusMsg('Login timeout');
    };
    poll();
  };

  const handleSubmitVerifyCode = async () => {
    if (!verifyCode.trim()) return;
    try {
      await invoke('wechat_submit_verify_code', { sessionKey: sessionKey, code: verifyCode.trim() });
      setNeedVerify(false);
      setVerifyCode('');
      setStatusMsg('验证码已提交，正在确认...');
      // Resume polling
      pollQrStatus(sessionKey);
    } catch (e) {
      setStatusMsg(`验证码错误：${e}`);
    }
  };

  const handle取消Login = async () => {
    pollRef.current = false;
    try {
      await invoke('wechat_cancel_qr', { sessionKey: sessionKey });
    } catch (e) { /* ignore */ }
    setLoginState('idle');
    setQrUrl(null);
    setStatusMsg('登录已取消');
  };

  const handle断开连接 = async (accountId: string) => {
    pollRef.current = false;
    try {
      await invoke('wechat_disconnect', { account_id: accountId });
      setConnectedAccounts(prev => prev.filter(a => a.account_id !== accountId));
      if (connectedAccounts.length <= 1) {
        setLoginState('idle');
        setStatusMsg('已断开连接');
      }
    } catch (e) {
      setStatusMsg(`断开连接错误：${e}`);
    }
  };

  return (
    <div className={`wechat-panel ${theme === 'light' ? 'wechat-light' : 'wechat-dark'}`}>
      <div className="wechat-header">
        <h3>微信</h3>
        {connectedAccounts.length > 0 && (
          <span className="wechat-status-badge connected">已连接 ({connectedAccounts.length})</span>
        )}
      </div>

      <div className="wechat-body">
        {/* Login Section */}
        {loginState === 'idle' && (
          <div className="wechat-login-section">
            <div className="wechat-login-icon">
              <svg width="56" height="56" viewBox="0 0 1024 1024" fill="#07C160">
                <path d="M690.1 377.4c5.9 0 11.8.2 17.6.5-24.4-128.7-158.3-227.1-319.9-227.1C209 150.8 64 271.4 64 420.2c0 81.1 43.6 154.2 111.9 203.6 5.5 3.9 9.1 10.3 9.1 17.6 0 2.4-.5 4.6-1.1 6.9-5.5 20.3-14.2 52.8-14.6 54.3-.7 2.6-2 5.2-2 7.9 0 5.9 4.8 10.8 10.8 10.8 2.3 0 4.5-.7 6.3-2l70.9-40.9c5.3-3.1 11-5 16.9-5 3.2 0 6.4.5 9.5 1.6 25.2 7.4 52.3 11.5 80.7 11.5 6.2 0 12.3-.2 18.4-.6-4.3-15.6-6.6-32-6.6-48.9 0-97.6 77.3-176.6 172.8-176.6z"/>
                <path d="M876.7 600.4c55.4-39.3 89.3-94.3 89.3-155.2 0-114.2-115.2-206.8-257.4-206.8S451.2 331 451.2 445.2s115.2 206.8 257.4 206.8c23.5 0 46.2-3.2 67.6-9 2.4-.7 4.9-1.1 7.4-1.1 4.7 0 9.3 1.3 13.2 3.8l55.2 31.8c1.5.9 3.2 1.4 4.9 1.4 4.1 0 7.5-3.4 7.5-7.5 0-1.9-.8-3.8-1.5-5.6-3.1-9.5-7.8-26.3-11.1-38.2-.5-1.7-.9-3.5-.9-5.3 0-5.9 2.9-11.3 7.4-14.5z"/>
                <circle cx="296" cy="368" r="48" fill="#07C160"/>
                <circle cx="692" cy="444" r="42" fill="#07C160"/>
                <circle cx="852" cy="444" r="42" fill="#07C160"/>
              </svg>
            </div>
            <p className="wechat-desc">使用微信扫码绑定，通过微信发送指令调用工具</p>
            <button className="wechat-btn wechat-btn-primary" onClick={handleStartLogin}>
              扫描二维码
            </button>
          </div>
        )}

        {/* Error State - 弹窗样式 */}
        {loginState === 'error' && (
          <div className="wechat-error-modal">
            <div className="wechat-error-modal-content">
              <div className="wechat-error-icon">⚠️</div>
              <p className="wechat-error-msg">{statusMsg}</p>
              <div className="wechat-error-actions">
                <button className="wechat-btn wechat-btn-primary" onClick={handleStartLogin}>重试</button>
              </div>
            </div>
          </div>
        )}

        {/* QR Code Display */}
        {(loginState === 'qr' || loginState === 'polling') && (
          <div className="wechat-qr-section">
            {qrUrl && (
              <div className="wechat-qr-container">
                {qrUrl.startsWith('data:image/svg+xml;base64,') || qrUrl.startsWith('data:image/png;base64,') || qrUrl.startsWith('http') ? (
                  <img
                    src={qrUrl}
                    alt="微信二维码"
                    className="wechat-qr-img"
                    onError={(e) => {
                      console.error('[WeChat] QR img load failed, src:', (e.target as HTMLImageElement).src);
                      ((e.target as HTMLImageElement).parentElement as HTMLElement).innerHTML = '<p style="color:#ff5252;font-size:12px">二维码加载失败，请重试</p>';
                    }}
                  />
                ) : (
                  <p style={{color:'var(--text-secondary)',fontSize:12}}>二维码数据异常（{qrUrl.slice(0,20)}...）</p>
                )}
              </div>
            )}
            <p className="wechat-status">{statusMsg}</p>

            {needVerify && (
              <div className="wechat-verify">
                <input
                  type="text"
                  value={verifyCode}
                  onChange={e => setVerifyCode(e.target.value)}
                  placeholder="输入验证码"
                  className="wechat-verify-input"
                />
                <button className="wechat-btn" onClick={handleSubmitVerifyCode}>提交</button>
              </div>
            )}

            <button className="wechat-btn wechat-btn-secondary" onClick={handle取消Login}>
              取消
            </button>
          </div>
        )}

        {/* Connected State */}
        {loginState === 'connected' && (
          <>
            {/* Account List */}
            <div className="wechat-accounts">
              {connectedAccounts.map(acc => (
                <div key={acc.account_id} className="wechat-account-item">
                  <div className="wechat-account-info">
                    <span className="wechat-account-id">{acc.account_id.slice(0, 12)}...</span>
                    <span className="wechat-account-user">User: {acc.user_id}</span>
                  </div>
                  <button
                    className="wechat-btn wechat-btn-danger"
                    onClick={() => handle断开连接(acc.account_id)}
                  >
                    断开连接
                  </button>
                </div>
              ))}
            </div>

            {/* Message List */}
            <div className="wechat-messages">
              <div className="wechat-messages-header">
                <span>消息列表</span>
                <span className="wechat-msg-count">{messages.length}</span>
              </div>
              <div className="wechat-messages-list">
                {messages.length === 0 ? (
                  <div className="wechat-no-messages">
                    暂无消息。在微信中向机器人发送消息。
                  </div>
                ) : (
                  messages.map((msg, i) => (
                    <div key={msg.message_id + i} className="wechat-message-item inbound">
                      <div className="wechat-message-header">
                        <span className="wechat-message-from">{msg.from_user_id}</span>
                      </div>
                      <div className="wechat-message-text">{msg.text}</div>
                    </div>
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default WeChatPanel;
