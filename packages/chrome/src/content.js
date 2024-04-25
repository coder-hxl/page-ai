;(() => {
  chrome.runtime.onMessage.addListener(async (msg) => {
    console.log('content', msg)

    const bodyContentText = document.body.innerText
    chrome.runtime.sendMessage(bodyContentText)
  })
})()
