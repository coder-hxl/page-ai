import { debounce } from '../src/utils.js'

const configInputs = document.querySelectorAll('.config-input')
const configCheckboxs = document.querySelectorAll('.config-checkbox')

const searchInput = document.querySelector('.search-ipt')
const searchBtn = document.querySelector('.search-btn')
const messageList = document.querySelector('.message-list')

const context = {
  currentTab: null,
  searchContent: '',
  isReplyState: false,
  isSearchInputEmpty: true,

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

async function handleStreamReaderAnswer(el, reader) {
  const decoder = new TextDecoder()

  return reader.read().then(function pump({ done, value }) {
    if (done) return

    // 拿到当前切片的数据
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
  const result = {
    model: context.config.MODEL,
    messages: [],
    stream: true
  }

  if (context.config.READ_CONTEXT) {
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

    result.messages.push(
      { role: 'system', content: rule },
      { role: 'user', name: 'page-text', content: bodyContentText },
      { role: 'user', name: 'clien', content: searchContent }
    )
  } else {
    const rule = '你需要回答用户问题'

    result.messages.push(
      { role: 'system', content: rule },
      { role: 'user', content: searchContent }
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

async function replyProblem(bodyContentText = '') {
  const el = document.createElement('div')
  el.setAttribute('class', 'item')
  messageList.insertBefore(el, messageList.firstElementChild)

  searchBtn.disabled = context.isReplyState = true

  try {
    const reader = await fetchOpenAIStreamReader(
      context.searchContent,
      bodyContentText
    )
    await handleStreamReaderAnswer(el, reader)
  } catch (error) {
    el.innerText = `Error: ${error.message}`
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

  // 根据用户需要决定是否获取内容
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

  chrome.runtime.onMessage.addListener(async (bodyContentText) => {
    replyProblem(bodyContentText)
  })
}

init()
