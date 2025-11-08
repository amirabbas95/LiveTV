const MAX_RECENT = 18;
const favoritesKey = "favorites";
const recentlyWatchedKey = "recentlyWatched";
let allChannelItems = [];
let lastFocusedElement = null;
let currentSortMethod = "none";
let playerInstance = null;
let watchStartTime = 0;
let currentVideoUrl = "";
let overlayTimeoutShow;
let overlayTimeoutHide;
let isRecentOverlayActive = false;
let API_KEY = "";
const API_KEY_STORAGE_KEY = "youtube_api_key";

const CACHE_KEY = "lastChannelsUpdate";
const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 15 * 60 * 1000;
let allChannels = [];
let focusedIndex = 0;

let isOnline = navigator.onLine;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 3;

const rssCache = new Map();
const liveCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000;

let sessionId = Date.now();

const modal = document.getElementById("videoModal");
const qualityEl = document.getElementById("video-quality");

function extractYouTubeID(url) {
  const match = url.match(
    /(?:youtube\.com\/(?:.*v=|live\/|embed\/)|youtu\.be\/)([^&?/]+)/i
  );
  return match ? match[1] : null;
}

function selectChannel(url, name, image, description, number, isLive) {
  if (!url) return;

  const currentSessionId = Date.now();
  sessionId = currentSessionId;

  console.log(`🚀 START Session ${currentSessionId}: ${name}`, {
    url, isLive, timestamp: new Date().toISOString()
  });

  try {
    const videoContainer = document.getElementById("player-container");
    const imageElement = document.getElementById("content-image");
    const videoTitleElement = document.getElementById("video-title");
    const channelInfoElement = document.getElementById("channel-description");

    lastFocusedElement = document.activeElement;

    const numberEl = document.getElementById("channel-number");
    if (numberEl) numberEl.textContent = number ? number + "." : "";

    if (playerInstance) {
      playerInstance.dispose();
      playerInstance = null;
    }

    const oldPlayerEl = document.getElementById("player");
    if (oldPlayerEl) {
      oldPlayerEl.remove();
    }

    const newVideoEl = document.createElement("video");
    newVideoEl.id = "player";
    newVideoEl.className = "video-js vjs-default-skin";
    newVideoEl.controls = false;
    newVideoEl.preload = "auto";
    newVideoEl.setAttribute("data-setup", "{}");
    videoContainer.appendChild(newVideoEl);

    if (imageElement) imageElement.src = image || "";
    if (videoTitleElement) videoTitleElement.textContent = name || "Unknown Channel";
    if (channelInfoElement) channelInfoElement.textContent = description || "";
    if (qualityEl) qualityEl.textContent = "";

    showChannelInfoOverlay();

    let source;
    const isYouTube = extractYouTubeID(url);

    if (isYouTube) {
      source = { src: url, type: "video/youtube" };
    } else if (
      url.includes("imarkaz") ||
      url.endsWith(".mp4") ||
      url.endsWith(".mkv")
    ) {
      source = { src: url, type: "video/mp4" };
    } else {
      source = { src: url, type: "application/x-mpegURL" };
    }

    playerInstance = videojs("player", {
      techOrder: isYouTube ? ["youtube"] : ["html5"],
      sources: [source],
      autoplay: true,
      youtube: {
        ytControls: true,
        playerVars: {
          autoplay: 1,
          playsinline: 1,
          controls: 1,
          mute: 1,
          rel: 0,
          modestbranding: 1
        }
      }
    });

    playerInstance.ready(function () {
      if (sessionId !== currentSessionId) return;

      playerInstance.play().catch((e) => {
        console.warn("Autoplay blocked:", e);
        showPlayButtonFallback();
      });

      if (isYouTube) {
        const ytPlayer = playerInstance.tech().ytPlayer;
        if (ytPlayer && ytPlayer.addEventListener) {
          ytPlayer.addEventListener("onPlaybackQualityChange", (e) => {
            if (qualityEl) qualityEl.textContent = e.data;
          });
        }
      }
    });

    setupPlayerEventHandlers(name, isLive, isYouTube, currentSessionId);

  } catch (error) {
    console.error('Failed to select channel:', error);
    showErrorToUser(`Failed to load ${name}`);
  }

  startWatching(name);
}

function showErrorToUser(message) {
  const errorDiv = document.createElement('div');
  errorDiv.className = 'error-notification';
  errorDiv.textContent = message;
  errorDiv.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: #ff4444;
    color: white;
    padding: 12px;
    border-radius: 4px;
    z-index: 10000;
  `;

  document.body.appendChild(errorDiv);

  setTimeout(() => {
    if (errorDiv.parentNode) {
      errorDiv.parentNode.removeChild(errorDiv);
    }
  }, 5000);
}

function showPlayButtonFallback() {
  const playOverlay = document.createElement('div');
  playOverlay.className = 'play-fallback-overlay';
  playOverlay.innerHTML = `
    <button class="play-button" style="
      padding: 12px 24px;
      background: #ff0000;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 16px;
    ">Click to Play</button>
  `;

  const playerContainer = document.getElementById('player-container');
  playerContainer.appendChild(playOverlay);

  playOverlay.querySelector('.play-button').addEventListener('click', () => {
    if (playerInstance) {
      playerInstance.play().catch(e => {
        console.error('Still cannot play:', e);
      });
    }
    playOverlay.remove();
  });
}

function checkConnectionQuality() {
  if (!navigator.onLine) return;

  const start = Date.now();
  fetch('https://www.google.com/favicon.ico', {
    mode: 'no-cors',
    cache: 'no-cache'
  })
    .then(() => {
      const latency = Date.now() - start;
      if (latency > 2000) {
        showNetworkStatus('Poor connection detected', 'warning');
      }
    })
    .catch(() => { });
}

function setupPlayerEventHandlers(name, isLive, isYouTube, currentSessionId) {
  if (!playerInstance) return;

  playerInstance.off('error');
  playerInstance.off('waiting');
  playerInstance.off('playing');
  playerInstance.off('loadedmetadata');

  playerInstance.on('error', function () {
    if (sessionId !== currentSessionId) return;

    const error = playerInstance.error();
    console.log('Player error:', error);
    if (navigator.onLine) attemptPlayerRecovery();
    else showNetworkStatus('Waiting for network connection...', 'warning');
  });

  playerInstance.on('waiting', function () {
    if (sessionId !== currentSessionId) return;
    if (navigator.onLine) showNetworkStatus('Buffering...', 'info');
  });

  playerInstance.on('playing', function () {
    if (sessionId !== currentSessionId) return;

    const existingStatus = document.querySelector('.network-status');
    if (existingStatus?.textContent.includes('Buffering')) {
      existingStatus.remove();
    }
  });

  playerInstance.on('loadedmetadata', function () {
    if (sessionId !== currentSessionId) return;

    updateQualityDisplay();

    const isChannelLive = isLive === true || isLive === "true";
    if (!isChannelLive && !isYouTube) {
      playerInstance.controls(true);
    } else {
      playerInstance.controls(false);
    }
  });
}

function attemptPlayerRecovery() {
  if (!playerInstance || !currentVideoUrl) return;

  console.log('Attempting player recovery...');
  log('🔄 Attempting player recovery...');
  showNetworkStatus('Attempting to recover stream...', 'warning');

  setTimeout(() => {
    try {
      if (currentVideoUrl.includes('youtube.com') || currentVideoUrl.includes('youtu.be')) {
        console.log('YouTube stream detected, attempting full reload...');
        const currentItem = lastFocusedElement;
        if (currentItem && currentItem.dataset) {
          const { url, name, image, description, number, isLive } = currentItem.dataset;
          selectChannel(url, name, image, description, number, isLive);
        }
      } else {
        playerInstance.src({ src: currentVideoUrl, type: playerInstance.currentType() });
        playerInstance.load();
        playerInstance.play().catch(e => {
          console.warn('Recovery play failed:', e);
          showNetworkStatus('Recovery failed', 'error');
        });
      }
    } catch (error) {
      console.error('Recovery attempt failed:', error);
      showNetworkStatus('Recovery failed', 'error');
    }
  }, 2000);
}

function showChannelInfoOverlay() {
  const channelInfoOverlay = document.getElementById("channel-info-overlay");
  if (!channelInfoOverlay) return;

  clearTimeout(overlayTimeoutShow);
  clearTimeout(overlayTimeoutHide);

  if (modal) modal.style.display = "flex";

  channelInfoOverlay.classList.remove("show");

  overlayTimeoutShow = setTimeout(() => {
    channelInfoOverlay.classList.add("show");
  }, 300);

  overlayTimeoutHide = setTimeout(() => {
    channelInfoOverlay.classList.remove("show");
  }, 6000);
}

function startWatching(name) {
  currentVideoUrl = name;
  watchStartTime = Date.now();
}

function stopWatching() {
  if (!currentVideoUrl) return;

  const watchedMs = Date.now() - watchStartTime;
  const watchedSeconds = Math.floor(watchedMs / 1000);

  const watchData = JSON.parse(localStorage.getItem("watchTimePerChannel")) || {};

  if (!watchData[currentVideoUrl]) watchData[currentVideoUrl] = 0;
  watchData[currentVideoUrl] += watchedSeconds;

  localStorage.setItem("watchTimePerChannel", JSON.stringify(watchData));

  currentVideoUrl = "";
  watchStartTime = 0;
}

function loadWatchTime() {
  return JSON.parse(localStorage.getItem("watchTimePerChannel")) || {};
}

function sortChannelsByWatchTime(channels) {
  const watchData = loadWatchTime();
  return channels.slice().sort((a, b) => {
    const aTime = watchData[a.name] || 0;
    const bTime = watchData[b.name] || 0;
    return bTime - aTime;
  });
}

function updateQualityDisplay() {
  if (!playerInstance || !qualityEl) return;
  const height = playerInstance.videoHeight();
  qualityEl.textContent = height ? `${height}p` : "Auto";
}

function closeModal() {
  if (modal) modal.style.display = "none";
  cleanup();
  updateAllChannelItems();
}

function saveRecentlyWatched(channel) {
  const {
    name,
    url,
    image,
    description,
    number,
    isLive = "true",
    category = "Unknown",
  } = channel;

  let recent = JSON.parse(localStorage.getItem(recentlyWatchedKey) || "[]");

  recent = recent.filter((item) => item.url !== url);

  recent.unshift({
    name,
    url,
    image,
    description,
    number,
    isLive,
    category,
  });

  if (recent.length > MAX_RECENT) {
    recent.pop();
  }

  localStorage.setItem(recentlyWatchedKey, JSON.stringify(recent));
  renderRecentlyWatched();
}

function toggleFavorite(
  url,
  name,
  image,
  description,
  number,
  isLive,
  category,
  event
) {
  if (event) event.stopPropagation();

  let favorites = JSON.parse(localStorage.getItem(favoritesKey) || "[]");
  const index = favorites.findIndex((item) => item.url === url);

  if (index > -1) {
    favorites.splice(index, 1);
  } else {
    favorites.unshift({
      name,
      url,
      image,
      description,
      number,
      isLive,
      category,
    });
  }

  localStorage.setItem(favoritesKey, JSON.stringify(favorites));
  renderFavorites();
  updateFavoriteIcons();
  updateAllChannelItems();
}

function createChannelItem(channel) {
  const item = document.createElement("div");
  const numberText = channel.number ? channel.number : "";

  item.className = "content-card channel-item";
  item.setAttribute("tabindex", "0");
  item.dataset.url = channel.url;
  item.dataset.name = channel.name;
  item.dataset.image = channel.image;
  item.dataset.description = channel.description;
  item.dataset.number = numberText;
  item.dataset.isLive = channel.isLive;
  item.dataset.category = channel.category || "Unknown";

  // ✅ Create and store click handler
  const clickHandler = (e) => {
    if (e.target.classList.contains('favorite-icon')) {
      return; // Don't select channel when clicking favorite
    }
    selectChannel(
      channel.url,
      channel.name,
      channel.image,
      channel.description,
      channel.number,
      channel.isLive
    );
    saveRecentlyWatched(channel);
  };

  item.addEventListener("click", clickHandler);
  item._clickHandler = clickHandler;

  const wrapper = document.createElement("div");
  wrapper.className = "thumb-wrapper";

  const img = document.createElement("img");
  img.src = channel.image;
  img.alt = `${channel.name} Logo`;
  img.loading = "lazy";
  img.decoding = "async";
  img.onerror = function () {
    this.src = 'fallback-image.png';
    this.alt = 'Image not available';
  };

  const numberBadge = document.createElement("span");
  numberBadge.className = "channel-number";
  numberBadge.textContent = channel.number;

  if (channel.isLive === true || channel.isLive === "true") {
    const liveIndicator = document.createElement("img");
    liveIndicator.src = "live.webp";
    liveIndicator.alt = "Live";
    liveIndicator.className = "live-indicator";
    wrapper.appendChild(liveIndicator);
  }

  wrapper.appendChild(img);
  wrapper.appendChild(numberBadge);

  const favoriteIcon = document.createElement("span");
  favoriteIcon.className = "favorite-icon";
  favoriteIcon.textContent = "★";
  // ✅ Create and store favorite handler
  const favoriteHandler = (e) => {
    e.stopPropagation();
    toggleFavorite(
      channel.url,
      channel.name,
      channel.image,
      channel.description,
      channel.number,
      channel.isLive,
      channel.category,
      e
    );
  };

  favoriteIcon.addEventListener('click', favoriteHandler);
  item._favoriteHandler = favoriteHandler;

  item.appendChild(wrapper);
  item.appendChild(favoriteIcon);

  return item;
}

function cleanupChannelItems() {

  allChannelItems.forEach(item => {
    // Remove click handler
    if (item._clickHandler) {
      item.removeEventListener("click", item._clickHandler);
      item._clickHandler = null;
    }

    // Remove favorite handler
    const favoriteIcon = item.querySelector('.favorite-icon');
    if (favoriteIcon && item._favoriteHandler) {
      favoriteIcon.removeEventListener('click', item._favoriteHandler);
      item._favoriteHandler = null;
    }
  });

  allChannelItems = [];
}

function renderChannels(channels) {
  cleanupChannelItems();

  const mainContainer = document.getElementById("channels");
  if (!mainContainer) return;

  const existingGrids = mainContainer.querySelectorAll(".content-grid");
  const existingHeadings = mainContainer.querySelectorAll(
    "h2:not(.sort-container h2)"
  );

  const fragment = document.createDocumentFragment();

  existingGrids.forEach((grid) => grid.remove());
  existingHeadings.forEach((heading) => heading.remove());

  if (currentSortMethod === "none") {
    const categorizedChannels = channels.reduce((acc, channel) => {
      const category = channel.category || "Unknown";
      if (!acc[category]) acc[category] = [];
      acc[category].push(channel);
      return acc;
    }, {});

    for (const category in categorizedChannels) {
      const channelCount = categorizedChannels[category].length;
      const categoryHeading = document.createElement("h2");
      categoryHeading.textContent = `${category} (${channelCount})`;
      categoryHeading.className = "text-xl font-bold mt-6 mb-4 col-span-full";

      const categoryGrid = document.createElement("div");
      categoryGrid.className = "content-grid";

      if (
        categorizedChannels[category] &&
        categorizedChannels[category].length > 0
      ) {
        categorizedChannels[category].forEach((channel) => {
          const item = createChannelItem(channel);
          categoryGrid.appendChild(item);
        });
      }

      fragment.appendChild(categoryHeading);
      fragment.appendChild(categoryGrid);
    }

    mainContainer.appendChild(fragment);

  } else {
    const totalChannelCount = channels.length;
    const mainHeading = document.createElement("h2");
    mainHeading.textContent = `> Channels < (${totalChannelCount})`;
    mainHeading.className = "text-xl font-bold mt-6 mb-4 col-span-full";

    fragment.appendChild(mainHeading);

    const categoryGrid = document.createElement("div");
    categoryGrid.className = "content-grid";

    channels.forEach((channel) => {
      const item = createChannelItem(channel);
      categoryGrid.appendChild(item);
    });

    fragment.appendChild(categoryGrid);
    mainContainer.appendChild(fragment);
  }

  updateAllChannelItems();
  console.log(`✅ Rendered ${channels.length} channels in ${currentSortMethod} view`);
}

let numberBuffer = "";
let numberTimeout;

document.addEventListener("keydown", (e) => {
  if (e.key >= "0" && e.key <= "9") {
    numberBuffer += e.key;

    const overlay = document.getElementById("channel-number-overlay");
    if (overlay) {
      overlay.textContent = numberBuffer || "";
      overlay.style.display = "block";
    }

    clearTimeout(numberTimeout);
    numberTimeout = setTimeout(() => {
      if (overlay) overlay.style.display = "none";

      const channelNumber = parseInt(numberBuffer, 10);
      const channel = allChannels.find((c) => c.number === channelNumber);

      if (channel) {
        const index = allChannelItems.findIndex(
          (item) => parseInt(item.dataset.number, 10) === channelNumber
        );
        if (index !== -1) {
          focusedIndex = index;
          allChannelItems[focusedIndex].focus();
          allChannelItems[focusedIndex].scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        }

        selectChannel(
          channel.url,
          channel.name,
          channel.image,
          channel.description,
          channel.number,
          channel.isLive
        );
        saveRecentlyWatched(channel);
      }

      numberBuffer = "";
    }, 1000);
  }
});

function sortChannelsAndRender(sortMethod = "none") {
  let sortedChannels = [...allChannels];

  switch (sortMethod) {
    case "asc":
      sortedChannels.sort((a, b) => a.name.localeCompare(b.name));
      break;

    case "desc":
      sortedChannels.sort((a, b) => b.name.localeCompare(a.name));
      break;

    case "watchTime":
      sortedChannels = sortChannelsByWatchTime(allChannels);
      break;

    case "none":
    default:
      currentSortMethod = "none";
      renderChannels(allChannels);
      updateFavoriteIcons();
      updateAllChannelItems();
      return;
  }

  currentSortMethod = sortMethod;
  renderChannels(sortedChannels);
  updateFavoriteIcons();
  updateAllChannelItems();
}

function handleSortChange() {
  const sortDropdown = document.getElementById("sortChannels");
  if (!sortDropdown) return;

  const sortMethod = sortDropdown.value;

  localStorage.setItem("defaultSortMethod", sortMethod);

  sortChannelsAndRender(sortMethod);
}

function renderFavorites() {
  const container = document.getElementById("favoritesGrid");
  if (!container) return;

  const favorites = JSON.parse(localStorage.getItem(favoritesKey) || "[]");
  container.innerHTML = "";

  const favSection = document.getElementById("favorites");
  if (favorites.length === 0) {
    if (favSection) favSection.style.display = "none";
  } else {
    if (favSection) favSection.style.display = "grid";
    favorites.forEach((channel) => {
      const item = createChannelItem(channel);
      container.appendChild(item);
    });
  }
}

function renderRecentlyWatched() {
  const container = document.getElementById("recentlyWatchedGrid");
  if (!container) return;

  const recent = JSON.parse(localStorage.getItem(recentlyWatchedKey) || "[]");
  container.innerHTML = "";

  const recentSection = document.getElementById("recentlyWatched");
  if (recent.length === 0) {
    if (recentSection) recentSection.style.display = "none";
  } else {
    if (recentSection) recentSection.style.display = "grid";
    recent.forEach((channel) => {
      const item = createChannelItem(channel);
      container.appendChild(item);
    });
  }
}

function updateFavoriteIcons() {
  const favorites = JSON.parse(localStorage.getItem(favoritesKey) || "[]");
  const favoriteUrls = new Set(favorites.map((fav) => fav.url));
  document.querySelectorAll(".channel-item").forEach((item) => {
    const url = item.dataset.url;
    const icon = item.querySelector(".favorite-icon");
    if (icon) {
      if (favoriteUrls.has(url)) {
        icon.classList.add("active");
      } else {
        icon.classList.remove("active");
      }
    }
  });
}

function updateAllChannelItems() {
  allChannelItems = Array.from(document.querySelectorAll(".channel-item"));
}

function getGridColumns() {
  const grid = document.querySelector(".content-grid");
  if (!grid) return 1;

  const gridComputedStyle = window.getComputedStyle(grid);
  const gridTemplateColumns = gridComputedStyle.getPropertyValue(
    "grid-template-columns"
  );

  if (!gridTemplateColumns) return 1;

  const columnArray = gridTemplateColumns.split(" ");
  return columnArray.length;
}

let navigationDebounce;

document.addEventListener("keydown", (event) => {
  clearTimeout(navigationDebounce);

  navigationDebounce = setTimeout(() => {
    const GRID_COLUMNS = getGridColumns();
    const isModalOpen = modal && modal.style.display === "flex";
    let focusedElement = document.activeElement;
    let currentFocusedIndex = allChannelItems.findIndex(
      (item) => item === focusedElement
    );

    if (isModalOpen) {
      if (event.key === "Enter") {
        event.preventDefault();
        toggleFullscreen();
        return;
      }

      if (event.key === "Escape" || event.key === "ArrowLeft") {
        event.preventDefault();
        closeModal();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        showChannelInfoOverlay();
      } else if (
        ["ArrowUp", "ArrowDown", "PageUp", "PageDown"].includes(event.key)
      ) {
        event.preventDefault();
        if (!lastFocusedElement || allChannelItems.length === 0) return;

        const currentChannelIndex = allChannelItems.findIndex(
          (item) => item === lastFocusedElement
        );
        if (currentChannelIndex === -1) return;

        let newIndex = currentChannelIndex;
        if (event.key === "ArrowDown" || event.key === "PageDown") {
          newIndex = (currentChannelIndex + 1) % allChannelItems.length;
        } else if (event.key === "ArrowUp" || event.key === "PageUp") {
          newIndex =
            (currentChannelIndex - 1 + allChannelItems.length) %
            allChannelItems.length;
        }

        const newChannelCard = allChannelItems[newIndex];
        const {
          url,
          name,
          image,
          description,
          number,
          isLive = "false",
          category = "Unknown",
        } = newChannelCard.dataset;

        newChannelCard.scrollIntoView({ behavior: "smooth", block: "center" });
        selectChannel(url, name, image, description, number, isLive);
        saveRecentlyWatched({
          name,
          url,
          image,
          description,
          number,
          isLive,
          category,
        });

        lastFocusedElement = newChannelCard;
      }
      return;
    }

    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      if (allChannelItems.length === 0) return;

      if (currentFocusedIndex === -1) {
        allChannelItems[0].focus();
        allChannelItems[0].scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
        focusedIndex = 0;
        return;
      }

      let newIndex = currentFocusedIndex;
      if (event.key === "ArrowRight")
        newIndex = (currentFocusedIndex + 1) % allChannelItems.length;
      else if (event.key === "ArrowLeft")
        newIndex =
          (currentFocusedIndex - 1 + allChannelItems.length) % allChannelItems.length;
      else if (event.key === "ArrowDown")
        newIndex = Math.min(
          currentFocusedIndex + GRID_COLUMNS,
          allChannelItems.length - 1
        );
      else if (event.key === "ArrowUp")
        newIndex = Math.max(currentFocusedIndex - GRID_COLUMNS, 0);

      const newCard = allChannelItems[newIndex];
      newCard.focus();
      newCard.scrollIntoView({ behavior: "smooth", block: "center" });

      focusedIndex = newIndex;
      event.preventDefault();
    } else if (["PageUp", "PageDown", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      if (currentFocusedIndex === -1 && allChannelItems.length > 0) {
        allChannelItems[0].focus();
        allChannelItems[0].scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      } else {
        let newIndex = currentFocusedIndex;
        if (event.key === "PageUp") {
          newIndex = Math.max(currentFocusedIndex - GRID_COLUMNS, 0);
        } else if (event.key === "PageDown") {
          newIndex = Math.min(
            currentFocusedIndex + GRID_COLUMNS,
            allChannelItems.length - 1
          );
        } else if (event.key === "Home") {
          newIndex = 0;
        } else if (event.key === "End") {
          newIndex = allChannelItems.length - 1;
        }

        const newCard = allChannelItems[newIndex];
        newCard.focus();
        newCard.scrollIntoView({ behavior: "smooth", block: "center" });

        focusedIndex = newIndex;
      }
    } else if (event.key === "Enter" && currentFocusedIndex !== -1) {
      event.preventDefault();
      const card = allChannelItems[currentFocusedIndex];
      const {
        url,
        name,
        image,
        description,
        number,
        isLive = "false",
        category = "Unknown",
      } = card.dataset;

      card.scrollIntoView({ behavior: "smooth", block: "center" });
      selectChannel(url, name, image, description, number, isLive);
      saveRecentlyWatched({
        name,
        url,
        image,
        description,
        number,
        isLive,
        category,
      });
    }

  }, 50);
});

async function initialize() {
  const contentGrid = document.querySelector(".content-grid");
  const loadingElement = document.getElementById("loading-spinner");

  if (contentGrid) contentGrid.style.display = "none";
  if (loadingElement) loadingElement.style.display = "block";

  const closeBtn = document.querySelector(".closeModal");
  if (closeBtn) closeBtn.addEventListener("click", closeModal);

  if (modal) {
    modal.addEventListener("click", (event) => {
      if (event.target === modal) closeModal();
    });
  }

  setupNetworkMonitoring();

  const sortDropdown = document.getElementById("sortChannels");
  if (sortDropdown) {
    sortDropdown.addEventListener("change", handleSortChange);
  }

  let savedChannels = localStorage.getItem("allChannelsData");

  if (savedChannels) {
    try {
      allChannels = JSON.parse(savedChannels);
      log(`Successfully loaded ${allChannels.length} channels from localStorage.`);
    } catch (e) {
      log("Invalid 'allChannelsData' found in localStorage. The data will be ignored.", true);
      log(`Error details: ${e.message}`, true);
      console.warn("Invalid allChannelsData in localStorage, ignoring.", e);
      allChannels = [];
    }
  } else {
    log("No previous 'allChannelsData' found in localStorage. Starting fresh.");
    allChannels = [];
  }

  API_KEY = getStoredAPIKey();

  if (hasValidAPIKey()) {
    console.log('✅ Using stored API key');
  } else {
    console.log('ℹ️ No valid API key stored');
  }

  startChannelAutoUpdate();

  allChannels.forEach((ch, i) => {
    if (!ch.number) ch.number = i + 1;
  });

  loadWatchTime();

  const savedSort = localStorage.getItem("defaultSortMethod") || "none";
  sortChannelsAndRender(savedSort);
  if (sortDropdown) sortDropdown.value = savedSort;

  renderFavorites();
  renderRecentlyWatched();
  updateFavoriteIcons();
  updateAllChannelItems();

  if (loadingElement) loadingElement.style.display = "none";
  if (contentGrid) contentGrid.style.display = "grid";

  if (lastFocusedElement && lastFocusedElement.isConnected) {
    lastFocusedElement.focus();
  } else if (allChannelItems.length > 0) {
    allChannelItems[0].focus();
  }
}

function toggleFullscreen() {
  if (playerInstance) {
    if (playerInstance.isFullscreen()) {
      playerInstance.exitFullscreen();
    } else {
      playerInstance.requestFullscreen();
    }
  }
}

function extractChannelId(feedUrl) {
  const match = feedUrl.match(/channel_id=([^&]+)/);
  return match ? match[1] : null;
}

function youtubeItemToChannel(videoId, title, feed) {
  return {
    url: `https://www.youtube.com/watch?v=${videoId}`,
    name: feed.name,
    image: feed.image,
    category: feed.category || "> Person <",
    description: title,
  };
}

async function loadYouTubeLatestFeeds() {
  let feeds = [];

  try {
    const response = await fetch("feeds.json");
    feeds = await response.json();
  } catch (error) {
    console.error("Failed to load feeds.json:", error);
    return;
  }

  if (!feeds || feeds.length === 0) return;

  for (const [index, feed] of feeds.entries()) {
    try {
      if (index > 0) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      const cacheKey = `rss_${feed.url}`;
      const cached = rssCache.get(cacheKey);

      if (cached && (Date.now() - cached.timestamp < CACHE_DURATION)) {
        log(`📦 Using cached data for ${feed.name}`);
        processRSSData(cached.data, feed);
        continue;
      }

      const feedUrl = "https://api.rss2json.com/v1/api.json?rss_url=" + encodeURIComponent(feed.url);
      const res = await fetch(feedUrl);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();

      rssCache.set(cacheKey, {
        data: data,
        timestamp: Date.now()
      });

      processRSSData(data, feed);

    } catch (e) {
      log(`❌ Error loading RSS feed for ${feed.name}: ${e.message}`, true);
    }
  }
}

async function loadYouTubeLiveFeeds() {
  if (!API_KEY) {
    API_KEY = getStoredAPIKey();
  }

  if (!API_KEY || !hasValidAPIKey()) {
    console.log('🔑 No valid API key found, prompting user...');
    showAPIKeyModal();
    return;
  }

  let live = [];

  try {
    const response = await fetch("live.json");
    live = await response.json();
  } catch (error) {
    console.error("Failed to load live.json:", error);
    return;
  }

  if (!live || live.length === 0) return;

  let apiQuotaExceeded = false;
  let successfulUpdates = 0;
  let failedUpdates = 0;
  let cacheHits = 0;

  for (const [index, feed] of live.entries()) {
    try {
      if (index > 0) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      if (apiQuotaExceeded) {
        log(`⏸️ Skipping ${feed.name} - API quota exceeded`);
        failedUpdates++;
        continue;
      }

      const channelId = extractChannelId(feed.url);
      if (!channelId) {
        console.warn("No channelId found in feed:", feed.url);
        continue;
      }

      const cacheKey = `live_${channelId}`;
      const cached = liveCache.get(cacheKey);

      if (cached && (Date.now() - cached.timestamp < CACHE_DURATION)) {
        log(`📦 Using cached live data for ${feed.name}`);
        cacheHits++;

        if (cached.data && cached.data.videoId) {
          const channelObj = youtubeItemToChannel(cached.data.videoId, cached.data.title, feed);
          updateOrAddChannel(channelObj);
          successfulUpdates++;
        }
        continue;
      }

      const apiUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&eventType=live&type=video&order=date&maxResults=1&key=${API_KEY}`;
      const res = await fetch(apiUrl);

      if (!res.ok) {
        if (res.status === 403) {
          apiQuotaExceeded = true;
          log("🚫 YouTube API quota exceeded. Stopping live stream updates.");
          failedUpdates++;
          continue;
        } else if (res.status === 404) {
          log(`❌ Channel not found for ${feed.name}`);
          failedUpdates++;
          continue;
        }
        throw new Error(`API returned status ${res.status}: ${res.statusText}`);
      }

      const data = await res.json();

      if (data.error) {
        if (data.error.code === 403) {
          apiQuotaExceeded = true;
          log("🚫 YouTube API quota exceeded (in response). Stopping live stream updates.");
          failedUpdates++;
          continue;
        }
        throw new Error(`YouTube API Error for ${feed.name}: ${data.error.message}`);
      }

      let cacheData = null;

      if (data.items && data.items.length > 0) {
        const item = data.items[0];
        const videoId = item.id.videoId;
        const title = item.snippet.title;

        cacheData = {
          videoId: videoId,
          title: title
        };

        const channelObj = youtubeItemToChannel(videoId, title, feed);
        updateOrAddChannel(channelObj);
        successfulUpdates++;

        log(`✅ ${feed.name} Successfully updated`);
      } else {
        log(`ℹ️ No live stream found for ${feed.name}`);
        cacheData = null;
      }

      liveCache.set(cacheKey, {
        data: cacheData,
        timestamp: Date.now()
      });

    } catch (e) {
      failedUpdates++;
      if (e.message.includes('quota exceeded') || e.message.includes('403')) {
        apiQuotaExceeded = true;
        log("🚫 YouTube API quota exceeded. Stopping live stream updates.");
      } else {
        log(`❌ Error loading live feed for ${feed.name}: ${e.message}`, true);
      }
    }
  }

  log(`Live streams update completed: ${successfulUpdates} successful, ${failedUpdates} failed, ${cacheHits} cache hits`);

  if (successfulUpdates === 0 && failedUpdates > 0 && apiQuotaExceeded) {
    throw new Error("YouTube API quota exceeded - no live streams updated");
  }
}

async function loadAllChannelFeeds() {
  log("Starting full channel update (RSS and Live API)...");

  try {
    log("1/2: Loading latest uploads from RSS...");
    await loadYouTubeLatestFeeds();
    log("1/2: Latest uploads loaded successfully.");

    log("2/2: Loading live streams (YouTube API)...");
    await loadYouTubeLiveFeeds();
    log("2/2: Live streams loaded successfully.");

    log("Saving updated channel data to localStorage...");
    localStorage.setItem("allChannelsData", JSON.stringify(allChannels));

    log("Rendering UI and updating components...");
    renderChannels(allChannels);
    updateFavoriteIcons();
    renderRecentlyWatched();
    updateAllChannelItems();

    log("✅ Full channels update COMPLETE.");
    return true;

  } catch (e) {
    log(`❌ Critical error during full channel update: ${e.message}`, true);

    log("Updating UI with available data...");
    localStorage.setItem("allChannelsData", JSON.stringify(allChannels));
    renderChannels(allChannels);
    updateFavoriteIcons();
    renderRecentlyWatched();
    updateAllChannelItems();

    return false;
  }
}

function startChannelAutoUpdate() {
  console.log(`Auto-update service initializing. Check interval set to ${CHECK_INTERVAL_MS / 60000} minutes.`);

  const checkAndUpdate = async () => {
    const lastUpdateTimestamp = parseInt(localStorage.getItem(CACHE_KEY) || "0");
    const currentTime = Date.now();

    const timeSinceLastUpdate = currentTime - lastUpdateTimestamp;
    const shouldUpdate = lastUpdateTimestamp === 0 || timeSinceLastUpdate >= EIGHT_HOURS_MS;

    console.log(`[DEBUG] Last update: ${lastUpdateTimestamp}, Current: ${currentTime}, Time since: ${timeSinceLastUpdate}, Should update: ${shouldUpdate}`);

    if (shouldUpdate) {
      log("Cache has expired. Initiating full data update now.");

      try {
        const success = await loadAllChannelFeeds();

        if (success) {
          const newTimestamp = Date.now();
          localStorage.setItem(CACHE_KEY, newTimestamp.toString());

          const newLastUpdateDate = new Date(newTimestamp).toLocaleString();
          const newNextUpdateDate = new Date(newTimestamp + EIGHT_HOURS_MS).toLocaleString();

          log("✅ Channels updated successfully.");
          log(`New Last Update Time: ${newLastUpdateDate}`);
          log(`Next Scheduled Check (Expiry): ${newNextUpdateDate}`);
        } else {
          log("❌ Update failed. Cache timestamp preserved for retry.", true);

          const retryTime = new Date(currentTime + (60 * 60 * 1000)).toLocaleString();
          log(`Next retry attempt after: ${retryTime}`);
        }
      } catch (error) {
        log(`❌ Unexpected error during update: ${error.message}`, true);
        log("Cache timestamp preserved for retry.");
      }
    } else {
      const timeRemaining = EIGHT_HOURS_MS - timeSinceLastUpdate;
      const minutesRemaining = Math.ceil(timeRemaining / (60 * 1000));
      const hoursRemaining = Math.floor(minutesRemaining / 60);
      const minsRemaining = minutesRemaining % 60;

      if (hoursRemaining > 0) {
        console.log(`Cache is valid. Expires in ${hoursRemaining}h ${minsRemaining}m`);
      } else {
        console.log(`Cache is valid. Expires in ${minutesRemaining} minutes.`);
      }
    }
  };

  const initialLastUpdate = parseInt(localStorage.getItem(CACHE_KEY) || "0");
  if (initialLastUpdate === 0) {
    log("Last Update: Never. Starting initial data fetch now.");
  } else {
    const lastUpdateDate = new Date(initialLastUpdate).toLocaleString();
    const nextExpiry = initialLastUpdate + EIGHT_HOURS_MS;
    const nextUpdateDate = new Date(nextExpiry).toLocaleString();
    const timeRemaining = nextExpiry - Date.now();
    const minutesRemaining = Math.ceil(timeRemaining / (60 * 1000));

    log(`Last Update: ${lastUpdateDate}`);
    log(`Next update available after: ${nextUpdateDate}`);
    log(`Time remaining: ${minutesRemaining} minutes`);
  }

  checkAndUpdate();
  setInterval(checkAndUpdate, CHECK_INTERVAL_MS);

  console.log(`Auto-update service started. Checking every ${CHECK_INTERVAL_MS / 60000} minutes.`);
}

function log(message, isError = false) {
  const logArea = document.getElementById("logArea");
  if (!logArea) return;

  const prefix = isError ? "Error: " : "Info: ";
  logArea.innerHTML += `<div class="${isError ? "text-red-400" : ""}">${prefix}[${new Date().toLocaleTimeString()}] ${message}</div>`;
  logArea.scrollTop = logArea.scrollHeight;
}

function updateOrAddChannel(channelObj) {
  const existingIndex = allChannels.findIndex(ch => ch.name === channelObj.name);
  if (existingIndex !== -1) {
    allChannels[existingIndex] = { ...allChannels[existingIndex], ...channelObj };
  } else {
    allChannels.push(channelObj);
  }
}

function cleanup() {
  console.log("🧹 Performing cleanup...");

  stopWatching();

  if (overlayTimeoutShow) clearTimeout(overlayTimeoutShow);
  if (overlayTimeoutHide) clearTimeout(overlayTimeoutHide);
  if (numberTimeout) clearTimeout(numberTimeout);
  if (navigationDebounce) clearTimeout(navigationDebounce);


  if (playerInstance) {
    try {
      playerInstance.pause();
      playerInstance.off('error');
      playerInstance.off('waiting');
      playerInstance.off('playing');
      playerInstance.off('loadedmetadata');
      playerInstance.dispose();
    } catch (e) {
      console.warn('Error during player disposal:', e);
    }
    playerInstance = null;
  }

  const currentVideoElement = document.getElementById("player");
  if (currentVideoElement) {
    currentVideoElement.remove();
  }

  const videoContainer = document.getElementById("player-container");
  if (videoContainer) {
    videoContainer.innerHTML = '';
  }

    // Remove modal event listeners
  const closeBtn = document.querySelector(".closeModal");
  if (closeBtn) {
    closeBtn.removeEventListener("click", closeModal);
  }

  document.querySelectorAll('.network-status, .error-notification, .play-fallback-overlay').forEach(el => {
    el.remove();
  });

  if (lastFocusedElement && lastFocusedElement.isConnected) {
    lastFocusedElement.focus();
  } else if (allChannelItems.length > 0) {
    allChannelItems[0].focus();
  }


}

function processRSSData(data, feed) {
  if (!data.items || data.items.length === 0) return;

  let latestValid = data.items.find(
    (item) => !item.link.includes("/shorts/")
  );
  if (!latestValid) return;

  const videoId = extractYouTubeID(latestValid.link);
  if (!videoId) return;

  const channelObj = youtubeItemToChannel(videoId, latestValid.title, feed);
  updateOrAddChannel(channelObj);

  log(`✅ ${feed.name} Successfully updated`);
}

function saveAPIKey(apiKey) {
  if (apiKey && apiKey.trim()) {
    localStorage.setItem(API_KEY_STORAGE_KEY, btoa(apiKey.trim()));
    API_KEY = apiKey.trim();
    console.log("✅ API Key saved to localStorage");
    return true;
  }
  return false;
}

function getStoredAPIKey() {
  return localStorage.getItem(API_KEY_STORAGE_KEY) || "";
}

function hasValidAPIKey() {
  const storedKey = getStoredAPIKey();
  return storedKey && storedKey.length > 10;
}

function clearAPIKey() {
  localStorage.removeItem(API_KEY_STORAGE_KEY);
  API_KEY = "";
  console.log("🗑️ API Key cleared from localStorage");
}

function showAPIKeyModal() {
  const apiModal = document.getElementById('apiKeyModal');
  if (!apiModal) return;

  apiModal.style.display = 'flex';

  const apiKeyInput = document.getElementById('apiKeyInput');
  if (apiKeyInput) {
    apiKeyInput.focus();
  }

  setupAPIKeyModalEvents();
}

function hideAPIKeyModal() {
  const apiModal = document.getElementById('apiKeyModal');
  if (apiModal) {
    apiModal.style.display = 'none';
  }
}

function setupAPIKeyModalEvents() {
  const submitBtn = document.getElementById('submitApiKey');
  const skipBtn = document.getElementById('skipApiKey');
  const apiKeyInput = document.getElementById('apiKeyInput');

  if (submitBtn) {
    submitBtn.onclick = function () {
      const apiKey = apiKeyInput.value.trim();
      const remember = document.getElementById('rememberKey')?.checked;

      if (!apiKey) {
        alert('Please enter a valid API key');
        return;
      }

      if (remember) {
        saveAPIKey(apiKey);
      } else {
        API_KEY = apiKey;
      }

      hideAPIKeyModal();
      showNotification('API Key saved successfully!', 'success');

      setTimeout(() => {
        loadYouTubeLiveFeeds().catch(console.error);
      }, 1000);
    };
  }

  if (skipBtn) {
    skipBtn.onclick = function () {
      hideAPIKeyModal();
      showNotification('Live channels update skipped. You can add API key later.', 'info');
    };
  }

  if (apiKeyInput) {
    apiKeyInput.addEventListener('keypress', function (e) {
      if (e.key === 'Enter') {
        submitBtn.click();
      }
    });
  }
}

function showAPISettings() {
  const apiModal = document.getElementById('apiKeyModal');
  const apiKeyInput = document.getElementById('apiKeyInput');
  const rememberCheckbox = document.getElementById('rememberKey');

  if (apiModal && apiKeyInput) {
    const currentKey = getStoredAPIKey();
    apiKeyInput.value = currentKey ? '••••••••' : '';
    if (rememberCheckbox) rememberCheckbox.checked = true;

    apiModal.style.display = 'flex';
  }
}

function showNotification(message, type = 'info') {
  console.log(`📢 ${type.toUpperCase()}: ${message}`);
  log(message, type === 'error');
}

function setupNetworkMonitoring() {
  window.addEventListener('online', handleNetworkRestored);
  window.addEventListener('offline', handleNetworkLost);
  setInterval(checkConnectionQuality, 30000);
}

function handleNetworkLost() {
  isOnline = false;
  console.log('📡 Network connection lost');

  if (playerInstance && !playerInstance.paused()) {
    playerInstance.pause();
    showNetworkStatus('Connection lost - video paused', 'error');
  }
}

async function handleNetworkRestored() {
  isOnline = true;
  reconnectAttempts = 0;
  console.log('📡 Network connection restored');
  log('📡 Network connection restored');

  showNetworkStatus('Connection restored', 'success');

  if (playerInstance && playerInstance.paused() && currentVideoUrl) {
    try {
      setTimeout(async () => {
        await playerInstance.play();
        showNetworkStatus('Resuming playback...', 'success');
        log('▶️ Resuming playback after network recovery');
      }, 1000);
    } catch (error) {
      console.warn('Could not auto-resume playback:', error);
      log('❌ Could not auto-resume playback after network recovery');
      showPlayButtonFallback();
    }
  }
}

function showNetworkStatus(message, type = 'info') {
  const existingStatus = document.querySelector('.network-status');
  if (existingStatus) {
    existingStatus.remove();
  }

  const statusDiv = document.createElement('div');
  statusDiv.className = `network-status ${type}`;
  statusDiv.textContent = message;
  statusDiv.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: ${type === 'error' ? '#9b2c2c' : type === 'warning' ? '#ef6c00' : '#3c6300'};
    color: white;
    padding: 10px 20px;
    border-radius: 4px;
    z-index: 10001;
    font-weight: bold;
    transition: opacity 0.3s;
  `;

  document.body.appendChild(statusDiv);

  setTimeout(() => {
    if (statusDiv.parentNode) {
      statusDiv.style.opacity = '0';
      setTimeout(() => {
        if (statusDiv.parentNode) {
          statusDiv.parentNode.removeChild(statusDiv);
        }
      }, 300);
    }
  }, 3000);
}

window.addEventListener("DOMContentLoaded", async () => {
  await initialize();
});

window.addEventListener('beforeunload', cleanup);

document.addEventListener('visibilitychange', function () {
  if (document.hidden) {
    if (playerInstance && !playerInstance.paused()) {
      playerInstance.pause();
      console.log('Video paused due to tab switch');
    }
  }
});
