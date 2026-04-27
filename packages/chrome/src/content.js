;(() => {
  const HIGHLIGHT_STYLE_ID = 'page-ai-highlight-style'
  const HIGHLIGHT_CLASS = 'page-ai-highlight'
  let highlightedElements = []

  function injectHighlightStyle() {
    if (document.getElementById(HIGHLIGHT_STYLE_ID)) return
    
    const style = document.createElement('style')
    style.id = HIGHLIGHT_STYLE_ID
    style.textContent = `
      .${HIGHLIGHT_CLASS} {
        background-color: #feba07 !important;
        color: #000 !important;
        border-radius: 3px;
        padding: 1px 3px;
        transition: all 0.3s ease;
      }
    `
    document.head.appendChild(style)
  }

  function extractPageContent() {
    let content = ''
    
    const selectors = [
      'article',
      'main',
      '[role="main"]',
      '.content',
      '.main-content',
      '#content',
      '#main-content',
      'body'
    ]
    
    for (const selector of selectors) {
      const element = document.querySelector(selector)
      if (element) {
        content = element.innerText || element.textContent
        if (content && content.trim().length > 100) {
          break
        }
      }
    }
    
    if (!content || content.trim().length < 100) {
      content = document.body.innerText || document.body.textContent
    }
    
    return cleanText(content)
  }

  function cleanText(text) {
    if (!text) return ''
    
    return text
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\r\n/g, '\n')
      .trim()
  }

  function getSelectedText() {
    const selection = window.getSelection()
    return selection ? selection.toString().trim() : ''
  }

  function highlightKeywords(keywords) {
    removeHighlights()
    injectHighlightStyle()
    
    if (!keywords || keywords.length === 0) return
    
    const keywordArray = Array.isArray(keywords) ? keywords : [keywords]
    const textNodes = getTextNodes(document.body)
    
    textNodes.forEach(node => {
      const text = node.textContent
      let hasMatch = false
      let newHtml = text
      
      keywordArray.forEach(keyword => {
        const regex = new RegExp(escapeRegExp(keyword), 'gi')
        if (regex.test(text)) {
          hasMatch = true
          newHtml = newHtml.replace(regex, `<span class="${HIGHLIGHT_CLASS}">${keyword}</span>`)
        }
      })
      
      if (hasMatch) {
        const wrapper = document.createElement('span')
        wrapper.innerHTML = newHtml
        
        const parent = node.parentNode
        parent.insertBefore(wrapper, node)
        parent.removeChild(node)
        
        const highlights = wrapper.querySelectorAll(`.${HIGHLIGHT_CLASS}`)
        highlights.forEach(el => highlightedElements.push({ element: el, originalText: text }))
      }
    })
    
    return highlightedElements.length > 0
  }

  function removeHighlights() {
    highlightedElements.forEach(({ element }) => {
      const parent = element.parentNode
      if (parent) {
        const text = document.createTextNode(element.textContent)
        parent.replaceChild(text, element)
        parent.normalize()
      }
    })
    highlightedElements = []
  }

  function getTextNodes(element) {
    const textNodes = []
    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          const parent = node.parentElement
          if (
            parent.tagName === 'SCRIPT' ||
            parent.tagName === 'STYLE' ||
            parent.tagName === 'NOSCRIPT' ||
            parent.tagName === 'IFRAME' ||
            parent.classList.contains(HIGHLIGHT_CLASS)
          ) {
            return NodeFilter.FILTER_REJECT
          }
          
          if (node.textContent.trim().length === 0) {
            return NodeFilter.FILTER_REJECT
          }
          
          return NodeFilter.FILTER_ACCEPT
        }
      }
    )
    
    let node
    while ((node = walker.nextNode())) {
      textNodes.push(node)
    }
    
    return textNodes
  }

  function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  function showNotification(message, type = 'info') {
    const notification = document.createElement('div')
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 12px 20px;
      border-radius: 8px;
      font-size: 14px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      z-index: 999999;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      transition: all 0.3s ease;
      max-width: 300px;
      word-wrap: break-word;
    `
    
    if (type === 'success') {
      notification.style.backgroundColor = '#4CAF50'
      notification.style.color = '#fff'
    } else if (type === 'error') {
      notification.style.backgroundColor = '#f44336'
      notification.style.color = '#fff'
    } else if (type === 'warning') {
      notification.style.backgroundColor = '#ff9800'
      notification.style.color = '#fff'
    } else {
      notification.style.backgroundColor = '#2196F3'
      notification.style.color = '#fff'
    }
    
    notification.textContent = message
    document.body.appendChild(notification)
    
    setTimeout(() => {
      notification.style.opacity = '0'
      notification.style.transform = 'translateX(100px)'
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification)
        }
      }, 300)
    }, 3000)
  }

  chrome.runtime.onMessage.addListener(async (msg, sender, sendResponse) => {
    try {
      let response = {}
      
      if (msg === 'get body content text') {
        const content = extractPageContent()
        chrome.runtime.sendMessage(content)
        return true
      }
      
      if (typeof msg === 'object' && msg.action) {
        const selectedText = msg.selectedText || getSelectedText()
        const pageContent = extractPageContent()
        
        switch (msg.action) {
          case 'get_page_content':
            response = {
              success: true,
              content: pageContent,
              url: window.location.href,
              title: document.title
            }
            break
            
          case 'get_selected_text':
            response = {
              success: true,
              content: selectedText || pageContent
            }
            break
            
          case 'highlight':
            const keywords = msg.keywords || []
            const highlighted = highlightKeywords(keywords)
            response = {
              success: true,
              highlighted: highlighted,
              count: highlightedElements.length
            }
            showNotification(`已高亮 ${highlightedElements.length} 个关键词`, 'success')
            break
            
          case 'remove_highlights':
            removeHighlights()
            response = { success: true }
            showNotification('已移除所有高亮', 'info')
            break
            
          case 'copy_content':
            const textToCopy = selectedText || pageContent
            try {
              await navigator.clipboard.writeText(textToCopy)
              response = { success: true }
              showNotification('内容已复制到剪贴板', 'success')
            } catch (err) {
              response = { success: false, error: err.message }
              showNotification('复制失败: ' + err.message, 'error')
            }
            break
            
          case 'notify':
            showNotification(msg.message, msg.type || 'info')
            response = { success: true }
            break
            
          default:
            response = { success: false, error: 'Unknown action' }
        }
      }
      
      if (sendResponse) {
        sendResponse(response)
      }
    } catch (error) {
      console.error('Content script error:', error)
      if (sendResponse) {
        sendResponse({ success: false, error: error.message })
      }
    }
    
    return true
  })
})()
