/**
 * 模型定价表（单位：美元/1M tokens + 人民币/万tokens）
 * 数据来源：各平台官方定价（2026-07-18 更新）
 */

export interface ModelPricing {
  model: string;          // 模型名称（模糊匹配）
  provider: string;       // 提供商
  inputPrice: number;     // 输入价格（USD/1M tokens）
  outputPrice: number;    // 输出价格（USD/1M tokens）
  inputPriceCNY?: number; // 输入价格（¥/1K tokens），中国厂商
  outputPriceCNY?: number; // 输出价格（¥/1K tokens）
  cacheReadPrice?: number;
  cacheCreationPrice?: number;
}

/**
 * 常见模型定价表
 * 按模型名称模糊匹配（toLowerCase().includes()）
 */
export const PRICING_TABLE: ModelPricing[] = [
  // ── Claude 系列 ──
  { model: 'claude-3-5-sonnet', provider: 'Anthropic', inputPrice: 3.0, outputPrice: 15.0 },
  { model: 'claude-3-5-haiku', provider: 'Anthropic', inputPrice: 1.0, outputPrice: 5.0 },
  { model: 'claude-3-opus', provider: 'Anthropic', inputPrice: 15.0, outputPrice: 75.0 },
  { model: 'claude-3-sonnet', provider: 'Anthropic', inputPrice: 3.0, outputPrice: 15.0 },
  { model: 'claude-3-haiku', provider: 'Anthropic', inputPrice: 0.25, outputPrice: 1.25 },
  { model: 'claude-2.1', provider: 'Anthropic', inputPrice: 8.0, outputPrice: 24.0 },
  { model: 'claude-2.0', provider: 'Anthropic', inputPrice: 8.0, outputPrice: 24.0 },
  { model: 'claude-instant', provider: 'Anthropic', inputPrice: 1.63, outputPrice: 5.51 },

  // ── GPT 系列 ──
  { model: 'gpt-4o', provider: 'OpenAI', inputPrice: 2.5, outputPrice: 10.0 },
  { model: 'gpt-4o-mini', provider: 'OpenAI', inputPrice: 0.15, outputPrice: 0.6 },
  { model: 'gpt-4-turbo', provider: 'OpenAI', inputPrice: 10.0, outputPrice: 30.0 },
  { model: 'gpt-4', provider: 'OpenAI', inputPrice: 30.0, outputPrice: 60.0 },
  { model: 'gpt-3.5-turbo', provider: 'OpenAI', inputPrice: 0.5, outputPrice: 1.5 },

  // ── DeepSeek 系列（¥/1K）─
  { model: 'deepseek-chat', provider: 'DeepSeek', inputPrice: 0.27, outputPrice: 1.1, inputPriceCNY: 0.001, outputPriceCNY: 0.004 },
  { model: 'deepseek-reasoner', provider: 'DeepSeek', inputPrice: 0.55, outputPrice: 2.19, inputPriceCNY: 0.002, outputPriceCNY: 0.008 },
  { model: 'deepseek-coder', provider: 'DeepSeek', inputPrice: 0.14, outputPrice: 0.28, inputPriceCNY: 0.001, outputPriceCNY: 0.002 },

  // ── 阿里 Qwen 系列（¥/1K）──
  { model: 'qwen-turbo', provider: '阿里云', inputPrice: 0.05, outputPrice: 0.05, inputPriceCNY: 0.0005, outputPriceCNY: 0.002 },
  { model: 'qwen-plus', provider: '阿里云', inputPrice: 0.4, outputPrice: 1.2, inputPriceCNY: 0.002, outputPriceCNY: 0.008 },
  { model: 'qwen-max', provider: '阿里云', inputPrice: 1.2, outputPrice: 3.6, inputPriceCNY: 0.004, outputPriceCNY: 0.012 },
  { model: 'qwen-long', provider: '阿里云', inputPrice: 0.2, outputPrice: 0.2, inputPriceCNY: 0.001, outputPriceCNY: 0.001 },
  { model: 'qwen2-72b', provider: '阿里云', inputPrice: 0.9, outputPrice: 0.9, inputPriceCNY: 0.004, outputPriceCNY: 0.004 },

  // ── 字节 Doubao 系列（¥/1K，火山引擎）──
  // doubao-1-5-pro / doubao-1-5-lite 等
  { model: 'doubao-1-5-pro', provider: '字节跳动', inputPrice: 0.8, outputPrice: 2.0, inputPriceCNY: 0.008, outputPriceCNY: 0.008 },
  { model: 'doubao-1-5-lite', provider: '字节跳动', inputPrice: 0.08, outputPrice: 0.08, inputPriceCNY: 0.0003, outputPriceCNY: 0.0003 },
  // doubao-seed 系列
  { model: 'doubao-seed-evolving', provider: '字节跳动', inputPrice: 0.3, outputPrice: 0.9, inputPriceCNY: 0.002, outputPriceCNY: 0.006 },
  { model: 'doubao-seed', provider: '字节跳动', inputPrice: 0.3, outputPrice: 0.9, inputPriceCNY: 0.002, outputPriceCNY: 0.006 },
  // 通用 doubao 兜底
  { model: 'doubao', provider: '字节跳动', inputPrice: 0.3, outputPrice: 0.9, inputPriceCNY: 0.002, outputPriceCNY: 0.006 },

  // ── 百度 ERNIE 系列（¥/1K）──
  { model: 'ernie-4', provider: '百度', inputPrice: 0.12, outputPrice: 0.12, inputPriceCNY: 0.012, outputPriceCNY: 0.012 },
  { model: 'ernie-3.5', provider: '百度', inputPrice: 0.04, outputPrice: 0.04, inputPriceCNY: 0.004, outputPriceCNY: 0.004 },
  { model: 'ernie-speed', provider: '百度', inputPrice: 0.01, outputPrice: 0.01, inputPriceCNY: 0.001, outputPriceCNY: 0.001 },

  // ── 智谱 GLM 系列（¥/1K）──
  { model: 'glm-4', provider: '智谱AI', inputPrice: 0.1, outputPrice: 0.1, inputPriceCNY: 0.001, outputPriceCNY: 0.001 },
  { model: 'glm-4-air', provider: '智谱AI', inputPrice: 0.05, outputPrice: 0.05, inputPriceCNY: 0.0005, outputPriceCNY: 0.0005 },
  { model: 'glm-4-flash', provider: '智谱AI', inputPrice: 0.01, outputPrice: 0.01, inputPriceCNY: 0.0001, outputPriceCNY: 0.0001 },

  // ── 零一 Yi 系列（¥/1K）──
  { model: 'yi-lightning', provider: '零一万物', inputPrice: 0.04, outputPrice: 0.04, inputPriceCNY: 0.0005, outputPriceCNY: 0.0005 },
  { model: 'yi-large', provider: '零一万物', inputPrice: 0.23, outputPrice: 0.23, inputPriceCNY: 0.003, outputPriceCNY: 0.003 },

  // ── 月之暗面 Moonshot 系列（¥/1K）──
  { model: 'moonshot-v1', provider: '月之暗面', inputPrice: 0.12, outputPrice: 0.12, inputPriceCNY: 0.001, outputPriceCNY: 0.001 },
  { model: 'moonshot-v1-8k', provider: '月之暗面', inputPrice: 0.012, outputPrice: 0.012, inputPriceCNY: 0.00012, outputPriceCNY: 0.00012 },

  // ── 腾讯混元系列（¥/1K）──
  { model: 'hunyuan', provider: '腾讯', inputPrice: 0.05, outputPrice: 0.05, inputPriceCNY: 0.0005, outputPriceCNY: 0.002 },
  { model: 'hunyuan-turbo', provider: '腾讯', inputPrice: 0.15, outputPrice: 0.15, inputPriceCNY: 0.0015, outputPriceCNY: 0.0015 },

  // ── 讯飞 Spark 系列（¥/1K）──
  { model: 'spark-4', provider: '讯飞', inputPrice: 0.1, outputPrice: 0.1, inputPriceCNY: 0.001, outputPriceCNY: 0.001 },
  { model: 'spark-3', provider: '讯飞', inputPrice: 0.03, outputPrice: 0.03, inputPriceCNY: 0.0003, outputPriceCNY: 0.0003 },

  // ── Gemini 系列 ──
  { model: 'gemini-2', provider: 'Google', inputPrice: 0.1, outputPrice: 0.4 },
  { model: 'gemini-pro', provider: 'Google', inputPrice: 1.25, outputPrice: 5.0 },
  { model: 'gemini-flash', provider: 'Google', inputPrice: 0.075, outputPrice: 0.3 },

  // ── eaKe API 兜底 ──
  { model: 'eake', provider: 'eaKe API', inputPrice: 0.5, outputPrice: 1.0, inputPriceCNY: 0.002, outputPriceCNY: 0.004 },
];

/**
 * 根据模型名称查找定价
 * 模糊匹配：只要模型名包含 pricing.model 即可
 *
 * 特殊处理：
 * - 火山引擎 endpoint ID（ep-m-xxx）→ doubao 兜底
 * - 未知模型 → 返回 null
 */
export function findPricing(modelName: string): ModelPricing | null {
  const lower = modelName.toLowerCase();

  // 火山引擎 endpoint ID → doubao 兜底
  if (lower.startsWith('ep-m-')) {
    return PRICING_TABLE.find(p => p.model === 'doubao') || null;
  }

  // 按 specificity 降序匹配（优先匹配更长的关键词）
  let best: ModelPricing | null = null;
  let bestLen = 0;
  for (const p of PRICING_TABLE) {
    const pm = p.model.toLowerCase();
    if (lower.includes(pm) && pm.length > bestLen) {
      best = p;
      bestLen = pm.length;
    }
  }
  return best;
}

/**
 * 判断提供商是否为中国厂商（¥ 计价）
 */
export function isChineseProvider(provider: string): boolean {
  const chinese = ['字节跳动', '阿里云', '百度', '智谱AI', '零一万物', '月之暗面', '腾讯', '讯飞', 'DeepSeek', 'eaKe API'];
  return chinese.some(c => provider.includes(c));
}

/**
 * 计算费用
 *
 * 返回 { costUsd, costCny, pricing }
 * 中国厂商优先用 CNY 计价，海外厂商用 USD 计价
 */
export function calculateCost(
  modelName: string,
  inputTokens: number,
  outputTokens: number,
  customInputPrice?: number | null,
  customOutputPrice?: number | null
): { costUsd: number; costCny: number; pricing: ModelPricing | null } {
  // 优先用用户自定义单价（单位：¥/万tokens）
  if (customInputPrice != null && customOutputPrice != null) {
    const inputCost = (inputTokens / 10_000) * customInputPrice;
    const outputCost = (outputTokens / 10_000) * customOutputPrice;
    const totalCny = inputCost + outputCost;
    return { costUsd: totalCny / 7.2, costCny: totalCny, pricing: null };
  }

  const pricing = findPricing(modelName);
  if (!pricing) {
    return { costUsd: 0, costCny: 0, pricing: null };
  }

  // 中国厂商用 ¥/1K 计价
  if (pricing.inputPriceCNY != null && pricing.outputPriceCNY != null) {
    const costCny = (inputTokens / 1000) * pricing.inputPriceCNY + (outputTokens / 1000) * pricing.outputPriceCNY;
    return { costUsd: costCny / 7.2, costCny, pricing };
  }

  // 海外厂商用 USD/1M 计价
  const costUsd = (inputTokens / 1_000_000) * pricing.inputPrice + (outputTokens / 1_000_000) * pricing.outputPrice;
  return { costUsd, costCny: costUsd * 7.2, pricing };
}

/**
 * 格式化费用显示（智能选择 ¥ 或 $）
 */
export function fmtCost(costUsd: number, costCny: number): string {
  if (costUsd === 0 && costCny === 0) return '—';
  if (costCny >= 0.001) {
    return `¥${costCny.toFixed(4)}`;
  }
  if (costUsd < 0.01) return `<$0.01`;
  return `$${costUsd.toFixed(4)}`;
}

/**
 * 格式化费用显示（纯人民币）
 */
export function fmtCostCNY(costCny: number): string {
  if (costCny === 0) return '—';
  if (costCny < 0.001) return `<¥0.001`;
  return `¥${costCny.toFixed(4)}`;
}
