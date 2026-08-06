import { useState } from 'react';

interface Props {
  open: boolean;
  onAgree: () => void;
  onDisagree: () => void;
  onOpenDisclaimer?: () => void;
  currentVersion: string;
}

export default function RiskNoticeModal({ open, onAgree, onDisagree, onOpenDisclaimer, currentVersion }: Props) {
  const [checked, setChecked] = useState(false);
  const [secondChecked, setSecondChecked] = useState(false);

  if (!open) return null;

  return (
    <div className="overlay" style={{ zIndex: 9999 }}>
      <div 
        className="modal-box" 
        onClick={e => e.stopPropagation()} 
        style={{ 
          width: 540, 
          maxWidth: '90vw',
          maxHeight: '85vh',
          overflowY: 'auto',
          border: '2px solid #e74c3c',
          boxShadow: '0 0 40px rgba(231, 76, 60, 0.3)'
        }}
      >
        {/* 警告图标 */}
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <div style={{ 
            fontSize: 48, 
            marginBottom: 8,
            filter: 'drop-shadow(0 0 10px rgba(231, 76, 60, 0.5))'
          }}>⚠️</div>
          <h3 style={{ 
            margin: 0, 
            color: '#e74c3c',
            fontSize: 20,
            fontWeight: 700
          }}>风险提示与使用协议</h3>
        </div>

        {/* 风险提示内容 */}
        <div style={{
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: '16px 18px',
          marginBottom: 16,
          fontSize: 13,
          lineHeight: 1.8,
          color: 'var(--text2)'
        }}>
          <div style={{ 
            fontWeight: 700, 
            color: '#e74c3c', 
            marginBottom: 12,
            fontSize: 14,
            display: 'flex',
            alignItems: 'center',
            gap: 6
          }}>
            <span>⚖️</span> 软件使用协议（EULA）
          </div>

          <div style={{ fontSize: 12, lineHeight: 2.0 }}>

            <div style={{ marginBottom: 14 }}>
              <p style={{ margin: '0 0 4px 0', fontWeight: 700, color: 'var(--text)', fontSize: 13 }}>第1条 总则</p>
              <p style={{ margin: 0, color: 'var(--text2)' }}>
                1.1 本协议是用户与 GenHub（下称"本软件"）开发者之间关于使用本软件的法律协议。
                用户安装、运行或使用本软件即视为同意本协议全部条款。
              </p>
              <p style={{ margin: 0, color: 'var(--text2)' }}>
                1.2 本软件为免费桌面工具，仅供学习与研究用途，不构成任何形式的商业服务承诺。
              </p>
            </div>

            <div style={{ marginBottom: 14 }}>
              <p style={{ margin: '0 0 4px 0', fontWeight: 700, color: 'var(--text)', fontSize: 13 }}>第2条 用户责任</p>
              <p style={{ margin: 0, color: 'var(--text2)' }}>
                2.1 用户使用本软件所产生的一切行为及后果，包括但不限于调用第三方AI服务、
                传输数据内容、操作本地系统等，均由用户自行承担全部法律责任。
              </p>
              <p style={{ margin: 0, color: 'var(--text2)' }}>
                2.2 用户对自己输入的 API Key、Token 等凭据负全部保管责任，
                因泄露导致的任何损失由用户自行承担。
              </p>
              <p style={{ margin: 0, color: 'var(--text2)' }}>
                2.3 用户不得将本软件用于任何违法或侵权用途，否则应承担由此引发的全部法律责任。
              </p>
            </div>

            <div style={{ marginBottom: 14 }}>
              <p style={{ margin: '0 0 4px 0', fontWeight: 700, color: 'var(--text)', fontSize: 13 }}>第3条 严禁行为</p>
              <div style={{ color: 'var(--text2)' }}>
                <div>3.1 使用本软件生成、传播或存储违反中国法律法规的内容；</div>
                <div>3.2 利用本软件对第三方系统进行未授权的访问、扫描或攻击；</div>
                <div>3.3 篡改、反编译、反向工程本软件安装包或二进制文件；</div>
                <div>3.4 将本软件捆绑恶意代码后重新分发；</div>
                <div>3.5 利用本软件侵犯他人知识产权、隐私权或其他合法权益。</div>
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <p style={{ margin: '0 0 4px 0', fontWeight: 700, color: 'var(--text)', fontSize: 13 }}>第4条 免责声明</p>
              <p style={{ margin: 0, color: 'var(--text2)' }}>
                4.1 本软件按"现状"提供，不提供任何明示或暗示的保证，包括但不限于适销性、
                特定用途适用性及不侵权保证。
              </p>
              <p style={{ margin: 0, color: 'var(--text2)' }}>
                4.2 开发者不承担因使用或无法使用本软件所导致的任何直接、间接、偶然、
                特殊或惩罚性损害赔偿责任。
              </p>
              <p style={{ margin: 0, color: 'var(--text2)' }}>
                4.3 第三方 AI 模型服务的内容准确性、可用性及费用由对应服务商负责，
                开发者不承担相关责任。
              </p>
              <p style={{ margin: 0, color: 'var(--text2)' }}>
                4.4 第三方技能代码、MCP 服务等未经安全审计，用户安装与运行风险自担。
              </p>
            </div>

            <div style={{ marginBottom: 14 }}>
              <p style={{ margin: '0 0 4px 0', fontWeight: 700, color: 'var(--text)', fontSize: 13 }}>第5条 隐私与数据</p>
              <p style={{ margin: 0, color: 'var(--text2)' }}>
                5.1 所有数据（包括 API Key、聊天记录、配置）默认仅存储在用户本地设备，
                开发者不会主动收集或上传。
              </p>
              <p style={{ margin: 0, color: 'var(--text2)' }}>
                5.2 本软件会在本地记录 API 调用日志（时间、工具、模型、请求量、状态码），
                用于用户自查与故障排查，不会自动上传。
              </p>
            </div>

            <div style={{ marginBottom: 14 }}>
              <p style={{ margin: '0 0 4px 0', fontWeight: 700, color: 'var(--text)', fontSize: 13 }}>第6条 第三方服务</p>
              <p style={{ margin: 0, color: 'var(--text2)' }}>
                6.1 本软件不提供任何 AI 模型服务，仅作为客户端调用用户自行配置的第三方 API。
              </p>
              <p style={{ margin: 0, color: 'var(--text2)' }}>
                6.2 若用户使用 eaKe API（中转服务），相关费用与服务质量由 eaKe API 服务方负责。
              </p>
            </div>

            <div style={{ marginBottom: 8 }}>
              <p style={{ margin: '0 0 4px 0', fontWeight: 700, color: 'var(--text)', fontSize: 13 }}>第7条 其他</p>
              <p style={{ margin: 0, color: 'var(--text2)' }}>
                7.1 开发者保留随时修改本协议的权利，重大变更将通过软件更新通知用户。
              </p>
              <p style={{ margin: 0, color: 'var(--text2)' }}>
                7.2 本协议解释与适用以中华人民共和国法律为准据法。
              </p>
            </div>

          </div>
        </div>

        {/* 勾选框 */}
        <div style={{ 
          marginBottom: 10, 
          display: 'flex', 
          alignItems: 'flex-start', 
          gap: 8,
          padding: '10px 12px',
          background: 'var(--bg)',
          borderRadius: 6,
          border: '1px solid var(--border)'
        }}>
          <input
            type="checkbox"
            id="risk-agree"
            checked={checked}
            onChange={e => setChecked(e.target.checked)}
            style={{ width: 16, height: 16, cursor: 'pointer', marginTop: 2 }}
          />
          <label htmlFor="risk-agree" style={{ fontSize: 12, cursor: 'pointer', color: 'var(--text)', lineHeight: 1.5 }}>
            我已阅读并理解上述法律声明与风险提示，自愿承担使用本软件的一切责任
          </label>
        </div>

        <div style={{ 
          marginBottom: 16, 
          display: 'flex', 
          alignItems: 'flex-start', 
          gap: 8,
          padding: '10px 12px',
          background: 'var(--bg)',
          borderRadius: 6,
          border: '1px solid var(--border)'
        }}>
          <input
            type="checkbox"
            id="risk-law"
            checked={secondChecked}
            onChange={e => setSecondChecked(e.target.checked)}
            style={{ width: 16, height: 16, cursor: 'pointer', marginTop: 2 }}
          />
          <label htmlFor="risk-law" style={{ fontSize: 12, cursor: 'pointer', color: 'var(--text)', lineHeight: 1.5 }}>
            本人承诺：不会将本软件用于任何违法或侵权用途，否则承担全部法律责任
          </label>
        </div>

        {/* 按钮区 */}
        <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
          <button
            onClick={onDisagree}
            style={{
              flex: 1,
              padding: '12px 16px',
              fontSize: 14,
              fontWeight: 600,
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'var(--bg)',
              color: 'var(--text2)',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'var(--card)';
              e.currentTarget.style.borderColor = '#e74c3c';
              e.currentTarget.style.color = '#e74c3c';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'var(--bg)';
              e.currentTarget.style.borderColor = 'var(--border)';
              e.currentTarget.style.color = 'var(--text2)';
            }}
          >
            ✖ 不同意并退出
          </button>
          <button
            onClick={onAgree}
            disabled={!(checked && secondChecked)}
            style={{
              flex: 1,
              padding: '12px 16px',
              fontSize: 14,
              fontWeight: 600,
              borderRadius: 6,
              border: 'none',
              background: (checked && secondChecked) ? 'var(--accent)' : 'var(--card)',
              color: (checked && secondChecked) ? '#fff' : 'var(--text-dim)',
              cursor: (checked && secondChecked) ? 'pointer' : 'not-allowed',
              transition: 'all 0.2s',
              opacity: (checked && secondChecked) ? 1 : 0.5
            }}
          >
            ✔ 同意上述协议
          </button>
        </div>

        {/* 底部提示 */}
        <div style={{ 
          marginTop: 16, 
          textAlign: 'center', 
          fontSize: 11, 
          color: 'var(--text-dim)',
          lineHeight: 1.8
        }}>
          <div>版本 {currentVersion} · 更新日期 2026-07-13</div>
          <div>亚蓝信息技术有限公司</div>
        </div>
      </div>
    </div>
  );
}
