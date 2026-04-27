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

export function throttle(fn, wait) {
  let lastTime = 0

  return function (...args) {
    const now = Date.now()
    if (now - lastTime >= wait) {
      lastTime = now
      fn.call(this, ...args)
    }
  }
}

export function cleanText(text) {
  if (!text) return ''
  
  return text
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/^\s+|\s+$/g, '')
}

export function extractMainContent(text) {
  if (!text) return ''
  
  const lines = text.split('\n').filter(line => line.trim().length > 0)
  
  const scoredLines = lines.map(line => {
    let score = 0
    
    if (line.length > 50 && line.length < 500) score += 2
    if (line.match(/[。！？.!?]/)) score += 1
    if (line.match(/^[#\*\-·]/)) score -= 1
    if (line.match(/(http|www|@)/i)) score -= 1
    if (line.match(/\d{4,}/)) score -= 1
    
    return { line, score }
  })
  
  return scoredLines
    .filter(item => item.score >= 0)
    .map(item => item.line)
    .join('\n')
}

export function deduplicateText(text) {
  if (!text) return ''
  
  const lines = text.split('\n')
  const seen = new Set()
  const result = []
  
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed)
      result.push(line)
    } else if (!trimmed) {
      result.push(line)
    }
  }
  
  return result.join('\n')
}

export function formatText(text) {
  if (!text) return ''
  
  let formatted = text
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/([。！？.!?])\s*/g, '$1\n')
    .replace(/([，；,;])\s*/g, '$1 ')
  
  const lines = formatted.split('\n')
  return lines
    .map(line => line.trim())
    .filter((line, index, arr) => {
      if (line === '') {
        return arr[index - 1] !== ''
      }
      return true
    })
    .join('\n')
}

export function estimateReadingTime(text) {
  if (!text) return 0
  
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length
  const englishWords = text.split(/\s+/).filter(word => /[a-zA-Z]/.test(word)).length
  
  const chineseTime = chineseChars / 300
  const englishTime = englishWords / 200
  
  return Math.ceil(chineseTime + englishTime)
}

export function truncateText(text, maxLength = 100, suffix = '...') {
  if (!text) return ''
  if (text.length <= maxLength) return text
  
  return text.substring(0, maxLength - suffix.length) + suffix
}

export function escapeHtml(text) {
  if (!text) return ''
  
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

export function unescapeHtml(text) {
  if (!text) return ''
  
  const div = document.createElement('div')
  div.innerHTML = text
  return div.textContent || div.innerText
}

export const ActionTypes = {
  COPY: 'copy',
  KEYWORDS: 'keywords',
  SUMMARIZE: 'summarize',
  OPTIMIZE: 'optimize',
  CORRECT: 'correct',
  DEDUPLICATE: 'deduplicate',
  HIGHLIGHT: 'highlight',
  FORMAT: 'format'
}

export function getActionPrompt(action, content) {
  const prompts = {
    [ActionTypes.KEYWORDS]: `请从以下文本中提取5-10个最核心的关键词，以中文逗号分隔返回，不要其他内容：\n\n${content}`,
    
    [ActionTypes.SUMMARIZE]: `请对以下文本进行精简摘要，保留核心信息，去除冗余内容，用简洁的语言概括：\n\n${content}`,
    
    [ActionTypes.OPTIMIZE]: `请对以下文本进行语句优化，使其表达更清晰、流畅、专业，保留原意：\n\n${content}`,
    
    [ActionTypes.CORRECT]: `请对以下文本进行智能纠错，修正错别字、语法错误和标点错误，返回修正后的文本：\n\n${content}`,
    
    [ActionTypes.DEDUPLICATE]: `请对以下文本进行内容去重，移除重复的句子或段落，保留独特内容：\n\n${content}`,
    
    [ActionTypes.HIGHLIGHT]: `请从以下文本中识别最重要的3-5个关键词或短语，用于页面高亮标注，以中文逗号分隔返回：\n\n${content}`,
    
    [ActionTypes.FORMAT]: `请对以下文本进行格式规整，统一标点、缩进和换行，使其格式规范美观：\n\n${content}`
  }
  
  return prompts[action] || content
}

export function showToast(message, type = 'info', duration = 3000) {
  const toast = document.getElementById('toast')
  if (!toast) return
  
  toast.textContent = message
  toast.className = `toast toast-${type}`
  toast.style.display = 'block'
  
  setTimeout(() => {
    toast.style.display = 'none'
  }, duration)
}

export function updateStatus(status, message) {
  const statusIcon = document.getElementById('statusIcon')
  const statusText = document.getElementById('statusText')
  
  if (statusIcon && statusText) {
    switch (status) {
      case 'loading':
        statusIcon.textContent = '⏳'
        statusText.className = 'status-text status-loading'
        break
      case 'success':
        statusIcon.textContent = '✓'
        statusText.className = 'status-text status-success'
        break
      case 'error':
        statusIcon.textContent = '✗'
        statusText.className = 'status-text status-error'
        break
      default:
        statusIcon.textContent = '✓'
        statusText.className = 'status-text'
    }
    
    if (message) {
      statusText.textContent = message
    }
  }
}

export function validateConfig(config) {
  const errors = []
  
  if (!config.BASE_URL) {
    errors.push('Base URL 不能为空')
  } else if (!config.BASE_URL.startsWith('http')) {
    errors.push('Base URL 格式不正确')
  }
  
  if (!config.API_KEY) {
    errors.push('API Key 不能为空')
  }
  
  if (!config.MODEL) {
    errors.push('模型名称不能为空')
  }
  
  return {
    valid: errors.length === 0,
    errors: errors
  }
}

export function safeJsonParse(str, fallback = null) {
  try {
    return JSON.parse(str)
  } catch (e) {
    console.warn('JSON parse failed:', e)
    return fallback
  }
}

export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2)
}
