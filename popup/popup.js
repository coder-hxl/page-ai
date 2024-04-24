const configIpts = document.querySelectorAll('.config-ipt')

const searchInput = document.querySelector('.search-ipt')
const searchBtn = document.querySelector('.search-btn')
const messageList = document.querySelector('.message-list')

let currentTab = null
const config = {
  BASE_URL: '',
  API_KEY: ''
}
let searchContent = ''

init()
function init() {
  chrome.tabs
    .query({
      active: true,
      lastFocusedWindow: true
    })
    .then(([tab]) => (currentTab = tab))

  chrome.storage.local.get(['BASE_URL', 'API_KEY']).then((res) => {
    config.BASE_URL = res.BASE_URL ?? ''
    config.API_KEY = res.API_KEY ?? ''

    configIpts.forEach((item) => {
      const name = item.dataset.name
      if (name === 'BASE_URL') {
        item.value = config.BASE_URL
      } else {
        item.value = config.API_KEY
      }

      item.addEventListener('change', (evnet) => {
        const name = evnet.target.dataset.name
        const value = evnet.target.value

        chrome.storage.local.set({ [name]: value })
      })
    })
  })

  searchBtn.addEventListener('click', async () => {
    searchContent = searchInput.value

    chrome.tabs.sendMessage(currentTab.id, 'get body content text')
  })

  chrome.runtime.onMessage.addListener(async (bodyContentText) => {
    const el = document.createElement('div')
    el.setAttribute('class', 'item')
    messageList.insertBefore(el, messageList.firstElementChild)

    const reader = await fetchOpenAIStreamReader(searchContent, bodyContentText)
    await handleStreamReaderAnswer(el, reader)
  })
}

async function fetchOpenAIStreamReader(searchContent, bodyContentText) {
  console.log('searchContent', searchContent)
  console.log('bodyContentText', bodyContentText)

  const rule = `
    你需要基于名为page text提供的内容来回答名为 clien 的问题

    1.接收输入：接收名为page text的内容(body.innerText)和名为clien的问题。
    2.预处理：对body.innerText进行文本清理、分词和词性标注。
    3.问题分类：将clien的问题进行分类，确定其类型（如事实性、观点性等）。
    4.上下文分析：在body.innerText中查找与问题相关的段落或句子，并分析它们的上下文信    息。
    5.答案抽取或生成：根据问题的类型和上下文信息，抽取相关的答案片段或生成合适的回答。
    6.返回回答：将生成的回答返回给用户。
  `

  const Options = {
    model: 'gpt-3.5-turbo',
    messages: [
      { role: 'system', content: rule },
      { role: 'user', name: 'page-text', content: bodyContentText },
      { role: 'user', name: 'clien', content: searchContent }
    ],
    stream: true
  }

  try {
    const response = await fetch(`${config.BASE_URL}/chat/completions`, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.API_KEY}`
      },
      method: 'post',
      body: JSON.stringify(Options)
    })

    return response.body.getReader()
  } catch (error) {
    console.log(`fetchOpenAIStreamReader error: ${error.message}`)
  }
}

async function handleStreamReaderAnswer(el, reader) {
  const decoder = new TextDecoder()

  return reader.read().then(function pump({ done, value }) {
    if (done) return

    // 拿到当前切片的数据
    const text = decoder.decode(value)

    const values = handleOpenAIChunkData(text)

    values.forEach((itemText) => {
      const item = JSON.parse(itemText)

      if (item.choices[0].finish_reason === 'stop') return

      console.log(item)
      const content = item.choices[0].delta.content
      el.innerText += content
    })

    return reader.read().then(pump)
  })
}

function handleOpenAIChunkData(chunk) {
  const values = chunk
    .split('data: ')
    .filter((text) => text && !text.includes('DONE'))

  console.log(values)

  return values
}
