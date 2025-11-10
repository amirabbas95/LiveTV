const AUTO_UPDATE_KEY = "autoUpdateEnabled";
const UPDATE_INTERVAL_KEY = "updateIntervalHours";
let autoUpdateInterval = null;
let isAutoUpdateEnabled = true;
let updateIntervalHours = 8;
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

// Storage Keys
const STORAGE_KEYS = {
  channels: "allChannelsData",
  live: "liveChannelsData",
  feeds: "rssFeedsData",
};

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
    url,
    isLive,
    timestamp: new Date().toISOString(),
  });

  try {
    const videoContainer = document.getElementById("player-container");
    const imageElement = document.getElementById("content-image");
    const videoTitleElement = document.getElementById("video-title");
    const channelInfoElement = document.getElementById("channel-description");

    lastFocusedElement = document.activeElement;

    const numberEl = document.getElementById("channel-number");
    if (numberEl) numberEl.textContent = number ? number + "." : "";

    // ✅ Clean up old player FIRST
    if (playerInstance) {
      playerInstance.dispose();
      playerInstance = null;
    }

    // Remove old video element
    const oldPlayerEl = document.getElementById("player");
    if (oldPlayerEl) {
      oldPlayerEl.remove();
    }

    // ✅ SHOW LOADING STATE
    showLoadingState(videoContainer, name);

    // Update overlay info
    if (imageElement) imageElement.src = image || "";
    if (videoTitleElement)
      videoTitleElement.textContent = name || "Unknown Channel";
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

    // ✅ Create new video element AFTER showing loading
    const newVideoEl = document.createElement("video");
    newVideoEl.id = "player";
    newVideoEl.className = "video-js vjs-default-skin";
    newVideoEl.controls = false;
    newVideoEl.preload = "auto";
    newVideoEl.setAttribute("data-setup", "{}");

    // ✅ CLEAR loading and add video element
    videoContainer.innerHTML = "";
    videoContainer.appendChild(newVideoEl);

    // ✅ Initialize Video.js AFTER element is in DOM
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
          modestbranding: 1,
        },
      },
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
    console.error("Failed to select channel:", error);
    showErrorToUser(`Failed to load ${name}`);
  }

  startWatching(name);
}

// ✅ Helper function for loading state
function showLoadingState(container, channelName) {
  const loadingDiv = document.createElement("div");
  loadingDiv.className = "loading-state";

  const spinner = document.createElement("div");
  spinner.className = "spinner";

  const text = document.createElement("p");
  text.textContent = `Loading ${channelName}...`;

  loadingDiv.appendChild(spinner);
  loadingDiv.appendChild(text);

  container.appendChild(loadingDiv); // ✅ APPEND, don't replace
}

function showErrorToUser(message) {
  const errorDiv = document.createElement("div");
  errorDiv.className = "error-notification";
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
  const playOverlay = document.createElement("div");
  playOverlay.className = "play-fallback-overlay";
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

  const playerContainer = document.getElementById("player-container");
  playerContainer.appendChild(playOverlay);

  playOverlay.querySelector(".play-button").addEventListener("click", () => {
    if (playerInstance) {
      playerInstance.play().catch((e) => {
        console.error("Still cannot play:", e);
      });
    }
    playOverlay.remove();
  });
}

function checkConnectionQuality() {
  if (!navigator.onLine) return;

  const start = Date.now();
  fetch("https://www.google.com/favicon.ico", {
    mode: "no-cors",
    cache: "no-cache",
  })
    .then(() => {
      const latency = Date.now() - start;
      if (latency > 2000) {
        showNetworkStatus("Poor connection detected", "warning");
      }
    })
    .catch(() => {});
}

function setupPlayerEventHandlers(name, isLive, isYouTube, currentSessionId) {
  if (!playerInstance) return;

  playerInstance.off("error");
  playerInstance.off("waiting");
  playerInstance.off("playing");
  playerInstance.off("loadedmetadata");

  playerInstance.on("error", function () {
    if (sessionId !== currentSessionId) return;

    const error = playerInstance.error();
    console.log("Player error:", error);
    if (navigator.onLine) attemptPlayerRecovery();
    else showNetworkStatus("Waiting for network connection...", "warning");
  });

  playerInstance.on("waiting", function () {
    if (sessionId !== currentSessionId) return;
    if (navigator.onLine) showNetworkStatus("Buffering...", "info");
  });

  playerInstance.on("playing", function () {
    if (sessionId !== currentSessionId) return;

    const existingStatus = document.querySelector(".network-status");
    if (existingStatus?.textContent.includes("Buffering")) {
      existingStatus.remove();
    }
  });

  playerInstance.on("loadedmetadata", function () {
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

  const currentSource = playerInstance.currentSrc();
  const message = `🔄 Attempting to recover streaming link... (${currentSource})`;

  console.log(message);
  log(message);
  showNetworkStatus("Attempting to recover streaming link...", "warning");

  setTimeout(() => {
    try {
      if (
        currentVideoUrl.includes("youtube.com") ||
        currentVideoUrl.includes("youtu.be")
      ) {
        console.log("YouTube stream detected, attempting full reload...");
        const currentItem = lastFocusedElement;
        if (currentItem && currentItem.dataset) {
          const { url, name, image, description, number, isLive } =
            currentItem.dataset;
          selectChannel(url, name, image, description, number, isLive);
        }
      } else {
        playerInstance.src({
          src: currentVideoUrl,
          type: playerInstance.currentType(),
        });
        playerInstance.load();
        playerInstance.play().catch((e) => {
          console.warn("Recovery play failed:", e);
          showNetworkStatus("Recovery failed", "error");
        });
      }
    } catch (error) {
      console.error("Recovery attempt failed:", error);
      showNetworkStatus("Recovery failed", "error");
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

  const watchData =
    JSON.parse(localStorage.getItem("watchTimePerChannel")) || {};

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
    if (e.target.classList.contains("favorite-icon")) {
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
    this.src = "fallback-image.png";
    this.alt = "Image not available";
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

  favoriteIcon.addEventListener("click", favoriteHandler);
  item._favoriteHandler = favoriteHandler;

  item.appendChild(wrapper);
  item.appendChild(favoriteIcon);

  return item;
}

function cleanupChannelItems() {
  allChannelItems.forEach((item) => {
    // Remove click handler
    if (item._clickHandler) {
      item.removeEventListener("click", item._clickHandler);
      item._clickHandler = null;
    }

    // Remove favorite handler
    const favoriteIcon = item.querySelector(".favorite-icon");
    if (favoriteIcon && item._favoriteHandler) {
      favoriteIcon.removeEventListener("click", item._favoriteHandler);
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
  console.log(
    `✅ Rendered ${channels.length} channels in ${currentSortMethod} view`
  );
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

    if (
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    ) {
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
          (currentFocusedIndex - 1 + allChannelItems.length) %
          allChannelItems.length;
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

  // ✅ Setup Settings Modal
  setupSettingsModal();

  let savedChannels = localStorage.getItem(STORAGE_KEYS.channels);

  if (savedChannels) {
    try {
      allChannels = JSON.parse(savedChannels);
      log(
        `Successfully loaded ${allChannels.length} channels from localStorage.`
      );
    } catch (e) {
      log(
        "Invalid 'allChannelsData' found in localStorage. The data will be ignored.",
        true
      );
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
    console.log("✅ Using stored API key");
  } else {
    console.log("ℹ️ No valid API key stored");
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
  // Load RSS feeds
  const storedFeeds = localStorage.getItem(STORAGE_KEYS.feeds);
  if (!storedFeeds) {
    showNotification("No RSS feeds found in localStorage.", "warning");
    return;
  }

  let feeds = [];
  try {
    feeds = JSON.parse(storedFeeds);
  } catch (error) {
    console.error("Failed to parse RSS feeds:", error);
    showNotification("Error loading RSS feeds data.", "error");
    return;
  }

  if (!feeds || feeds.length === 0) return;

  for (const [index, feed] of feeds.entries()) {
    try {
      if (index > 0) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      const cacheKey = `rss_${feed.url}`;
      const cached = rssCache.get(cacheKey);

      if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        log(`📦 Using cached data for ${feed.name}`);
        processRSSData(cached.data, feed);
        continue;
      }

      const feedUrl =
        "https://api.rss2json.com/v1/api.json?rss_url=" +
        encodeURIComponent(feed.url);
      const res = await fetch(feedUrl);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();

      rssCache.set(cacheKey, {
        data: data,
        timestamp: Date.now(),
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
    console.log("🔑 No valid API key found, prompting user...");
    showAPIKeyModal();
    return;
  }

  // Load live channels
  const storedLive = localStorage.getItem(STORAGE_KEYS.live);
  if (!storedLive) {
    showNotification("No live channels found in localStorage.", "warning");
    return;
  }

  let live = [];
  try {
    live = JSON.parse(storedLive);
  } catch (error) {
    console.error("Failed to parse live channels:", error);
    showNotification("Error loading live channels data.", "error");
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
        await new Promise((resolve) => setTimeout(resolve, 200));
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

      if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        log(`📦 Using cached live data for ${feed.name}`);
        cacheHits++;

        if (cached.data && cached.data.videoId) {
          const channelObj = youtubeItemToChannel(
            cached.data.videoId,
            cached.data.title,
            feed
          );
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
          log(
            "🚫 YouTube API quota exceeded (in response). Stopping live stream updates."
          );
          failedUpdates++;
          continue;
        }
        throw new Error(
          `YouTube API Error for ${feed.name}: ${data.error.message}`
        );
      }

      let cacheData = null;

      if (data.items && data.items.length > 0) {
        const item = data.items[0];
        const videoId = item.id.videoId;
        const title = item.snippet.title;

        cacheData = {
          videoId: videoId,
          title: title,
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
        timestamp: Date.now(),
      });
    } catch (e) {
      failedUpdates++;
      if (e.message.includes("quota exceeded") || e.message.includes("403")) {
        apiQuotaExceeded = true;
        log("🚫 YouTube API quota exceeded. Stopping live stream updates.");
      } else {
        log(`❌ Error loading live feed for ${feed.name}: ${e.message}`, true);
      }
    }
  }

  log(
    `Live streams update completed: ${successfulUpdates} successful, ${failedUpdates} failed, ${cacheHits} cache hits`
  );

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
    localStorage.setItem(STORAGE_KEYS.channels, JSON.stringify(allChannels));

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
    localStorage.setItem(STORAGE_KEYS.channels, JSON.stringify(allChannels));
    renderChannels(allChannels);
    updateFavoriteIcons();
    renderRecentlyWatched();
    updateAllChannelItems();

    return false;
  }
}

// ✅ Modified startChannelAutoUpdate function
function startChannelAutoUpdate() {
  // Load settings from localStorage
  const savedAutoUpdate = localStorage.getItem(AUTO_UPDATE_KEY);
  const savedInterval = localStorage.getItem(UPDATE_INTERVAL_KEY);

  isAutoUpdateEnabled =
    savedAutoUpdate === null ? true : savedAutoUpdate === "true";
  updateIntervalHours = savedInterval ? parseInt(savedInterval) : 8;

  // Calculate interval in milliseconds
  const intervalMs = updateIntervalHours * 60 * 60 * 1000;
  const cacheExpiryMs = updateIntervalHours * 60 * 60 * 1000;

  console.log(
    `Auto-update service initializing. Enabled: ${isAutoUpdateEnabled}, Interval: ${updateIntervalHours}h`
  );

  const checkAndUpdate = async () => {
    // Check if auto-update is still enabled
    if (!isAutoUpdateEnabled) {
      console.log("Auto-update is disabled. Skipping check.");
      return;
    }

    const lastUpdateTimestamp = parseInt(
      localStorage.getItem(CACHE_KEY) || "0"
    );
    const currentTime = Date.now();

    const timeSinceLastUpdate = currentTime - lastUpdateTimestamp;
    const shouldUpdate =
      lastUpdateTimestamp === 0 || timeSinceLastUpdate >= cacheExpiryMs;

    console.log(
      `[DEBUG] Last update: ${lastUpdateTimestamp}, Current: ${currentTime}, Time since: ${timeSinceLastUpdate}, Should update: ${shouldUpdate}`
    );

    if (shouldUpdate) {
      log("Cache has expired. Initiating full data update now.");

      try {
        const success = await loadAllChannelFeeds();

        if (success) {
          const newTimestamp = Date.now();
          localStorage.setItem(CACHE_KEY, newTimestamp.toString());

          const newLastUpdateDate = new Date(newTimestamp).toLocaleString();
          const newNextUpdateDate = new Date(
            newTimestamp + cacheExpiryMs
          ).toLocaleString();

          log("✅ Channels updated successfully.");
          log(`New Last Update Time: ${newLastUpdateDate}`);
          log(`Next Scheduled Check (Expiry): ${newNextUpdateDate}`);
        } else {
          log("❌ Update failed. Cache timestamp preserved for retry.", true);

          const retryTime = new Date(
            currentTime + 60 * 60 * 1000
          ).toLocaleString();
          log(`Next retry attempt after: ${retryTime}`);
        }
      } catch (error) {
        log(`❌ Unexpected error during update: ${error.message}`, true);
        log("Cache timestamp preserved for retry.");
      }
    } else {
      const timeRemaining = cacheExpiryMs - timeSinceLastUpdate;
      const minutesRemaining = Math.ceil(timeRemaining / (60 * 1000));
      const hoursRemaining = Math.floor(minutesRemaining / 60);
      const minsRemaining = minutesRemaining % 60;

      if (hoursRemaining > 0) {
        console.log(
          `Cache is valid. Expires in ${hoursRemaining}h ${minsRemaining}m`
        );
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
    const nextExpiry = initialLastUpdate + cacheExpiryMs;
    const nextUpdateDate = new Date(nextExpiry).toLocaleString();
    const timeRemaining = nextExpiry - Date.now();
    const minutesRemaining = Math.ceil(timeRemaining / (60 * 1000));

    log(`Last Update: ${lastUpdateDate}`);
    log(`Next update available after: ${nextUpdateDate}`);
    log(`Time remaining: ${minutesRemaining} minutes`);
  }

  // Run immediately if enabled
  if (isAutoUpdateEnabled) {
    checkAndUpdate();
  }

  // Store interval ID so we can clear it
  autoUpdateInterval = setInterval(checkAndUpdate, intervalMs);

  console.log(
    `Auto-update service started. Checking every ${updateIntervalHours} hours. Status: ${
      isAutoUpdateEnabled ? "Enabled" : "Disabled"
    }`
  );
}

function log(message, isError = false) {
  const logArea = document.getElementById("logArea");
  if (!logArea) return;

  const prefix = isError ? "Error: " : "Info: ";
  logArea.innerHTML += `<div class="${
    isError ? "text-red-400" : ""
  }">${prefix}[${new Date().toLocaleTimeString()}] ${message}</div>`;
  logArea.scrollTop = logArea.scrollHeight;
}

function updateOrAddChannel(channelObj) {
  const existingIndex = allChannels.findIndex(
    (ch) => ch.name === channelObj.name
  );
  if (existingIndex !== -1) {
    allChannels[existingIndex] = {
      ...allChannels[existingIndex],
      ...channelObj,
    };
  } else {
    allChannels.push(channelObj);
  }
}

function cleanup() {
  console.log("🧹 Performing cleanup...");

  stopWatching();
  stopAutoUpdateService(); // ✅ Stop auto-update service

  if (overlayTimeoutShow) clearTimeout(overlayTimeoutShow);
  if (overlayTimeoutHide) clearTimeout(overlayTimeoutHide);
  if (numberTimeout) clearTimeout(numberTimeout);
  if (navigationDebounce) clearTimeout(navigationDebounce);

  //cleanupChannelItems();

  if (playerInstance) {
    try {
      playerInstance.pause();
      playerInstance.off("error");
      playerInstance.off("waiting");
      playerInstance.off("playing");
      playerInstance.off("loadedmetadata");
      playerInstance.dispose();
    } catch (e) {
      console.warn("Error during player disposal:", e);
    }
    playerInstance = null;
  }

  const currentVideoElement = document.getElementById("player");
  if (currentVideoElement) {
    currentVideoElement.remove();
  }

  const videoContainer = document.getElementById("player-container");
  if (videoContainer) {
    videoContainer.innerHTML = "";
  }

  document
    .querySelectorAll(
      ".network-status, .error-notification, .play-fallback-overlay"
    )
    .forEach((el) => {
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

  let latestValid = data.items.find((item) => !item.link.includes("/shorts/"));
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

// ✅ Show API Key Modal (UPDATED)
function showAPIKeyModal() {
  const apiModal = document.getElementById("apiKeyModal");
  if (!apiModal) return;

  apiModal.style.display = "flex";

  const apiKeyInput = document.getElementById("apiKeyInput");
  if (apiKeyInput) {
    // Clear input or show masked existing key
    const existingKey = getStoredAPIKey();
    if (existingKey) {
      apiKeyInput.value = existingKey;
      apiKeyInput.type = "password";
    } else {
      apiKeyInput.value = "";
    }

    // Focus on input after a small delay for animation
    setTimeout(() => apiKeyInput.focus(), 100);
  }

  setupAPIKeyModalEvents();
}

// ✅ Hide API Key Modal (UPDATED)
function hideAPIKeyModal() {
  const apiModal = document.getElementById("apiKeyModal");
  if (apiModal) {
    apiModal.style.display = "none";
  }
}

// ✅ Setup API Key Modal Events (UPDATED)
function setupAPIKeyModalEvents() {
  const submitBtn = document.getElementById("submitApiKey");
  const skipBtn = document.getElementById("skipApiKey");
  const apiKeyInput = document.getElementById("apiKeyInput");
  const toggleVisibilityBtn = document.getElementById("toggleApiKeyVisibility");
  const apiModal = document.getElementById("apiKeyModal");

  // Remove existing listeners to prevent duplicates
  if (submitBtn) {
    const newSubmitBtn = submitBtn.cloneNode(true);
    submitBtn.parentNode.replaceChild(newSubmitBtn, submitBtn);

    newSubmitBtn.addEventListener("click", function () {
      const apiKey = apiKeyInput.value.trim();
      const remember = document.getElementById("rememberKey")?.checked;

      // Validate API key
      if (!apiKey) {
        apiKeyInput.classList.add("invalid");
        showNotification("Please enter a valid API key", "error");
        setTimeout(() => apiKeyInput.classList.remove("invalid"), 400);
        return;
      }

      // Basic validation - YouTube API keys are usually 39 characters
      if (apiKey.length < 30) {
        apiKeyInput.classList.add("invalid");
        showNotification("API key seems too short. Please check it.", "error");
        setTimeout(() => apiKeyInput.classList.remove("invalid"), 400);
        return;
      }

      if (remember) {
        saveAPIKey(apiKey);
      } else {
        API_KEY = apiKey;
      }

      hideAPIKeyModal();
      showNotification("✅ API Key saved successfully!", "success");

      // Start live feeds update after a short delay
      setTimeout(() => {
        log("🔄 Starting live feeds update with new API key...");
        loadYouTubeLiveFeeds().catch(console.error);
      }, 1000);
    });
  }

  if (skipBtn) {
    const newSkipBtn = skipBtn.cloneNode(true);
    skipBtn.parentNode.replaceChild(newSkipBtn, skipBtn);

    newSkipBtn.addEventListener("click", function () {
      hideAPIKeyModal();
      showNotification("⏭️ Live channels update skipped", "info");
      log("ℹ️ User skipped API key configuration");
    });
  }

  // Toggle password visibility
  if (toggleVisibilityBtn && apiKeyInput) {
    const newToggleBtn = toggleVisibilityBtn.cloneNode(true);
    toggleVisibilityBtn.parentNode.replaceChild(
      newToggleBtn,
      toggleVisibilityBtn
    );

    newToggleBtn.addEventListener("click", function () {
      if (apiKeyInput.type === "password") {
        apiKeyInput.type = "text";
        newToggleBtn.textContent = "🙈 Hide";
      } else {
        apiKeyInput.type = "password";
        newToggleBtn.textContent = "👁️ Show";
      }
    });
  }

  // Enter key to submit
  if (apiKeyInput) {
    apiKeyInput.addEventListener("keypress", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        document.getElementById("submitApiKey").click();
      }
    });
  }

  // Close on backdrop click
  if (apiModal) {
    apiModal.addEventListener("click", (e) => {
      if (e.target === apiModal) {
        hideAPIKeyModal();
      }
    });
  }

  // ESC key to close
  document.addEventListener("keydown", function escapeHandler(e) {
    if (e.key === "Escape" && apiModal.style.display === "flex") {
      hideAPIKeyModal();
      document.removeEventListener("keydown", escapeHandler);
    }
  });
}

// ✅ Add API Key management to Settings Modal
function showAPISettings() {
  showAPIKeyModal();
}

function showNotification(message, type = "info") {
  console.log(`📢 ${type.toUpperCase()}: ${message}`);
  log(message, type === "error");
}

function setupNetworkMonitoring() {
  window.addEventListener("online", handleNetworkRestored);
  window.addEventListener("offline", handleNetworkLost);
  setInterval(checkConnectionQuality, 30000);
}

function handleNetworkLost() {
  isOnline = false;
  console.log("📡 Network connection lost");

  if (playerInstance && !playerInstance.paused()) {
    playerInstance.pause();
    showNetworkStatus("Connection lost - video paused", "error");
  }
}

async function handleNetworkRestored() {
  isOnline = true;
  reconnectAttempts = 0;
  console.log("📡 Network connection restored");
  log("📡 Network connection restored");

  showNetworkStatus("Connection restored", "success");

  if (playerInstance && playerInstance.paused() && currentVideoUrl) {
    try {
      setTimeout(async () => {
        await playerInstance.play();
        showNetworkStatus("Resuming playback...", "success");
        log("▶️ Resuming playback after network recovery");
      }, 1000);
    } catch (error) {
      console.warn("Could not auto-resume playback:", error);
      log("❌ Could not auto-resume playback after network recovery");
      showPlayButtonFallback();
    }
  }
}

function showNetworkStatus(message, type = "info") {
  const existingStatus = document.querySelector(".network-status");
  if (existingStatus) {
    existingStatus.remove();
  }

  const statusDiv = document.createElement("div");
  statusDiv.className = `network-status ${type}`;
  statusDiv.textContent = message;
  statusDiv.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: ${
      type === "error" ? "#9b2c2c" : type === "warning" ? "#ef6c00" : "#3c6300"
    };
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
      statusDiv.style.opacity = "0";
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

window.addEventListener("beforeunload", cleanup);

document.addEventListener("visibilitychange", function () {
  if (document.hidden) {
    if (playerInstance && !playerInstance.paused()) {
      playerInstance.pause();
      console.log("Video paused due to tab switch");
    }
  }
});

// ✅ Show Settings Modal
function showSettingsModal() {
  const settingsModal = document.getElementById("settingsModal");
  if (!settingsModal) return;

  settingsModal.style.display = "flex";

  // Load current settings
  const autoUpdateToggle = document.getElementById("autoUpdateToggle");
  const updateIntervalSelect = document.getElementById("updateInterval");

  if (autoUpdateToggle) {
    autoUpdateToggle.checked = isAutoUpdateEnabled;
  }

  if (updateIntervalSelect) {
    updateIntervalSelect.value = updateIntervalHours.toString();
  }

  // ✅ Update description text when opening modal
  updateIntervalDescriptionText(updateIntervalHours);

  // Update last update display
  updateLastUpdateDisplay();
}

// ✅ Hide Settings Modal
function hideSettingsModal() {
  const settingsModal = document.getElementById("settingsModal");
  if (settingsModal) {
    settingsModal.style.display = "none";
  }
}

// ✅ Toggle Auto-Update
function toggleAutoUpdate(enabled) {
  isAutoUpdateEnabled = enabled;
  localStorage.setItem(AUTO_UPDATE_KEY, enabled.toString());

  if (enabled) {
    log("✅ Auto-update enabled");
    showNotification("Auto-update enabled", "success");

    // Restart auto-update service
    stopAutoUpdateService();
    startChannelAutoUpdate();
  } else {
    log("⏸️ Auto-update disabled");
    showNotification("Auto-update disabled", "info");
  }
}

// ✅ Change Update Interval (UPDATED)
function changeUpdateInterval(hours) {
  updateIntervalHours = parseInt(hours);
  localStorage.setItem(UPDATE_INTERVAL_KEY, hours.toString());

  // ✅ Update the description text dynamically
  updateIntervalDescriptionText(hours);

  log(`⏱️ Update interval changed to ${hours} hours`);
  showNotification(`Update interval set to ${hours} hours`, "success");

  // Restart auto-update service with new interval
  if (isAutoUpdateEnabled) {
    stopAutoUpdateService();
    startChannelAutoUpdate();
  }
}

// ✅ Manual Update
async function manualUpdate() {
  const manualUpdateBtn = document.getElementById("manualUpdateBtn");
  if (!manualUpdateBtn) return;

  // Disable button and show loading state
  manualUpdateBtn.disabled = true;
  const originalText = manualUpdateBtn.textContent;
  manualUpdateBtn.textContent = "Updating...";

  try {
    log("🔄 Manual update initiated...");

    const success = await loadAllChannelFeeds();

    if (success) {
      const newTimestamp = Date.now();
      localStorage.setItem(CACHE_KEY, newTimestamp.toString());

      log("✅ Manual update completed successfully");
      showNotification("Channels updated successfully!", "success");

      updateLastUpdateDisplay();
    } else {
      log("❌ Manual update failed", true);
      showNotification("Update failed. Please try again.", "error");
    }
  } catch (error) {
    log(`❌ Manual update error: ${error.message}`, true);
    showNotification("Update failed. Check console for details.", "error");
  } finally {
    // Re-enable button
    manualUpdateBtn.disabled = false;
    manualUpdateBtn.textContent = originalText;
  }
}

// ✅ Update Last Update Display
function updateLastUpdateDisplay() {
  const lastUpdate = parseInt(localStorage.getItem(CACHE_KEY) || "0");
  const lastUpdateEl = document.getElementById("lastUpdateDisplay");

  if (!lastUpdateEl) return;

  if (lastUpdate === 0) {
    lastUpdateEl.textContent = "Never updated";
    lastUpdateEl.style.color = "#ff9800";
  } else {
    const timeAgo = getTimeAgo(lastUpdate);
    const date = new Date(lastUpdate);
    const formattedDate = date.toLocaleString();

    lastUpdateEl.textContent = `Last updated: ${timeAgo} (${formattedDate})`;
    lastUpdateEl.style.color = "#4caf50";
  }
}

// ✅ Get Time Ago String
function getTimeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes > 1 ? "s" : ""} ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours > 1 ? "s" : ""} ago`;

  const days = Math.floor(hours / 24);
  return `${days} day${days > 1 ? "s" : ""} ago`;
}

// ✅ Stop Auto-Update Service
function stopAutoUpdateService() {
  if (autoUpdateInterval) {
    clearInterval(autoUpdateInterval);
    autoUpdateInterval = null;
    console.log("Auto-update service stopped");
  }
}

// ✅ Setup Settings Modal Event Listeners
function setupSettingsModal() {
  const settingsBtn = document.getElementById("settingsBtn");
  const closeSettings = document.getElementById("closeSettings");
  const settingsModal = document.getElementById("settingsModal");
  const autoUpdateToggle = document.getElementById("autoUpdateToggle");
  const updateIntervalSelect = document.getElementById("updateInterval");
  const manualUpdateBtn = document.getElementById("manualUpdateBtn");

  // Open settings
  if (settingsBtn) {
    settingsBtn.addEventListener("click", showSettingsModal);
  }

  // Close settings
  if (closeSettings) {
    closeSettings.addEventListener("click", hideSettingsModal);
  }

  // Close on backdrop click
  if (settingsModal) {
    settingsModal.addEventListener("click", (e) => {
      if (e.target === settingsModal) {
        hideSettingsModal();
      }
    });
  }

  // Auto-update toggle
  if (autoUpdateToggle) {
    autoUpdateToggle.addEventListener("change", (e) => {
      toggleAutoUpdate(e.target.checked);
    });
  }

  // Update interval change
  if (updateIntervalSelect) {
    updateIntervalSelect.addEventListener("change", (e) => {
      changeUpdateInterval(e.target.value);
    });
  }

  // Manual update button
  if (manualUpdateBtn) {
    manualUpdateBtn.addEventListener("click", manualUpdate);
  }

  // ✅ Set initial description text on page load
  updateIntervalDescriptionText(updateIntervalHours);

  // ✅ Manage API Key button
  const manageApiKeyBtn = document.getElementById("manageApiKeyBtn");
  if (manageApiKeyBtn) {
    manageApiKeyBtn.addEventListener("click", () => {
      hideSettingsModal(); // Close settings first
      setTimeout(showAPIKeyModal, 300); // Open API modal
    });
  }
}

// ✅ NEW FUNCTION: Update description text
function updateIntervalDescriptionText(hours) {
  const descriptionEl = document.getElementById("updateIntervalDescription");
  if (descriptionEl) {
    descriptionEl.textContent = `Automatically check for new content every ${hours} hour${
      hours > 1 ? "s" : ""
    }`;
  }
}
