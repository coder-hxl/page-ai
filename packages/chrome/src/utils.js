export function debounce(fn, wait) {
  let id

  return function (...args) {
    if (id) {
      clearTimeout(id)
      id = undefined
    }

    id = setTimeout(() => {
      fn.call(this, ...args)
      id = undefined
    }, wait)
  }
}

export const PROMPT_TEMPLATES = {
  TRANSLATE: {
    name: '翻译',
    icon: '🌐',
    systemPrompt: `你是一位专业的翻译专家。请将用户提供的内容翻译成目标语言。

翻译要求：
1. 保持原文的语气和风格
2. 确保翻译准确自然
3. 对于专业术语，保留原文或使用行业标准译法
4. 如果用户没有指定目标语言，默认翻译成中文`,
    userPromptTemplate: (content, targetLang = '中文') => `请将以下内容翻译成${targetLang}：\n\n${content}`
  },

  CODE_EXPLAIN: {
    name: '代码解释',
    icon: '💻',
    systemPrompt: `你是一位资深的软件工程师和编程教育家。请用通俗易懂的方式解释用户提供的代码。

解释要求：
1. 先说明代码的整体功能
2. 分析代码的关键逻辑和算法
3. 解释重要的变量、函数和数据结构
4. 指出代码的优缺点和可能的优化方向
5. 如果有需要改进的地方，提供具体的建议`,
    userPromptTemplate: (content) => `请详细解释以下代码：\n\n${content}`
  },

  SUMMARIZE: {
    name: '文章总结',
    icon: '📝',
    systemPrompt: `你是一位专业的内容摘要专家。请将用户提供的长文本进行简明扼要的总结。

总结要求：
1. 保留原文的核心观点和关键信息
2. 去除冗余和不重要的细节
3. 结构清晰，逻辑连贯
4. 总结长度通常为原文的 1/5 到 1/10
5. 使用流畅的中文表达`,
    userPromptTemplate: (content) => `请对以下内容进行总结：\n\n${content}`
  },

  POLISH: {
    name: '段落润色',
    icon: '✨',
    systemPrompt: `你是一位专业的写作编辑和语言专家。请帮助用户润色和优化提供的文本内容。

润色要求：
1. 修正语法错误和拼写问题
2. 优化句子结构，使其更加流畅自然
3. 提升表达的准确性和逻辑性
4. 保持原文的意思和语气风格
5. 提供修改后的文本和简要的修改说明`,
    userPromptTemplate: (content) => `请润色以下内容：\n\n${content}`
  },

  CHAT: {
    name: '自由对话',
    icon: '💬',
    systemPrompt: '你是一位友好的 AI 助手，请回答用户的问题。',
    userPromptTemplate: (content) => content
  }
}

export const HISTORY_CONFIG = {
  MAX_ITEMS: 50,
  STORAGE_KEY: 'page_ai_history'
}

export function formatTimestamp(timestamp) {
  const date = new Date(timestamp)
  const now = new Date()
  const diffMs = now - date
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return '刚刚'
  if (diffMins < 60) return `${diffMins}分钟前`
  if (diffHours < 24) return `${diffHours}小时前`
  if (diffDays < 7) return `${diffDays}天前`

  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}
