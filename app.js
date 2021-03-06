"use strict";
const HACKER_NEWS_API = "https://hacker-news.firebaseio.com/v0";
const HACKER_NEWS_ITEM = "https://news.ycombinator.com/item?id=";
const SEARCH = "https://hn.algolia.com/?q=";

const HIGHLIGHT_CLASS = "highlight";
const HIGHLIGHT_KEY = "highlight";
const LOADING_CLASS = "loading";
const CLUSTER_SIZE = 10;
const REFRESH_INTERVAL = 60000;

let refreshLoopId;

document.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);
  if (params.has("i")) localStorage.setItem(HIGHLIGHT_KEY, params.get("i"));
  refreshNewsList();
  refreshLoopId = setInterval(refreshNewsList, REFRESH_INTERVAL);
});

async function refreshNewsList() {
  const prevStoryType = localStorage.getItem("storyType");
  const storyType = prevStoryType !== null ? prevStoryType.replace("stories", "") : "top";
  highlight(document.getElementById(storyType));
  const storyIds = await fetch(`${HACKER_NEWS_API}/${storyType}stories.json?limitToFirst=30&orderBy="$priority"`)
    .then(fetchStatus)
    .then((response) => response.json());
  const prevHighlight = parseInt(localStorage.getItem(HIGHLIGHT_KEY));
  if (prevHighlight && !storyIds.includes(prevHighlight)) storyIds.push(prevHighlight);
  const items = await Promise.all(storyIds.map((id) => getItem(id)));
  const newsList = document.getElementById("news-list");
  newsList.innerHTML = "";
  items.forEach((item) => {
    const li = newsList.appendChild(document.createElement("li"));
    renderTitle(item, li);
    li.dataset.id = item.id;
    if (item.id === prevHighlight) li.classList.add(HIGHLIGHT_CLASS);
  });
}

document.getElementById("stories-picker").addEventListener("click", (event) => {
  if (event.target.tagName !== "A") return;
  const link = event.target;
  highlight(link);
  localStorage.setItem("storyType", link.id);
  refreshNewsList();
});

document.getElementById("news-list").addEventListener("click", (event) => {
  if (event.target.tagName !== "LI") return;
  document.getElementById("news").classList.add("hidden");
  const li = event.target;
  highlight(li);
  renderComments(li);
  clearInterval(refreshLoopId);
});

async function renderComments(li) {
  document.getElementById("contents").classList.remove("hidden");
  const comments = document.getElementById("comments");
  comments.innerText = "";
  const loader = document.getElementById("load-cluster");
  loader.classList.add("hidden");
  const itemId = li.dataset.id;
  localStorage.setItem(HIGHLIGHT_KEY, itemId);
  comments.classList.add(LOADING_CLASS);
  const item = await requestItem(itemId);
  renderTitle(item, li);
  renderHeader(item);
  comments.classList.remove(LOADING_CLASS);
  if (!("kids" in item)) return;
  renderCluster(item.kids, item.by, 0);
  cacheItem(item);

  async function renderCluster(kids, op, begin) {
    const end = begin + CLUSTER_SIZE;
    const currentCluster = kids.slice(begin, Math.min(end, kids.length));
    const cs = await Promise.all(currentCluster.map((id) => buildComment(id, op)));
    cs.filter((c) => c !== null).forEach((c) => comments.appendChild(c));
    if (end < kids.length) {
      loader.innerText = "Load more comments";
      loader.addEventListener("click", () => renderCluster(kids, op, end), { once: true });
      loader.classList.remove("hidden");
    } else {
      loader.classList.add("hidden");
    }
  }
}

function renderTitle(item, li) {
  if (item.type === "job") {
    li.innerHTML = `<a href="${item.url}" class="job">${item.title}</a>`;
  } else {
    li.innerText = item.title;
  }
}

function renderHeader(item) {
  const hostname = item.url ? new URL(item.url).hostname : undefined;
  document.getElementById(
    "header"
  ).innerHTML = `<p class="title-bar"><span><a onclick="closeComments()" class="pointer">&#x1f5d9;</a>&ensp;<a class='title ${
    item.type === "job" ? "job" : ""
  }' href="${item.url || HACKER_NEWS_ITEM + item.id}">${item.title}</a>${
    item.url ? ` <span class="host">[<a href="${SEARCH + hostname}">${hostname}</a>]</span>` : ""
  }</span><span class="right">${item.url ? `<a href="${SEARCH + item.url}">⧉</a>&nbsp;` : ""}<a href="${
    HACKER_NEWS_ITEM + item.id
  }">${item.descendants && item.descendants > 0 ? item.descendants : "—"}</a></span></p>${
    item.text ? `<article>${renderItemText(item, item.by)}</article>` : ""
  }`;
}

function renderItemText(item, op) {
  return `${item.text} [<a ${op === item.by ? 'class="op"' : ""} href="${HACKER_NEWS_ITEM + item.id}">${item.by}</a>]`;
}

async function buildComment(id, op, loadKidsNow) {
  const item = await getItem(id, (item) => item.time < Date.now() - 7.2e6);
  if (item === null || item.deleted || item.dead) return null;
  const comment = document.createElement("details");
  const commentText = comment.appendChild(document.createElement("summary"));
  commentText.innerHTML = renderItemText(item, op);
  if (!("kids" in item)) {
    comment.classList.add("empty");
  } else if (loadKidsNow) {
    renderChildComments(comment, op, item.kids);
  } else {
    comment.addEventListener("toggle", () => renderChildComments(comment, op, item.kids), { once: true });
  }
  return comment;
}

async function renderChildComments(comment, op, kids) {
  if (!Array.isArray(kids)) return;
  comment.classList.add(LOADING_CLASS);
  const cs = await Promise.all(kids.map((id) => buildComment(id, op, true)));
  comment.classList.remove(LOADING_CLASS);
  cs.filter((c) => c !== null).forEach((c) => {
    comment.appendChild(c);
    renderChildComments(c, op, c.kids);
  });
}

function highlight(candidate) {
  Array.from(candidate.parentElement.children)
    .filter((node) => node.tagName === candidate.tagName)
    .forEach((node) => node.classList.remove(HIGHLIGHT_CLASS));
  candidate.classList.add(HIGHLIGHT_CLASS);
}

// eslint-disable-next-line no-unused-vars
function closeComments() {
  document.getElementById("contents").classList.add("hidden");
  document.getElementById("news").classList.remove("hidden");
  refreshLoopId = setInterval(refreshNewsList, REFRESH_INTERVAL);
}

async function getItem(id, cachePredicate) {
  cachePredicate = Function(cachePredicate);
  const cached = sessionStorage.getItem(id);
  if (cached !== null) {
    let cachedItem = JSON.parse(cached);
    if (cachePredicate(cachedItem)) return cachedItem;
  }
  const requested = await requestItem(id);
  cacheItem(requested);
  return requested;
}

async function requestItem(id) {
  const fetchResponse = await fetch(`${HACKER_NEWS_API}/item/${id}.json`);
  const response = await fetchStatus(fetchResponse);
  return response.json();
}

function cacheItem(item) {
  if (item && item.id) sessionStorage.setItem(item.id, JSON.stringify(item));
}

function fetchStatus(response) {
  if (response.status >= 200 && response.status < 300) {
    return Promise.resolve(response);
  } else {
    return Promise.reject(new Error(response.statusText));
  }
}
