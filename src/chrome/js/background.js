import {
  asynchrome,
  errors,
  proxies,
  registry,
  sessions,
  settings,
  shortcuts,
} from './core'

window.censortracker = {
  proxies,
  registry,
  sessions,
  settings,
  shortcuts,
  errors,
  asynchrome,
}

let ignoredSitesTmp = new Set()
const isIgnoredWebsite = (hostname) =>
  ignoredSitesTmp.has(hostname)

const onBeforeRequest = ({ url }) => {
  const { hostname } = new URL(url)

  if (hostname.indexOf('google.com') !== -1) {
    return undefined
  }

  if (isIgnoredWebsite(hostname) || shortcuts.isSpecialPurposeHost(url)) {
    console.warn(`Ignoring host: ${url}`)
    return undefined
  }

  proxies.openPorts()
  return {
    redirectUrl: shortcuts.enforceHttps(url),
  }
}

const onErrorOccurred = async ({ url, error, tabId }) => {
  const errorCode = error.replace('net::', '')
  const { hostname } = new URL(url)
  const encodedUrl = window.btoa(url)

  const { ignoredSites, enableExtension } =
    await asynchrome.storage.local.get({
      ignoredSites: [],
      enableExtension: true,
    })

  if (!enableExtension) {
    return
  }

  if (shortcuts.isSpecialPurposeHost(url)) {
    return
  }

  if (errors.isThereProxyConnectionError(errorCode)) {
    chrome.tabs.update(tabId, {
      url: chrome.runtime.getURL('proxy_unavailable.html'),
    })
  }

  if (errors.isThereConnectionError(errorCode)) {
    console.warn('Possible DPI lock detected: reporting domain...')
    registry.addBlockedByDPI(hostname)
    proxies.setProxy()
    chrome.tabs.update(tabId, {
      url: chrome.runtime.getURL(`unavailable.html?${encodedUrl}`),
    })
  }

  if (!ignoredSites.includes(hostname)) {
    ignoredSites.push(hostname)
    await asynchrome.storage.local.set({ ignoredSites })
    console.warn(`Unable to redirect to HTTPS: ${hostname}`)
  }

  ignoredSitesTmp = new Set(ignoredSites)

  chrome.tabs.update(tabId, {
    url: url.replace('https:', 'http:'),
  })
}

const notificationOnButtonClicked = async (notificationId, buttonIndex) => {
  if (buttonIndex === 0) {
    const [tab] = await asynchrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    })

    const urlObject = new URL(tab.url)
    const hostname = urlObject.hostname

    const { mutedForever } = await asynchrome.storage.local.get({ mutedForever: [] })

    if (!mutedForever.find((item) => item === hostname)) {
      mutedForever.push(hostname)

      try {
        await asynchrome.storage.local.set({ mutedForever })
        console.warn(`We won't notify you about ${hostname} anymore`)
      } catch (error) {
        console.error(error)
      }
    }
  }
}

const updateTabState = async () => {
  const [tab] = await asynchrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  })

  if (!tab || !shortcuts.validURL(tab.url) || shortcuts.isSpecialPurposeHost(tab.url)) {
    return
  }

  const { enableExtension, ignoredSites } = await asynchrome.storage.local.get({
    enableExtension: true,
    ignoredSites: [],
  })

  if (!enableExtension) {
    settings.setDisableIcon(tab.id)
    return
  }

  const urlObject = new URL(tab.url)
  const currentHostname = shortcuts.cleanHostname(urlObject.hostname)

  if (ignoredSites.includes(currentHostname)) {
    console.warn(`Site ${currentHostname} found in ignore`)
    return
  }

  const { domainFound } = await registry.domainsContains(currentHostname)
  const { url: distributorUrl, cooperationRefused } =
    await registry.distributorsContains(currentHostname)

  if (domainFound) {
    settings.setDangerIcon(tab.id)
    return
  }

  if (distributorUrl) {
    settings.setDangerIcon(tab.id)
    if (!cooperationRefused) {
      await showCooperationAcceptedWarning(currentHostname)
    }
  }
}

const showCooperationAcceptedWarning = async (hostname) => {
  if (!hostname) {
    return
  }

  const { notifiedHosts, mutedForever } = await asynchrome.storage.local.get({
    notifiedHosts: [],
    mutedForever: [],
  })

  if (mutedForever.includes(hostname)) {
    return
  }

  if (!notifiedHosts.includes(hostname)) {
    await asynchrome.notifications.create({
      type: 'basic',
      title: settings.getName(),
      priority: 2,
      message: `${hostname} может передавать информацию третьим лицам.`,
      buttons: [
        { title: '\u2715 Не показывать для этого сайта' },
        { title: '\u2192 Подробнее' },
      ],
      iconUrl: settings.getDangerIcon(),
    })

    try {
      notifiedHosts.push(hostname)
      await asynchrome.storage.local.set({ notifiedHosts })
    } catch (error) {
      console.error(error)
    }
  }
}

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  chrome.declarativeContent.onPageChanged.removeRules(undefined, () => {
    chrome.declarativeContent.onPageChanged.addRules([{
      conditions: [
        new chrome.declarativeContent.PageStateMatcher({
          pageUrl: {
            schemes: ['http', 'https'],
          },
        }),
      ],
      actions: [new chrome.declarativeContent.ShowPageAction()],
    }])
  })

  if (reason === 'install') {
    console.log(`Installing ${settings.getName()}...`)
    const synced = await registry.syncDatabase()

    if (synced) {
      settings.enableExtension()
      await proxies.setProxy()
    }
  }
})

const onTabCreated = async (tab) => {
  const { enableExtension } =
    await asynchrome.storage.local.get({ enableExtension: true })

  if (enableExtension === false) {
    settings.setDisableIcon(tab.id)
  } else {
    settings.setDefaultIcon(tab.id)
  }
}

chrome.runtime.onStartup.addListener(async () => {
  await registry.syncDatabase()
  await updateTabState()
})

chrome.windows.onRemoved.addListener(async (_windowId) => {
  await asynchrome.storage.local.remove('notifiedHosts').catch(console.error)
  console.warn('A list of notified hosts has been cleaned up!')
})

chrome.proxy.onProxyError.addListener((details) => {
  console.error(`Proxy error: ${JSON.stringify(details)}`)
})

chrome.webRequest.onErrorOccurred.addListener(
  onErrorOccurred,
  {
    urls: ['http://*/*', 'https://*/*'],
    types: ['main_frame'],
  },
)

chrome.webRequest.onBeforeRequest.addListener(
  onBeforeRequest,
  {
    urls: ['http://*/*', 'https://*/*'],
    types: ['main_frame'],
  }, ['blocking'],
)

chrome.notifications.onButtonClicked.addListener(notificationOnButtonClicked)

chrome.tabs.onActivated.addListener(updateTabState)
chrome.tabs.onUpdated.addListener(updateTabState)
chrome.tabs.onCreated.addListener(onTabCreated)
