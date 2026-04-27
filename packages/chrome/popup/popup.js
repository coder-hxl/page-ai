import { debounce, PROMPT_TEMPLATES, HISTORY_CONFIG, formatTimestamp } from '../src/utils.js'

console.log('[Page AI] popup.js 开始加载...')

const configInputs = document.querySelectorAll('.config-input')
const configCheckboxs = document.querySelectorAll('.config-checkbox')

const searchInput = document.querySelector('.search-ipt')
const searchBtn = document.querySelector('.search-btn')
const messageList = document.querySelector('.message-list')
const featureButtons = document.querySelectorAll('.feature-btn')
const tabButtons = document.querySelectorAll('.tab-btn')
const tabContents = document.querySelectorAll('.tab-content')
const historyList = document.querySelector('.history-list')
const clearHistoryBtn = document.querySelector('.clear-history-btn')

console.log('[Page AI] DOM 元素获取结果:', {
  searchInput: !!searchInput,
  searchBtn: !!searchBtn,
  messageList: !!messageList,
  featureButtons: featureButtons.length,
  tabButtons: tabButtons.length,
  tabContents: tabContents.length
})

const context = {
  currentTab: null,
  searchContent: '',
  isReplyState: false,
  isSearchInputEmpty: true,
  currentFeature: 'CHAT',

  config: {
    BASE_URL: '',
    API_KEY: '',
    READ_CONTEXT: false,
    MODEL: ''
  },

  history: []
}

function logDebug(step, data) {
  console.log(`[Page AI] [${step}]`, data || '')
}

function logError(step, error) {
  console.error(`[Page AI] [错误] [${step}]`, error)
  if (error.message) {
    console.error(`[Page AI] [错误详情]`, error.message)
  }
  if (error.stack) {
    console.error(`[Page AI] [错误堆栈]`, error.stack)
  }
}

let rawPrevChunk = ''
function transformOpenAIChunkToArr(chunk) {
  try {
    logDebug('transformOpenAIChunkToArr', '开始处理 chunk')
    chunk = chunk.replace('data: [DONE]', '').trim()

    if (!chunk) {
      logDebug('transformOpenAIChunkToArr', 'chunk 为空，返回空数组')
      return []
    } else if (!chunk.endsWith('}]}')) {
      logDebug('transformOpenAIChunkToArr', 'chunk 不完整，缓存等待后续')
      rawPrevChunk += chunk
      return []
    }

    if (rawPrevChunk) {
      chunk = rawPrevChunk + chunk
      rawPrevChunk = ''
      logDebug('transformOpenAIChunkToArr', '拼接缓存的 chunk')
    }

    const replaceData = chunk.replaceAll('data: ', ',').slice(1)
    logDebug('transformOpenAIChunkToArr', `处理后的数据长度: ${replaceData.length}`)

    return JSON.parse(`[${replaceData}]`)
  } catch (error) {
    logError('transformOpenAIChunkToArr', error)
    return []
  }
}

async function handleStreamReaderAnswer(el, reader) {
  logDebug('handleStreamReaderAnswer', '开始处理流式响应')
  const decoder = new TextDecoder()

  try {
    return reader.read().then(function pump({ done, value }) {
      if (done) {
        logDebug('handleStreamReaderAnswer', '流式响应完成')
        return
      }

      logDebug('handleStreamReaderAnswer', `接收到数据块，大小: ${value ? value.length : 0}`)

      const text = decoder.decode(value)
      logDebug('handleStreamReaderAnswer', `解码后的文本: ${text.substring(0, 200)}...`)

      const values = transformOpenAIChunkToArr(text)
      logDebug('handleStreamReaderAnswer', `解析后的值数量: ${values.length}`)

      if (values.length) {
        values.forEach((item, index) => {
          try {
            logDebug('handleStreamReaderAnswer', `处理第 ${index} 个值`)
            const choice = item.choices[0]

            if (choice.finish_reason === 'stop') {
              logDebug('handleStreamReaderAnswer', '收到 finish_reason: stop')
              return
            }

            const content = choice.delta.content ?? ''
            if (content) {
              el.innerText += content
              logDebug('handleStreamReaderAnswer', `追加内容: "${content.substring(0, 50)}..."`)
            }
          } catch (error) {
            logError('handleStreamReaderAnswer - 处理单个值', error)
          }
        })
      }

      return reader.read().then(pump)
    })
  } catch (error) {
    logError('handleStreamReaderAnswer', error)
    throw error
  }
}

function createOpenAIBodyStr(searchContent, bodyContentText = '') {
  logDebug('createOpenAIBodyStr', {
    searchContent: searchContent.substring(0, 100) + (searchContent.length > 100 ? '...' : ''),
    bodyContentText: bodyContentText ? (bodyContentText.substring(0, 100) + '...') : '空',
    currentFeature: context.currentFeature,
    config: {
      BASE_URL: context.config.BASE_URL,
      API_KEY: context.config.API_KEY ? '******' : '空',
      MODEL: context.config.MODEL,
      READ_CONTEXT: context.config.READ_CONTEXT
    }
  })

  const template = PROMPT_TEMPLATES[context.currentFeature]
  logDebug('createOpenAIBodyStr', `使用模板: ${template ? template.name : '未找到'}`)

  if (!template) {
    logError('createOpenAIBodyStr', new Error(`未找到功能模板: ${context.currentFeature}`))
  }

  const result = {
    model: context.config.MODEL,
    messages: [],
    stream: true
  }

  if (context.config.READ_CONTEXT && bodyContentText) {
    logDebug('createOpenAIBodyStr', '使用页面上下文模式')

    const rule = `
      page-text用户的内容简称上下文。clien用户的内容简称问题。

      你需要根据上下文回答问题。

       步骤:
       1.处理：对上下文进行文本清理、分词和词性标注。
       2.问题分类：将问题进行分类，确定其类型（如事实性、观点性等）。
       3.上下文分析：在上下文中查找与问题相关的段落或句子，并分析它们的上下文信息。
       4.答案生成：根据问题的类型和上下文信息，抽取相关的答案片段或生成合适的回答。
       5.返回回答：将生成的回答返回给用户。
    `

    const userContent = template.userPromptTemplate(searchContent)

    result.messages.push(
      { role: 'system', content: rule },
      { role: 'user', name: 'page-text', content: bodyContentText },
      { role: 'user', name: 'clien', content: userContent }
    )
  } else {
    logDebug('createOpenAIBodyStr', '使用普通对话模式')

    const systemPrompt = template.systemPrompt
    const userContent = template.userPromptTemplate(searchContent)

    logDebug('createOpenAIBodyStr', {
      systemPrompt: systemPrompt.substring(0, 100) + '...',
      userContent: userContent.substring(0, 100) + '...'
    })

    result.messages.push(
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent }
    )
  }

  logDebug('createOpenAIBodyStr', `请求体构建完成，消息数量: ${result.messages.length}`)
  logDebug('createOpenAIBodyStr', `消息结构: ${JSON.stringify(result.messages, null, 2)}`)

  return JSON.stringify(result)
}

async function fetchOpenAIStreamReader(searchContent, bodyContentText = '') {
  logDebug('fetchOpenAIStreamReader', '开始发起请求...')

  const url = `${context.config.BASE_URL}/chat/completions`
  logDebug('fetchOpenAIStreamReader', `请求 URL: ${url}`)

  try {
    if (!context.config.BASE_URL) {
      throw new Error('Base URL 未配置，请在设置中填写')
    }

    if (!context.config.API_KEY) {
      throw new Error('API Key 未配置，请在设置中填写')
    }

    if (!context.config.MODEL) {
      throw new Error('模型名称未配置，请在设置中填写')
    }

    const body = createOpenAIBodyStr(searchContent, bodyContentText)
    logDebug('fetchOpenAIStreamReader', `请求体大小: ${body.length} 字节`)

    try {
      const parsedBody = JSON.parse(body)
      logDebug('fetchOpenAIStreamReader', `完整请求体 (model): ${parsedBody.model}`)
      logDebug('fetchOpenAIStreamReader', `完整请求体 (stream): ${parsedBody.stream}`)
      logDebug('fetchOpenAIStreamReader', `完整请求体 (messages 数量): ${parsedBody.messages.length}`)
      parsedBody.messages.forEach((msg, idx) => {
        logDebug('fetchOpenAIStreamReader', `  message[${idx}]: role=${msg.role}, name=${msg.name || '无'}, content长度=${msg.content ? msg.content.length : 0}`)
        if (msg.content && msg.content.length < 500) {
          logDebug('fetchOpenAIStreamReader', `  message[${idx}] content: ${msg.content}`)
        } else if (msg.content) {
          logDebug('fetchOpenAIStreamReader', `  message[${idx}] content 前200字符: ${msg.content.substring(0, 200)}...`)
        }
      })
    } catch (e) {
      logError('fetchOpenAIStreamReader - 解析请求体失败', e)
    }

    logDebug('fetchOpenAIStreamReader', `发送请求到: ${url}`)

    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${context.config.API_KEY}`
      },
      method: 'post',
      body: body
    })

    logDebug('fetchOpenAIStreamReader', `响应状态: ${response.status} ${response.statusText}`)
    logDebug('fetchOpenAIStreamReader', `响应 OK: ${response.ok}`)

    if (!response.ok) {
      let errorText = ''
      try {
        errorText = await response.text()
        logDebug('fetchOpenAIStreamReader', `错误响应内容: ${errorText}`)
      } catch (e) {
        logError('fetchOpenAIStreamReader - 读取错误响应', e)
      }

      let errorMessage = `HTTP 错误: ${response.status}`

      try {
        const errorJson = JSON.parse(errorText)
        if (errorJson.error) {
          if (errorJson.error.message) {
            errorMessage = errorJson.error.message
          }
          if (errorJson.error.code) {
            errorMessage += ` (代码: ${errorJson.error.code})`
          }
        }
      } catch (e) {
        if (errorText) {
          errorMessage += ` - ${errorText.substring(0, 200)}`
        }
      }

      throw new Error(errorMessage)
    }

    logDebug('fetchOpenAIStreamReader', '请求成功，返回 reader')
    return response.body.getReader()
  } catch (error) {
    logError('fetchOpenAIStreamReader', error)
    throw error
  }
}

function createMessageElement(question, answer, featureType = 'CHAT') {
  logDebug('createMessageElement', { question, answer, featureType })

  const template = PROMPT_TEMPLATES[featureType]
  const questionEl = document.createElement('div')
  questionEl.setAttribute('class', 'message-item question')
  questionEl.innerHTML = `
    <div class="message-header">
      <span class="message-role">用户</span>
      <span class="message-feature">${template ? template.icon : ''} ${template ? template.name : '未知'}</span>
    </div>
    <div class="message-content">${escapeHtml(question)}</div>
  `

  const answerEl = document.createElement('div')
  answerEl.setAttribute('class', 'message-item answer')
  answerEl.innerHTML = `
    <div class="message-header">
      <span class="message-role">AI</span>
    </div>
    <div class="message-content">${escapeHtml(answer)}</div>
  `

  return { questionEl, answerEl }
}

function escapeHtml(text) {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

function truncateText(text, maxLength = 100) {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength) + '...'
}

async function saveHistory(question, answer, featureType) {
  logDebug('saveHistory', '开始保存历史记录')

  try {
    const historyItem = {
      id: Date.now().toString(),
      question,
      answer,
      featureType,
      timestamp: Date.now()
    }

    context.history.unshift(historyItem)

    if (context.history.length > HISTORY_CONFIG.MAX_ITEMS) {
      context.history = context.history.slice(0, HISTORY_CONFIG.MAX_ITEMS)
      logDebug('saveHistory', `历史记录超出限制，仅保留前 ${HISTORY_CONFIG.MAX_ITEMS} 条`)
    }

    await chrome.storage.local.set({ [HISTORY_CONFIG.STORAGE_KEY]: context.history })
    logDebug('saveHistory', `历史记录已保存，当前数量: ${context.history.length}`)

    renderHistoryList()
  } catch (error) {
    logError('saveHistory', error)
  }
}

async function loadHistory() {
  logDebug('loadHistory', '开始加载历史记录')

  try {
    const result = await chrome.storage.local.get(HISTORY_CONFIG.STORAGE_KEY)
    context.history = result[HISTORY_CONFIG.STORAGE_KEY] || []
    logDebug('loadHistory', `已加载 ${context.history.length} 条历史记录`)

    renderHistoryList()
  } catch (error) {
    logError('loadHistory', error)
  }
}

async function clearHistory() {
  logDebug('clearHistory', '清空历史记录')

  try {
    context.history = []
    await chrome.storage.local.remove(HISTORY_CONFIG.STORAGE_KEY)
    logDebug('clearHistory', '历史记录已清空')

    renderHistoryList()
  } catch (error) {
    logError('clearHistory', error)
  }
}

function renderHistoryList() {
  logDebug('renderHistoryList', `渲染历史列表，数量: ${context.history.length}`)

  try {
    if (context.history.length === 0) {
      historyList.innerHTML = '<div class="history-empty">暂无历史记录</div>'
      return
    }

    historyList.innerHTML = ''

    context.history.forEach((item) => {
      const template = PROMPT_TEMPLATES[item.featureType]
      const historyItem = document.createElement('div')
      historyItem.setAttribute('class', 'history-item')
      historyItem.dataset.id = item.id

      historyItem.innerHTML = `
        <div class="history-item-header">
          <span class="history-feature">${template ? template.icon : ''} ${template ? template.name : '未知'}</span>
          <span class="history-time">${formatTimestamp(item.timestamp)}</span>
        </div>
        <div class="history-item-preview">
          <div class="history-question">${escapeHtml(truncateText(item.question))}</div>
          <div class="history-answer">${escapeHtml(truncateText(item.answer))}</div>
        </div>
        <div class="history-item-actions">
          <button class="history-btn view-btn" title="查看详情">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
            <circle cx="12" cy="12" r="3"></circle>
          </svg>
            查看
          </button>
          <button class="history-btn delete-btn" title="删除">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3,6 5,6 21,6"></polyline>
            <path d="M19,6v14a2,2,0,0,1-2,2H7a2,2,0,0,1-2-2V6M8,6V4a2,2,0,0,1,2-2h4a2,2,0,0,1,2,2v2"></path>
          </svg>
          </button>
        </div>
      `

      historyList.appendChild(historyItem)
    })

    logDebug('renderHistoryList', '历史列表渲染完成')
  } catch (error) {
    logError('renderHistoryList', error)
  }
}

function showHistoryDetail(item) {
  logDebug('showHistoryDetail', '显示历史详情', { id: item.id, featureType: item.featureType })

  try {
    switchTab('chat')

    messageList.innerHTML = ''

    const { questionEl, answerEl } = createMessageElement(
      item.question,
      item.answer,
      item.featureType
    )

    messageList.appendChild(questionEl)
    messageList.appendChild(answerEl)

    featureButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.feature === item.featureType)
    })
    context.currentFeature = item.featureType

    logDebug('showHistoryDetail', '历史详情显示完成')
  } catch (error) {
    logError('showHistoryDetail', error)
  }
}

async function deleteHistoryItem(id) {
  logDebug('deleteHistoryItem', `删除历史记录: ${id}`)

  try {
    context.history = context.history.filter((item) => item.id !== id)
    await chrome.storage.local.set({ [HISTORY_CONFIG.STORAGE_KEY]: context.history })
    logDebug('deleteHistoryItem', '历史记录已删除')

    renderHistoryList()
  } catch (error) {
    logError('deleteHistoryItem', error)
  }
}

function switchTab(tabName) {
  logDebug('switchTab', `切换到标签: ${tabName}`)

  try {
    tabButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === tabName)
    })

    tabContents.forEach((content) => {
      content.classList.toggle('active', content.dataset.tab === tabName)
    })

    logDebug('switchTab', '标签切换完成')
  } catch (error) {
    logError('switchTab', error)
  }
}

function switchFeature(featureName) {
  logDebug('switchFeature', `切换功能: ${featureName}`)

  try {
    featureButtons.forEach((btn) => {
      const isActive = btn.dataset.feature === featureName
      btn.classList.toggle('active', isActive)
      logDebug('switchFeature', `按钮 ${btn.dataset.feature}: ${isActive ? '激活' : '未激活'}`)
    })

    context.currentFeature = featureName
    logDebug('switchFeature', `当前功能已设置为: ${context.currentFeature}`)

    const template = PROMPT_TEMPLATES[featureName]
    updatePlaceholder(template)
  } catch (error) {
    logError('switchFeature', error)
  }
}

function updatePlaceholder(template) {
  logDebug('updatePlaceholder', `更新输入框占位符`)

  const placeholders = {
    CHAT: '请输入问题，选择功能后发送...',
    TRANSLATE: '请输入需要翻译的内容...',
    CODE_EXPLAIN: '请输入需要解释的代码...',
    SUMMARIZE: '请输入需要总结的文章...',
    POLISH: '请输入需要润色的段落...'
  }

  searchInput.placeholder = placeholders[context.currentFeature] || placeholders.CHAT
  logDebug('updatePlaceholder', `占位符已设置为: ${searchInput.placeholder}`)
}

function showErrorMessage(title, message) {
  logDebug('showErrorMessage', { title, message })

  try {
    const errorEl = document.createElement('div')
    errorEl.setAttribute('class', 'message-item error-message')
    errorEl.innerHTML = `
      <div class="message-header">
        <span class="message-role error-role">错误</span>
      </div>
      <div class="message-content error-content">
        <div class="error-title">${escapeHtml(title)}</div>
        <div class="error-detail">${escapeHtml(message)}</div>
      </div>
    `

    messageList.insertBefore(errorEl, messageList.firstElementChild)
    logDebug('showErrorMessage', '错误消息已添加到界面')
  } catch (error) {
    logError('showErrorMessage', error)
  }
}

async function replyProblem(bodyContentText = '') {
  logDebug('replyProblem', '开始处理请求...')

  const template = PROMPT_TEMPLATES[context.currentFeature]
  logDebug('replyProblem', {
    currentFeature: context.currentFeature,
    templateName: template ? template.name : '未知'
  })

  try {
    logDebug('replyProblem', '创建用户消息元素')
    const questionEl = document.createElement('div')
    questionEl.setAttribute('class', 'message-item question')
    questionEl.innerHTML = `
      <div class="message-header">
        <span class="message-role">用户</span>
        <span class="message-feature">${template ? template.icon : ''} ${template ? template.name : '未知'}</span>
      </div>
      <div class="message-content">${escapeHtml(context.searchContent)}</div>
    `

    logDebug('replyProblem', '插入用户消息到列表')
    messageList.insertBefore(questionEl, messageList.firstElementChild)

    logDebug('replyProblem', '创建 AI 消息元素')
    const answerEl = document.createElement('div')
    answerEl.setAttribute('class', 'message-item answer')
    answerEl.innerHTML = `
      <div class="message-header">
        <span class="message-role">AI</span>
      </div>
      <div class="message-content"><span class="loading-text">正在思考中...</span></div>
    `

    logDebug('replyProblem', '插入 AI 消息到列表')
    messageList.insertBefore(answerEl, messageList.firstElementChild)

    const contentEl = answerEl.querySelector('.message-content')
    logDebug('replyProblem', 'contentEl 元素:', !!contentEl)

    searchBtn.disabled = context.isReplyState = true
    logDebug('replyProblem', '设置回复状态，禁用发送按钮')

    let fullAnswer = ''

    try {
      logDebug('replyProblem', '调用 fetchOpenAIStreamReader')
      const reader = await fetchOpenAIStreamReader(
        context.searchContent,
        bodyContentText
      )

      logDebug('replyProblem', '移除加载文字，准备显示内容')
      contentEl.innerHTML = ''

      logDebug('replyProblem', '调用 handleStreamReaderAnswer 处理流式响应')
      await handleStreamReaderAnswer(contentEl, reader)

      fullAnswer = contentEl.innerText
      logDebug('replyProblem', `响应完成，内容长度: ${fullAnswer.length}`)

      if (fullAnswer) {
        logDebug('replyProblem', '保存历史记录')
        await saveHistory(context.searchContent, fullAnswer, context.currentFeature)
      } else {
        logDebug('replyProblem', '响应内容为空，不保存历史')
      }
    } catch (error) {
      logError('replyProblem - 请求过程', error)

      contentEl.innerHTML = ''
      showErrorMessage('请求失败', error.message || '未知错误')
    } finally {
      logDebug('replyProblem', '恢复状态，启用发送按钮')
      context.isReplyState = false
      searchBtn.disabled = context.isSearchInputEmpty
    }
  } catch (error) {
    logError('replyProblem - 整体错误', error)
    showErrorMessage('程序错误', error.message || '未知错误，请打开开发者工具查看详细日志')

    context.isReplyState = false
    searchBtn.disabled = context.isSearchInputEmpty
  }
}

function handleProblem() {
  logDebug('handleProblem', '处理用户请求')

  if (context.isSearchInputEmpty) {
    logDebug('handleProblem', '输入为空，不处理')
    return
  }

  context.searchContent = searchInput.value
  logDebug('handleProblem', `用户输入内容: ${context.searchContent.substring(0, 100)}...`)

  searchInput.value = ''
  context.isSearchInputEmpty = true

  if (context.config.READ_CONTEXT) {
    logDebug('handleProblem', '需要读取页面上下文，发送消息到 content script')
    try {
      chrome.tabs.sendMessage(context.currentTab.id, 'get body content text')
      logDebug('handleProblem', '消息已发送')
    } catch (error) {
      logError('handleProblem - 发送消息到 content script', error)
      showErrorMessage('通信错误', `无法获取页面内容: ${error.message}`)
      replyProblem('')
    }
  } else {
    logDebug('handleProblem', '不需要读取页面上下文，直接处理')
    replyProblem()
  }
}

function init() {
  logDebug('init', '初始化开始')

  try {
    logDebug('init', '获取当前标签页')
    chrome.tabs
      .query({ active: true, lastFocusedWindow: true })
      .then(([tab]) => {
        context.currentTab = tab
        logDebug('init', `当前标签页: ${tab ? tab.id : '未知'}`)
      })
      .catch((error) => {
        logError('init - 获取标签页', error)
      })

    logDebug('init', '加载存储配置')
    chrome.storage.local.get(Object.keys(context.config)).then((localValues) => {
      context.config.BASE_URL =
        localValues.BASE_URL ?? 'https://api.openai.com/v1'
      context.config.API_KEY = localValues.API_KEY ?? ''
      context.config.READ_CONTEXT = localValues.READ_CONTEXT ?? false
      context.config.MODEL = localValues.MODEL ?? 'gpt-3.5-turbo'

      logDebug('init', '配置加载完成:', {
        BASE_URL: context.config.BASE_URL,
        API_KEY: context.config.API_KEY ? '已设置' : '未设置',
        MODEL: context.config.MODEL,
        READ_CONTEXT: context.config.READ_CONTEXT
      })

      configInputs.forEach((el) => {
        el.value = context.config[el.dataset.name]

        el.addEventListener('change', (event) => {
          const name = event.target.dataset.name
          const value = event.target.value

          logDebug('init - 配置变更', { name, value: name === 'API_KEY' ? '******' : value })

          context.config[name] = value
          chrome.storage.local.set({ [name]: value })
        })
      })

      configCheckboxs.forEach((el) => {
        el.checked = context.config[el.dataset.name]

        el.addEventListener('change', (event) => {
          const name = event.target.dataset.name
          const value = event.target.checked

          logDebug('init - 复选框变更', { name, value })

          context.config[name] = value
          chrome.storage.local.set({ [name]: value })
        })
      })
    }).catch((error) => {
      logError('init - 加载存储配置', error)
    })

    loadHistory()

    logDebug('init', '绑定输入框事件')
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
          logDebug('init - 回车键触发')
          handleProblem()
        }
      }, 500)
    )

    logDebug('init', '绑定发送按钮事件')
    searchBtn.addEventListener('click', () => {
      logDebug('init - 发送按钮点击')
      handleProblem()
    })

    logDebug('init', `绑定功能按钮事件，按钮数量: ${featureButtons.length}`)
    featureButtons.forEach((btn) => {
      logDebug('init', `功能按钮: ${btn.dataset.feature}`)
      btn.addEventListener('click', () => {
        logDebug('init - 功能按钮点击', btn.dataset.feature)
        switchFeature(btn.dataset.feature)
      })
    })

    logDebug('init', `绑定标签按钮事件，按钮数量: ${tabButtons.length}`)
    tabButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        logDebug('init - 标签按钮点击', btn.dataset.tab)
        switchTab(btn.dataset.tab)
      })
    })

    logDebug('init', '绑定清空历史按钮事件')
    clearHistoryBtn.addEventListener('click', () => {
      logDebug('init - 清空历史按钮点击')
      if (context.history.length > 0 && confirm('确定要清空所有历史记录吗？')) {
        clearHistory()
      }
    })

    logDebug('init', '绑定历史列表点击事件')
    historyList.addEventListener('click', (e) => {
      const historyItem = e.target.closest('.history-item')
      if (!historyItem) return

      const item = context.history.find((h) => h.id === historyItem.dataset.id)
      if (!item) return

      if (e.target.closest('.view-btn')) {
        logDebug('init - 历史记录查看按钮点击', item.id)
        showHistoryDetail(item)
      } else if (e.target.closest('.delete-btn')) {
        logDebug('init - 历史记录删除按钮点击', item.id)
        if (confirm('确定要删除这条历史记录吗？')) {
          deleteHistoryItem(item.id)
        }
      }
    })

    logDebug('init', '绑定 content script 消息监听')
    chrome.runtime.onMessage.addListener(async (bodyContentText) => {
      logDebug('init - 收到 content script 消息', `内容长度: ${bodyContentText ? bodyContentText.length : 0}`)
      replyProblem(bodyContentText)
    })

    const defaultTemplate = PROMPT_TEMPLATES[context.currentFeature]
    updatePlaceholder(defaultTemplate)

    logDebug('init', '初始化完成！')
    console.log('[Page AI] ========================================')
    console.log('[Page AI] 插件已就绪，请在上方控制台查看调试日志')
    console.log('[Page AI] 如果遇到问题，请检查:')
    console.log('[Page AI] 1. Base URL 是否已配置')
    console.log('[Page AI] 2. API Key 是否已配置')
    console.log('[Page AI] 3. 模型名称是否正确')
    console.log('[Page AI] 4. 网络连接是否正常')
    console.log('[Page AI] ========================================')
  } catch (error) {
    logError('init - 初始化过程', error)
  }
}

logDebug('popup.js', '代码加载完成，调用 init()')
init()
