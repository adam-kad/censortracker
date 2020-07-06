document.addEventListener('click', (event) => {
  const buyVpnUrl = 'https://vpnlove.me'

  chrome.tabs.query({ active: true, lastFocusedWindow: true }, ([tab]) => {
    const [, encodedHostname] = tab.url.split('?')

    if (event.target.matches('#extendProxyAutoConfig')) {
      const targetUrl = window.atob(encodedHostname)

      chrome.tabs.create({ url: targetUrl, index: tab.index }, () => {
        chrome.tabs.remove(tab.id)
      })
    }

    if (event.target.matches('#buyVPN')) {
      chrome.tabs.create({ url: buyVpnUrl })
    }

    if (event.target.matches('#closeTab')) {
      chrome.tabs.remove(tab.id)
    }
  })

  event.preventDefault()
}, false)

setTimeout(() => {
  const extendProxyButton = document.getElementById('extendProxyAutoConfig')

  if (extendProxyButton && extendProxyButton.classList.contains('btn-disabled')) {
    extendProxyButton.classList.remove('btn-disabled')
  }
}, 1350)
