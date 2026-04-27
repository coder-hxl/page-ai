import { 
  debounce, 
  ActionTypes, 
  getActionPrompt, 
  showToast, 
  updateStatus, 
  validateConfig,
  cleanText,
  truncateText
} from '../src/utils.js'

const configInputs = document.querySelectorAll('.config-input')
const configCheckboxs = document.querySelectorAll('.config-checkbox')
const searchInput = document.querySelector('.search-ipt')
const searchBtn = document.querySelector('.search-btn')
const messageList = document.querySelector('.message-list')
const featureBtns = document.querySelectorAll('.feature-btn')

const context = {
  currentTab: null,
  searchContent: '',
  isReplyState: false,
  isSearchInputEmpty: true,
  isProcessing: false,
  currentAction: null,

  config: {
    BASE_URL: '',
    API_KEY: '',
    READ_CONTEXT: false,
    MODEL: ''
  }
}

let rawPrevChunk = ''
function transformOpenAIChunkToArr(chunk) {
  chunk = chunk.replace('data: [DONE]', '').trim()

  if (!chunk) {
    return []
  } else if (!chunk.endsWith('}]}')) {
    rawPrevChunk += chunk
    return []
  }

  if (rawPrevChunk) {
    chunk = rawPrevChunk + chunk
    rawPrevChunk = ''
  }

  const replaceData = chunk.replaceAll('data: ', ',').slice(1)

  return JSON.parse(`[${replaceData}]`)
}

async function handleStreamReaderAnswer(el, reader, onComplete) {
  const decoder = new TextDecoder()
  let fullContent = ''

  return reader.read().then(function pump({ done, value }) {
    if (done) {
      if (onComplete) {
        onComplete(fullContent)
      }
      return
    }

    const text = decoder.decode(value)
    const values = transformOpenAIChunkToArr(text)

    if (values.length) {
      values.forEach((item) => {
        const choice = item.choices[0]

        if (choice.finish_reason === 'stop') return

        const content = choice.delta.content ?? ''
        fullContent += content
        el.innerText += content
      })
    }

    return reader.read().then(pump)
  })
}

function createOpenAIBodyStr(prompt, bodyContentText = '') {
  const result = {
    model: context.config.MODEL,
    messages: [],
    stream: true
  }

  if (context.config.READ_CONTEXT && bodyContentText) {
    const rule = `
      page-text用户的内容简称上下文。client用户的内容简称问题。

      你需要根据上下文回答问题。

       步骤:
       1.处理：对上下文进行文本清理、分词和词性标注。
       2.问题分类：将问题进行分类，确定其类型（如事实性、观点性等）。
       3.上下文分析：在上下文中查找与问题相关的段落或句子，并分析它们的上下文信息。
       4.答案生成：根据问题的类型和上下文信息，抽取相关的答案片段或生成合适的回答。
       5.返回回答：将生成的回答返回给用户。
    `

    result.messages.push(
      { role: 'system', content: rule },
      { role: 'user', name: 'page-text', content: bodyContentText },
      { role: 'user', name: 'client', content: prompt }
    )
  } else {
    result.messages.push(
      { role: 'system', content: '你是一个有帮助的AI助手，请回答用户问题。' },
      { role: 'user', content: prompt }
    )
  }

  return JSON.stringify(result)
}

async function fetchOpenAIStreamReader(prompt, bodyContentText = '') {
  const response = await fetch(`${context.config.BASE_URL}/chat/completions`, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${context.config.API_KEY}`
    },
    method: 'post',
    body: createOpenAIBodyStr(prompt, bodyContentText)
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(`${response.status} - 网络响应不正常。${errorText ? `详情: ${truncateText(errorText, 100)}` : ''}`)
  }

  return response.body.getReader()
}

async function executeAIRequest(actionType, content, isReadContext = false) {
  const validation = validateConfig(context.config)
  if (!validation.valid) {
    updateStatus('error', '配置不完整')
    showToast('请先配置 API Key 和模型参数', 'error')
    return null
  }

  const prompt = getActionPrompt(actionType, content)
  if (!prompt) {
    showToast('无效的操作类型', 'error')
    return null
  }

  try {
    const reader = await fetchOpenAIStreamReader(prompt, isReadContext ? content : '')
    return reader
  } catch (error) {
    console.error('AI request failed:', error)
    throw error
  }
}

function createMessageItem(type, content) {
  const el = document.createElement('div')
  el.setAttribute('class', `item item-${type}`)
  
  if (type === 'user') {
    el.innerHTML = `<div class="message-role">用户</div><div class="message-content">${content}</div>`
  } else if (type === 'action') {
    el.innerHTML = `<div class="message-role">操作</div><div class="message-content">${content}</div>`
  } else {
    el.innerHTML = `<div class="message-role">AI</div><div class="message-content"></div>`
    if (content) {
      el.querySelector('.message-content').innerText = content
    }
  }
  
  messageList.insertBefore(el, messageList.firstElementChild)
  return el
}

async function handleFeatureAction(action) {
  if (context.isProcessing) {
    showToast('请等待当前操作完成', 'warning')
    return
  }

  context.isProcessing = true
  context.currentAction = action
  updateStatus('loading', '处理中...')

  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
    context.currentTab = tab

    if (action === ActionTypes.COPY) {
      await handleCopyAction(tab)
      return
    }

    const pageContent = await getPageContent(tab)
    
    if (!pageContent || pageContent.trim().length === 0) {
      showToast('无法获取页面内容', 'error')
      updateStatus('error', '获取内容失败')
      context.isProcessing = false
      return
    }

    const actionNames = {
      [ActionTypes.KEYWORDS]: '关键词提取',
      [ActionTypes.SUMMARIZE]: '文本精简',
      [ActionTypes.OPTIMIZE]: '语句优化',
      [ActionTypes.CORRECT]: '智能纠错',
      [ActionTypes.DEDUPLICATE]: '内容去重',
      [ActionTypes.HIGHLIGHT]: '重点标注',
      [ActionTypes.FORMAT]: '格式规整'
    }

    createMessageItem('action', `执行: ${actionNames[action]}`)

    if (action === ActionTypes.DEDUPLICATE || action === ActionTypes.FORMAT) {
      await handleLocalAction(action, pageContent, tab)
    } else {
      await handleAIAction(action, pageContent, tab)
    }

  } catch (error) {
    console.error('Feature action failed:', error)
    showToast(`操作失败: ${error.message}`, 'error')
    updateStatus('error', '操作失败')
  } finally {
    context.isProcessing = false
    context.currentAction = null
  }
}

async function getPageContent(tab) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tab.id, { action: 'get_selected_text' }, (response) => {
      if (chrome.runtime.lastError) {
        chrome.tabs.sendMessage(tab.id, { action: 'get_page_content' }, (res) => {
          if (chrome.runtime.lastError) {
            reject(new Error('无法与页面通信，请刷新页面后重试'))
          } else {
            resolve(res ? res.content : '')
          }
        })
      } else {
        resolve(response ? response.content : '')
      }
    })
  })
}

async function handleCopyAction(tab) {
  try {
    const content = await getPageContent(tab)
    
    if (!content || content.trim().length === 0) {
      showToast('没有可复制的内容', 'warning')
      updateStatus('error', '无内容')
      context.isProcessing = false
      return
    }

    await chrome.tabs.sendMessage(tab.id, { action: 'copy_content' })
    
    createMessageItem('action', `已复制 ${content.length} 个字符到剪贴板`)
    updateStatus('success', '复制成功')
    showToast('内容已复制到剪贴板', 'success')
    context.isProcessing = false

  } catch (error) {
    console.error('Copy action failed:', error)
    showToast(`复制失败: ${error.message}`, 'error')
    updateStatus('error', '复制失败')
    context.isProcessing = false
  }
}

async function handleLocalAction(action, content, tab) {
  try {
    let result = ''
    let resultMessage = ''

    if (action === ActionTypes.DEDUPLICATE) {
      const lines = content.split('\n')
      const seen = new Set()
      const uniqueLines = []
      let removedCount = 0

      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed === '') {
          uniqueLines.push(line)
        } else if (!seen.has(trimmed)) {
          seen.add(trimmed)
          uniqueLines.push(line)
        } else {
          removedCount++
        }
      }

      result = uniqueLines.join('\n')
      resultMessage = `去重完成，移除了 ${removedCount} 个重复行`
    } else if (action === ActionTypes.FORMAT) {
      result = content
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/([。！？.!?])\s*/g, '$1\n')
        .replace(/([，；,;])\s*/g, '$1 ')
        .trim()
      
      const lines = result.split('\n')
      result = lines.map(l => l.trim()).filter((l, i, arr) => {
        if (l === '') return arr[i - 1] !== ''
        return true
      }).join('\n')
      
      resultMessage = '格式规整完成'
    }

    createMessageItem('ai', result)
    updateStatus('success', '处理完成')
    showToast(resultMessage, 'success')

  } catch (error) {
    console.error('Local action failed:', error)
    showToast(`处理失败: ${error.message}`, 'error')
    updateStatus('error', '处理失败')
  }
}

async function handleAIAction(action, content, tab) {
  try {
    const aiResultEl = createMessageItem('ai', '')
    const contentEl = aiResultEl.querySelector('.message-content')

    const reader = await executeAIRequest(action, content, context.config.READ_CONTEXT)
    
    if (!reader) {
      contentEl.innerText = 'AI 处理失败'
      updateStatus('error', '处理失败')
      return
    }

    await handleStreamReaderAnswer(contentEl, reader, async (fullContent) => {
      if (action === ActionTypes.HIGHLIGHT) {
        const keywords = fullContent
          .split(/[，,、\s]+/)
          .map(k => k.trim())
          .filter(k => k.length > 1)
        
        if (keywords.length > 0) {
          await chrome.tabs.sendMessage(tab.id, { 
            action: 'highlight', 
            keywords: keywords 
          })
          showToast(`已高亮 ${keywords.length} 个关键词`, 'success')
        }
      } else if (action === ActionTypes.KEYWORDS) {
        const keywords = fullContent
          .split(/[，,、\s]+/)
          .map(k => k.trim())
          .filter(k => k.length > 1)
        
        if (keywords.length > 0) {
          await chrome.tabs.sendMessage(tab.id, { 
            action: 'highlight', 
            keywords: keywords 
          })
          showToast(`已提取并高亮 ${keywords.length} 个关键词`, 'success')
        }
      }
      
      updateStatus('success', '处理完成')
    })

  } catch (error) {
    console.error('AI action failed:', error)
    showToast(`AI 处理失败: ${error.message}`, 'error')
    updateStatus('error', '处理失败')
  }
}

async function replyProblem(bodyContentText = '') {
  const el = document.createElement('div')
  el.setAttribute('class', 'item item-ai')
  el.innerHTML = '<div class="message-role">AI</div><div class="message-content"></div>'
  messageList.insertBefore(el, messageList.firstElementChild)
  const contentEl = el.querySelector('.message-content')

  searchBtn.disabled = context.isReplyState = true
  context.isProcessing = true
  updateStatus('loading', 'AI 思考中...')

  try {
    const reader = await fetchOpenAIStreamReader(
      context.searchContent,
      bodyContentText
    )
    await handleStreamReaderAnswer(contentEl, reader, () => {
      updateStatus('success', '回答完成')
    })
  } catch (error) {
    contentEl.innerText = `错误: ${error.message}`
    updateStatus('error', '请求失败')
    showToast(`请求失败: ${error.message}`, 'error')
  } finally {
    context.isReplyState = false
    context.isProcessing = false
    searchBtn.disabled = context.isSearchInputEmpty
  }
}

function handleProblem() {
  if (context.isSearchInputEmpty || context.isProcessing) return

  context.searchContent = searchInput.value
  searchInput.value = ''
  context.isSearchInputEmpty = true

  createMessageItem('user', context.searchContent)

  if (context.config.READ_CONTEXT) {
    chrome.tabs.sendMessage(context.currentTab.id, 'get body content text')
  } else {
    replyProblem()
  }
}

function init() {
  chrome.tabs
    .query({ active: true, lastFocusedWindow: true })
    .then(([tab]) => (context.currentTab = tab))

  chrome.storage.local.get(Object.keys(context.config)).then((localValues) => {
    context.config.BASE_URL =
      localValues.BASE_URL ?? 'https://api.openai.com/v1'
    context.config.API_KEY = localValues.API_KEY ?? ''
    context.config.READ_CONTEXT = localValues.READ_CONTEXT ?? false
    context.config.MODEL = localValues.MODEL ?? 'gpt-3.5-turbo'

    configInputs.forEach((el) => {
      el.value = context.config[el.dataset.name]

      el.addEventListener('change', (event) => {
        const name = event.target.dataset.name
        const value = event.target.value

        context.config[name] = value
        chrome.storage.local.set({ [name]: value })
        showToast('配置已保存', 'success')
      })
    })

    configCheckboxs.forEach((el) => {
      el.checked = context.config[el.dataset.name]

      el.addEventListener('change', (event) => {
        const name = event.target.dataset.name
        const value = event.target.checked

        context.config[name] = value
        chrome.storage.local.set({ [name]: value })
        showToast(value ? '已启用页面内容读取' : '已禁用页面内容读取', 'info')
      })
    })
  })

  searchInput.addEventListener('input', async (event) => {
    context.isSearchInputEmpty = !event.target.value.trim()

    if (!context.isReplyState) {
      searchBtn.disabled = context.isSearchInputEmpty
    }
  })

  searchInput.addEventListener(
    'keydown',
    debounce(async (event) => {
      if (event.code === 'Enter') {
        handleProblem()
      }
    }, 500)
  )

  searchBtn.addEventListener('click', handleProblem)

  featureBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action
      handleFeatureAction(action)
    })
  })

  chrome.runtime.onMessage.addListener(async (bodyContentText) => {
    if (typeof bodyContentText === 'string') {
      replyProblem(bodyContentText)
    }
  })

  updateStatus('success', '就绪')
}

init()
