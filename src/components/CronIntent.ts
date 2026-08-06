/* ── 中文自然语言 → cron 表达式 ─────────────────────────
 * 支持以下表达：
 *   每分钟 / 每5分钟 / 每10分钟 / 每半小时
 *   每小时 / 每2小时
 *   每天 / 每天早上9点 / 每天18点 / 每天晚上8点半
 *   每周一 / 每周一9点 / 每周二下午3点
 *   工作日 9点 / 周末 早上10点
 *   每月1号 / 每月15号 上午8点
 *
 * 命中即返回 cron；不命中返回 null（让 LLM 兜底）。
 */
export interface CronParseResult {
  cron: string;
  humanReadable: string;
  confidence: number;
}

const CN_DIGITS: Record<string, number> = {
  '零': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
  '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
};

function cnToNum(s: string): number {
  const arabic = s.match(/\d+/g);
  if (arabic) return parseInt(arabic[0]);
  if (s.includes('十')) {
    const parts = s.split('十');
    const left = parts[0] ? CN_DIGITS[parts[0]] || 1 : 1;
    const right = parts[1] ? CN_DIGITS[parts[1]] || 0 : 0;
    return left * 10 + right;
  }
  return CN_DIGITS[s] || NaN;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** 解析中文时间短语为 cron 表达式 */
export function parseChineseTime(text: string): CronParseResult | null {
  const t = text.trim();

  // 纯数字时间格式：2200、22:00、9:30、08:00 等（前面无中文时间词时）
  const numTimeMatch = t.match(/\b(\d{1,2}):?(\d{2})\b/);
  if (numTimeMatch) {
    let hour = parseInt(numTimeMatch[1]);
    let minute = parseInt(numTimeMatch[2]);
    // 智能推断：2200 这种 4 位数通常是 24 小时制
    if (!t.includes(':') && numTimeMatch[0].length === 4) {
      hour = parseInt(numTimeMatch[0].substring(0, 2));
      minute = parseInt(numTimeMatch[0].substring(2, 4));
    }
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      // 如果有"每天/每周"等词，用那些规则；否则默认"每天"
      const hasDaily = /每天|每日|天天/.test(t);
      const hasWeekly = /每周|每星期/.test(t);
      if (!hasDaily && !hasWeekly) {
        return {
          cron: `${minute} ${hour} * * *`,
          humanReadable: `每天 ${pad(hour)}:${pad(minute)}`,
          confidence: 0.85,
        };
      }
    }
  }

  // 每N分钟
  let m = t.match(/每(\d+|[一二三四五六七八九]+)分钟/);
  if (m) {
    const n = parseInt(m[1]) || cnToNum(m[1]) || 1;
    if (n >= 1 && n <= 59) return { cron: `*/${n} * * * *`, humanReadable: `每${n}分钟`, confidence: 0.95 };
  }
  if (/每半小时|每30分钟/.test(t)) return { cron: '*/30 * * * *', humanReadable: '每半小时', confidence: 0.95 };

  // 每N小时
  m = t.match(/每(\d+|[一二三四五六七八九]+)小时/);
  if (m) {
    const n = parseInt(m[1]) || cnToNum(m[1]) || 1;
    if (n >= 1 && n <= 23) return { cron: `0 */${n} * * *`, humanReadable: `每${n}小时`, confidence: 0.95 };
  }
  if (/每小时/.test(t)) return { cron: '0 * * * *', humanReadable: '每小时整点', confidence: 0.95 };

  // 每天 HH:MM
  m = t.match(/(?:每天|每日|天天)?\s*(早上|上午|早晨|凌晨|中午|下午|晚上|傍晚|夜里)?\s*(\d{1,2})(?:[:点](\d{1,2}|半|[一二三四五六七八九])?分?)?(半点|一刻|三刻)?/);
  if (m && (t.includes('每天') || t.includes('每日') || t.includes('天天') || t.includes('早上') || t.includes('上午') || t.includes('中午') || t.includes('下午') || t.includes('晚上') || t.includes('傍晚') || t.includes('夜里') || t.includes('凌晨'))) {
    const ampm = m[1] || '';
    let hour = parseInt(m[2]);
    let minute = 0;
    if (m[4] === '半点' || m[4] === '30') minute = 30;
    else if (m[4] === '一刻' || m[4] === '15') minute = 15;
    else if (m[4] === '三刻' || m[4] === '45') minute = 45;
    else if (m[3]) {
      if (m[3] === '半') minute = 30;
      else if (/^[一二三四五六七八九]$/.test(m[3])) minute = cnToNum(m[3]);
      else minute = parseInt(m[3]) || 0;
    }
    if (!isNaN(hour)) {
      if (/下午|晚上|傍晚|夜里/.test(ampm) && hour < 12) hour += 12;
      if (/凌晨/.test(ampm) && hour === 12) hour = 0;
      if (/中午/.test(ampm) && hour < 12) { /* keep */ }
      if (/上午|早上|早晨/.test(ampm) && hour === 12) hour = 0;
      if (hour < 0 || hour > 23) return null;
      return {
        cron: `${minute} ${hour} * * *`,
        humanReadable: `每天 ${pad(hour)}:${pad(minute)}`,
        confidence: 0.9,
      };
    }
  }

  // 每周X HH:MM
  const weekMap: Record<string, number> = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 0, '天': 0 };
  m = t.match(/(?:每)?周([一二三四五六日天])(?:\s*(早上|上午|中午|下午|晚上)?\s*(\d{1,2})(?:[:点](\d{1,2})?)?)?/);
  if (m) {
    const dow = weekMap[m[1]];
    if (dow !== undefined) {
      const hour = m[3] ? parseInt(m[3]) : 9;
      const minute = m[4] ? parseInt(m[4]) : 0;
      return {
        cron: `${minute} ${hour} * * ${dow}`,
        humanReadable: `每周${m[1]} ${pad(hour)}:${pad(minute)}`,
        confidence: 0.9,
      };
    }
  }
  if (/工作日/.test(t)) {
    m = t.match(/(\d{1,2})(?:[:点](\d{1,2})?)?/);
    if (m) {
      const hour = parseInt(m[1]);
      const minute = m[2] ? parseInt(m[2]) : 0;
      return { cron: `${minute} ${hour} * * 1-5`, humanReadable: `工作日 ${pad(hour)}:${pad(minute)}`, confidence: 0.9 };
    }
    return { cron: '0 9 * * 1-5', humanReadable: '工作日 9:00', confidence: 0.85 };
  }
  if (/周末/.test(t)) {
    m = t.match(/(\d{1,2})(?:[:点](\d{1,2})?)?/);
    if (m) {
      const hour = parseInt(m[1]);
      const minute = m[2] ? parseInt(m[2]) : 0;
      return { cron: `${minute} ${hour} * * 6,0`, humanReadable: `周末 ${pad(hour)}:${pad(minute)}`, confidence: 0.9 };
    }
  }

  // 每月X号 HH:MM
  m = t.match(/每月(\d{1,2})号(?:\s*(\d{1,2})(?:[:点](\d{1,2})?)?)?/);
  if (m) {
    const day = parseInt(m[1]);
    const hour = m[2] ? parseInt(m[2]) : 9;
    const minute = m[3] ? parseInt(m[3]) : 0;
    if (day >= 1 && day <= 31) {
      return { cron: `${minute} ${hour} ${day} * *`, humanReadable: `每月${day}号 ${pad(hour)}:${pad(minute)}`, confidence: 0.9 };
    }
  }

  return null;
}

/* ── 意图识别 ── */

/** 检测是否是"建定时任务"意图 */
export function isCronIntent(text: string): boolean {
  const t = text.trim();
  return /(把当前|把这段|把刚才|每次|定时跑|定时任务|建个定时|建一个定时|做个定时|加个定时|定时发送|定时执行|定时提醒|每天.*点|每周.*点|每小时|每\d+分钟|每\d+小时|每隔.*分钟)/.test(t);
}

/** 提取任务消息：从原文中去掉时间短语，剩余部分作为 message */
export function extractCronMessage(text: string, timeReadable: string): string {
  let msg = text
    .replace(/(请帮我|帮我|麻烦|请)?把当前(?:这段|刚才)?(?:对话|内容)?做成?定时任务[，,。.!?？]?/g, '')
    .replace(/做成?定时任务[，,。.!?？]?/g, '')
    .replace(/建个定时任务[，,。.!?？]?/g, '')
    .replace(/建一个定时任务[，,。.!?？]?/g, '')
    .replace(/做个定时任务[，,。.!?？]?/g, '')
    .replace(/加个定时任务[，,。.!?？]?/g, '')
    .replace(/定时跑这个[，,。.!?？]?/g, '')
    .replace(/定时任务[，,。.!?？]?/g, '')
    .replace(/(?:每\d+分钟|每\d+小时|每小时|每半小时)/g, '')
    .replace(/(?:每天|每日|天天)\s*\d{1,2}(?::\d{1,2})?(?:点(?:半)?|分)?/g, '')
    .replace(/(?:早上|上午|中午|下午|晚上|凌晨|夜里)\s*\d{1,2}(?::\d{1,2})?(?:点(?:半)?|分)?/g, '')
    .replace(/(?:每周[一二三四五六日天]|工作日|周末)\s*\d{1,2}(?::\d{1,2})?(?:点(?:半)?|分)?/g, '')
    .replace(/每月\d{1,2}号(?:\s*\d{1,2}(?::\d{1,2})?(?:点|分)?)?/g, '')
    .replace(/每隔.*?分钟/g, '')
    .replace(/^\s*[，,。.!?？]\s*|\s*[，,。.!?？]\s*$/g, '')
    .trim();
  if (!msg) msg = timeReadable;
  return msg;
}

/** 给定时任务起个默认名字 */
export function genCronName(timeReadable: string, message: string): string {
  const short = message.length > 20 ? message.slice(0, 20) + '...' : message;
  return `${timeReadable} · ${short}`;
}

/** 检测对话中是否含时间词（用于模式B主动询问） */
export function hasTimeHint(text: string): boolean {
  // 精确时间表达（优先，置信度高）
  if (/(?:每天|每日|天天|每周|每月|每个?(?:工作日|周末|周一|周二|周三|周四|周五|周六|周日|星期[一二三四五六日天]))/.test(text)) return true;
  // 模糊时间词
  if (/(?:早上|上午|中午|下午|晚上|凌晨|夜里|傍晚|中午)/.test(text)) return true;
  // 重复间隔
  if (/(?:每小时|每\d+分钟|每\d+小时|每隔\d+分钟|每隔\d+小时)/.test(text)) return true;
  // 纯数字时间（2200、09:00、9:00、9点、9点半）
  if (/(?:^|\s)\d{1,2}(?:[:点]\d{0,2})?(?:点|时|点半|分)?/.test(text)) return true;
  // 提醒我 / 到点了 / 到时间
  if (/(?:提醒我|到点了|到时间了|叫我|提醒一下)/.test(text)) return true;
  return false;
}