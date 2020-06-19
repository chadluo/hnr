'use strict'
const HACKER_NEWS_API = 'https://hacker-news.firebaseio.com/v0'
const HACKER_NEWS_ITEM = 'https://news.ycombinator.com/item?id='
const HIGHLIGHT = 'highlight'
const LOADING = 'loading'
const LOADING_TEXT = 'loading…'
const CLUSTER_SIZE = 10

const params = new URLSearchParams(window.location.search)
const COUNT = params.get('count') || 20

refreshNewsList(true)
setInterval(refreshNewsList, 60000)

async function refreshNewsList (alsoLoadComments) {
  const storyType = localStorage.getItem('storyType') || 'topstories'
  const link = document.getElementById(storyType)
  highlight(link)
  const storyIds = await fetch(`${HACKER_NEWS_API}/${storyType}.json?limitToFirst=${COUNT}&orderBy="$priority"`)
    .then(status)
    .then(json)
  const prevHighlight = parseInt(localStorage.getItem(HIGHLIGHT))
  if (prevHighlight && !storyIds.includes(prevHighlight)) storyIds.push(prevHighlight)
  const items = await Promise.all(storyIds.map(getItem))
  const news = document.getElementById('news-list')
  news.innerText = ''
  items.forEach((item) => {
    const li = news.appendChild(document.createElement('li'))
    li.innerText = item.title
    li.dataset.id = item.id
    if (item.id === prevHighlight) {
      li.classList.add(HIGHLIGHT)
      if (alsoLoadComments) renderNewsItem(li)
    }
  })
}

document.getElementById('stories-picker').addEventListener('click', (event) => {
  if (event.target.tagName !== 'A') return
  const link = event.target
  highlight(link)
  localStorage.setItem('storyType', link.id)
  refreshNewsList(false)
})

document.getElementById('news-list').addEventListener('click', (event) => {
  if (event.target.tagName !== 'LI') return
  const li = event.target
  highlight(li)
  renderNewsItem(li)
})

async function renderNewsItem (li) {
  const comments = document.getElementById('comments')
  comments.innerText = LOADING_TEXT
  const itemId = li.dataset.id
  localStorage.setItem(HIGHLIGHT, itemId)
  const item = await requestItem(itemId)
  li.innerText = item.title
  renderLinks(item)
  if (!('kids' in item)) {
    comments.innerText = ''
    return
  }
  comments.innerText = ''
  const loader = document.getElementById('load-cluster')
  renderCluster(item.kids, item.by, 0)
  async function renderCluster (kids, by, begin) {
    const end = begin + CLUSTER_SIZE
    const currentCluster = kids.slice(begin, Math.min(end, kids.length))
    const cs = await Promise.all(currentCluster.map((id) => requestComment(id, by, true)))
    cs.filter(notNull).forEach((c) => comments.appendChild(c))
    if (end < kids.length) {
      loader.innerText = 'Load more comments'
      loader.addEventListener('click', () => {
        loader.innerText = LOADING_TEXT
        renderCluster(kids, by, end)
      }, { once: true })
      loader.classList.remove('hidden')
    } else {
      loader.classList.add('hidden')
    }
  }
}

function renderLinks (item) {
  document.getElementById('links').innerHTML = `<a href="${item.url || HACKER_NEWS_ITEM + item.id}">${
    item.title
  }</a> | <a href="${HACKER_NEWS_ITEM + item.id}"> ${
    item.descendants && item.descendants > 0 ? item.descendants + '&nbsp;comments' : 'No comments yet'
  }`
}

async function requestComment (id, op, lazyLoad) {
  const item = await requestItem(id)
  if (item === null || item.deleted || item.dead) return null
  const comment = document.createElement('details')
  const commentText = comment.appendChild(document.createElement('summary'))
  commentText.innerHTML = `${item.text} [<a ${op === item.by ? "class='op'" : ''} href="${HACKER_NEWS_ITEM + id}">${
    item.by
  }</a>]`
  if (!('kids' in item)) {
    comment.classList.add('empty')
  } else if (lazyLoad) {
    comment.addEventListener('toggle', () => renderChildComments(comment, op, item.kids), { once: true })
  } else {
    renderChildComments(comment, op, item.kids)
  }
  return comment
}

async function renderChildComments (comment, op, kids) {
  if (!Array.isArray(kids)) return
  comment.classList.add(LOADING)
  const cs = await Promise.all(kids.map((id) => requestComment(id, op)))
  comment.classList.remove(LOADING)
  cs.filter(notNull).forEach((c) => {
    comment.appendChild(c)
    renderChildComments(c, op, c.kids)
  })
}

function highlight (node) {
  node.parentNode.childNodes.forEach((n) => {
    if (n.tagName === node.tagName) n.classList.remove(HIGHLIGHT)
  })
  node.classList.add(HIGHLIGHT)
}

function notNull (x) {
  return x !== null
}

async function getItem (id) {
  const cached = sessionStorage.getItem(id)
  if (cached !== null) {
    return JSON.parse(cached)
  } else {
    const requested = await requestItem(id)
    cacheItem(requested)
    return requested
  }
}

function requestItem (id) {
  return fetch(`${HACKER_NEWS_API}/item/${id}.json`).then(status).then(json)
}

function cacheItem (item) {
  if (item && item.id) {
    item.hnr_refresh = Date.now()
    sessionStorage.setItem(item.id, JSON.stringify(item))
  }
}

function status (response) {
  if (response.status >= 200 && response.status < 300) {
    return Promise.resolve(response)
  } else {
    return Promise.reject(new Error(response.statusText))
  }
}

function json (response) {
  return response.json()
}
