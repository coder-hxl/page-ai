const MENU_ITEMS = [
  { id: 'copy_content', title: '一键复制页面内容', contexts: ['all'] },
  { id: 'extract_keywords', title: '提取关键词', contexts: ['selection', 'all'] },
  { id: 'summarize', title: '文本精简', contexts: ['selection', 'all'] },
  { id: 'optimize', title: '语句优化', contexts: ['selection', 'all'] },
  { id: 'correct', title: '智能纠错', contexts: ['selection', 'all'] },
  { id: 'deduplicate', title: '内容去重', contexts: ['selection', 'all'] },
  { id: 'highlight', title: '重点标注', contexts: ['selection', 'all'] },
  { id: 'format', title: '格式规整', contexts: ['selection', 'all'] }
]

chrome.runtime.onInstalled.addListener(() => {
  MENU_ITEMS.forEach(item => {
    chrome.contextMenus.create({
      id: item.id,
      title: item.title,
      contexts: item.contexts
    })
  })
})

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const action = info.menuItemId
  const selectedText = info.selectionText || ''
  
  chrome.tabs.sendMessage(tab.id, {
    action: action,
    selectedText: selectedText
  })
})

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'copyToClipboard') {
    const text = request.text
    copyToClipboard(text).then(() => {
      sendResponse({ success: true })
    }).catch(err => {
      sendResponse({ success: false, error: err.message })
    })
    return true
  }
})

async function copyToClipboard(text) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (textToCopy) => {
        navigator.clipboard.writeText(textToCopy)
      },
      args: [text]
    })
    return true
  } catch (err) {
    console.error('Copy to clipboard failed:', err)
    throw err
  }
}
