const API_KEY = ''

const searchInput = document.querySelector('.search-ipt')
const searchBtn = document.querySelector('.search-btn')

const messageList = document.querySelector('.message-list')

searchBtn.addEventListener('click', async () => {
  const searchContent = searchInput.value
  console.log('input', searchContent)

  const div = document.createElement('div')
  div.setAttribute('class', 'item')

  const aiResponseMessage = await fetchOpenAI(searchContent)

  console.log('searchContent', searchContent)
  console.log('aiResponseMessage', aiResponseMessage)

  div.innerText = aiResponseMessage
  messageList.insertBefore(div, messageList.firstElementChild)
})

async function fetchOpenAI(searchContent) {
  const bodyOptions = {
    model: 'gpt-3.5-turbo',
    messages: [
      { role: 'system', content: '你需要根据内容回答用户问题' },
      { role: 'user', content: searchContent }
    ],
    temperature: 0.1
  }

  try {
    const response = await fetch('', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`
      },
      method: 'post',
      body: JSON.stringify(bodyOptions)
    })

    const responseData = await response.json()

    const result = responseData.choices[0].message.content

    return result
  } catch (error) {
    console.log(`error: ${error.message}`)
  }
}
