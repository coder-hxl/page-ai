import { debounce, PROMPT_TEMPLATES, HISTORY_CONFIG, formatTimestamp } from '../src/utils.js'

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

async function handleStreamReaderAnswer(el, reader) {
  const decoder = new TextDecoder()

  return reader.read().then(function pump({ done, value }) {
    if (done) return

    const text = decoder.decode(value)
    const values = transformOpenAIChunkToArr(text)

    if (values.length) {
      values.forEach((item) => {
        const choice = item.choices[0]

        if (choice.finish_reason === 'stop') return

        const content = choice.delta.content ?? ''
        el.innerText += content
      })
    }

    return reader.read().then(pump)
  })
}

function createOpenAIBodyStr(searchContent, bodyContentText = '') {
  const template = PROMPT_TEMPLATES[context.currentFeature]
  const result = {
    model: context.config.MODEL,
    messages: [],
    stream: true
  }

  if (context.config.READ_CONTEXT && bodyContentText) {
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
    const systemPrompt = template.systemPrompt
    const userContent = template.userPromptTemplate(searchContent)

    result.messages.push(
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent }
    )
  }

  return JSON.stringify(result)
}

async function fetchOpenAIStreamReader(searchContent, bodyContentText = '') {
  const response = await fetch(`${context.config.BASE_URL}/chat/completions`, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${context.config.API_KEY}`
    },
    method: 'post',
    body: createOpenAIBodyStr(searchContent, bodyContentText)
  })

  if (!response.ok) {
    throw new Error(`${response.status} - 网络响应不正常`)
  }

  return response.body.getReader()
}

function createMessageElement(question, answer, featureType = 'CHAT') {
  const template = PROMPT_TEMPLATES[featureType]
  const questionEl = document.createElement('div')
  questionEl.setAttribute('class', 'message-item question')
  questionEl.innerHTML = `
    <div class="message-header">
      <span class="message-role">用户</span>
      <span class="message-feature">${template.icon} ${template.name}</span>
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
  }

  await chrome.storage.local.set({ [HISTORY_CONFIG.STORAGE_KEY]: context.history })

  renderHistoryList()
}

async function loadHistory() {
  const result = await chrome.storage.local.get(HISTORY_CONFIG.STORAGE_KEY)
  context.history = result[HISTORY_CONFIG.STORAGE_KEY] || []
  renderHistoryList()
}

async function clearHistory() {
  context.history = []
  await chrome.storage.local.remove(HISTORY_CONFIG.STORAGE_KEY)
  renderHistoryList()
}

function renderHistoryList() {
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
        <span class="history-feature">${template.icon} ${template.name}</span>
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
}

function showHistoryDetail(item) {
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
}

async function deleteHistoryItem(id) {
  context.history = context.history.filter((item) => item.id !== id)
  await chrome.storage.local.set({ [HISTORY_CONFIG.STORAGE_KEY]: context.history })
  renderHistoryList()
}

function switchTab(tabName) {
  tabButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabName)
  })

  tabContents.forEach((content) => {
    content.classList.toggle('active', content.dataset.tab === tabName)
  })
}

function switchFeature(featureName) {
  featureButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.feature === featureName)
  })
  context.currentFeature = featureName

  const template = PROMPT_TEMPLATES[featureName]
  updatePlaceholder(template)
}

function updatePlaceholder(template) {
  const placeholders = {
    CHAT: '请输入问题，选择功能后发送...',
    TRANSLATE: '请输入需要翻译的内容...',
    CODE_EXPLAIN: '请输入需要解释的代码...',
    SUMMARIZE: '请输入需要总结的文章...',
    POLISH: '请输入需要润色的段落...'
  }
  searchInput.placeholder = placeholders[context.currentFeature] || placeholders.CHAT
}

async function replyProblem(bodyContentText = '') {
  const template = PROMPT_TEMPLATES[context.currentFeature]

  const questionEl = document.createElement('div')
  questionEl.setAttribute('class', 'message-item question')
  questionEl.innerHTML = `
    <div class="message-header">
      <span class="message-role">用户</span>
      <span class="message-feature">${template.icon} ${template.name}</span>
    </div>
    <div class="message-content">${escapeHtml(context.searchContent)}</div>
  `
  messageList.insertBefore(questionEl, messageList.firstElementChild)

  const answerEl = document.createElement('div')
  answerEl.setAttribute('class', 'message-item answer')
  answerEl.innerHTML = `
    <div class="message-header">
      <span class="message-role">AI</span>
    </div>
    <div class="message-content"></div>
  `
  messageList.insertBefore(answerEl, messageList.firstElementChild)

  const contentEl = answerEl.querySelector('.message-content')

  searchBtn.disabled = context.isReplyState = true

  let fullAnswer = ''

  try {
    const reader = await fetchOpenAIStreamReader(
      context.searchContent,
      bodyContentText
    )
    await handleStreamReaderAnswer(contentEl, reader)
    fullAnswer = contentEl.innerText

    await saveHistory(context.searchContent, fullAnswer, context.currentFeature)
  } catch (error) {
    contentEl.innerText = `Error: ${error.message}`
  } finally {
    context.isReplyState = false
    searchBtn.disabled = context.isSearchInputEmpty
  }
}

function handleProblem() {
  if (context.isSearchInputEmpty) return

  context.searchContent = searchInput.value
  searchInput.value = ''
  context.isSearchInputEmpty = true

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
      })
    })

    configCheckboxs.forEach((el) => {
      el.checked = context.config[el.dataset.name]

      el.addEventListener('change', (event) => {
        const name = event.target.dataset.name
        const value = event.target.checked

        context.config[name] = value
        chrome.storage.local.set({ [name]: value })
      })
    })
  })

  loadHistory()

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

  featureButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      switchFeature(btn.dataset.feature)
    })
  })

  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      switchTab(btn.dataset.tab)
    })
  })

  clearHistoryBtn.addEventListener('click', () => {
    if (context.history.length > 0 && confirm('确定要清空所有历史记录吗？')) {
      clearHistory()
    }
  })

  historyList.addEventListener('click', (e) => {
    const historyItem = e.target.closest('.history-item')
    if (!historyItem) return

    const item = context.history.find((h) => h.id === historyItem.dataset.id)
    if (!item) return

    if (e.target.closest('.view-btn')) {
      showHistoryDetail(item)
    } else if (e.target.closest('.delete-btn')) {
      if (confirm('确定要删除这条历史记录吗？')) {
        deleteHistoryItem(item.id)
      }
    }
  })

  chrome.runtime.onMessage.addListener(async (bodyContentText) => {
    replyProblem(bodyContentText)
  })

  const defaultTemplate = PROMPT_TEMPLATES[context.currentFeature]
  updatePlaceholder(defaultTemplate)
}

init()
