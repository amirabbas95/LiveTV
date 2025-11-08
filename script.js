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
// --- Configuration and Global State ---
const CACHE_KEY = "lastChannelsUpdate";
// 8 hours in milliseconds (8 * 60 * 60 * 1000)
const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;
// Check status every 15 minutes
const CHECK_INTERVAL_MS = 15 * 60 * 1000;
let allChannels = [];
let focusedIndex = 0;
// Network State Management
let isOnline = navigator.onLine;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 3;

const rssCache = new Map();
const liveCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

let sessionId = Date.now();

// Function to extract YouTube ID
function extractYouTubeID(url) {
  const match = url.match(
    /(?:youtube\.com\/(?:.*v=|live\/|embed\/)|youtu\.be\/)([^&?/]+)/i
  );
  return match ? match[1] : null;
}

// UI elements
const modal = document.getElementById("videoModal");
const qualityEl = document.getElementById("video-quality");

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

    // ✅ show channel number if available
    const numberEl = document.getElementById("channel-number");
    numberEl.textContent = number ? number + "." : "";


    // ✅ CLEAN UP PREVIOUS PLAYER COMPLETELY
    if (playerInstance) {
      playerInstance.dispose();
      playerInstance = null;
    }

    // Remove old video element
    const oldPlayerEl = document.getElementById("player");
    if (oldPlayerEl) {
      oldPlayerEl.remove();
    }


    // Create a new video element
    const newVideoEl = document.createElement("video");
    newVideoEl.id = "player";
    newVideoEl.className = "video-js vjs-default-skin";
    newVideoEl.controls = false;
    newVideoEl.preload = "auto";
    newVideoEl.setAttribute("data-setup", "{}");
    videoContainer.appendChild(newVideoEl);

    // Update overlay info
    imageElement.src = image || "";
    videoTitleElement.textContent = name || "Unknown Channel";
    channelInfoElement.textContent = description || "";
    document.getElementById("video-quality").textContent = "";

    // Animate the overlay
    showChannelInfoOverlay();

    let source;
    let techOrder;
    const isYouTube = extractYouTubeID(url);

    if (isYouTube) {
      source = { src: url, type: "video/youtube" };
      techOrder = ["youtube", "html5"];
    } else if (
      url.includes("imarkaz") ||
      url.endsWith(".mp4") ||
      url.endsWith(".mkv")
    ) {
      source = { src: url, type: "video/mp4" };
      techOrder = ["html5"];
    } else {
      source = { src: url, type: "application/x-mpegURL" };
      techOrder = ["html5"];
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
      playerInstance.play().catch((e) => {
        console.warn("Autoplay blocked:", e);
      });


      if (isYouTube) {
        const ytPlayer = playerInstance.tech().ytPlayer;
        ytPlayer.addEventListener("onPlaybackQualityChange", (e) => {
          document.getElementById("video-quality").textContent = e.data;
        });
      }
    });

        // ✅ SETUP ERROR HANDLING SEPARATELY (Clean approach)
    setupPlayerEventHandlers(name, isLive, isYouTube, currentSessionId);


  } catch (error) {

    console.error('Failed to select channel:', error);
    showErrorToUser(`Failed to load ${name}`);
  }


  startWatching(name);
}

function showErrorToUser(message) {
  // Create a simple error notification
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

  // Auto-remove after 5 seconds
  setTimeout(() => {
    if (errorDiv.parentNode) {
      errorDiv.parentNode.removeChild(errorDiv);
    }
  }, 5000);
}

function showPlayButtonFallback() {
  // Add a play button overlay when autoplay is blocked
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

  // Add click handler
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

  // Simple latency check
  const start = Date.now();
  fetch('https://www.google.com/favicon.ico', {
    mode: 'no-cors',
    cache: 'no-cache'
  })
    .then(() => {
      const latency = Date.now() - start;
      if (latency > 2000) { // 2 seconds threshold
        showNetworkStatus('Poor connection detected', 'warning');
      }
    })
    .catch(() => {
      // Silent fail
    });
}

function setupPlayerEventHandlers(name, isLive, isYouTube, sessionId) {
  if (!playerInstance) return;

  // Remove any existing handlers first
  playerInstance.off('error');
  playerInstance.off('waiting');
  playerInstance.off('playing');
  playerInstance.off('loadedmetadata');

  // Error handling
  playerInstance.on('error', function () {
    const error = playerInstance.error();
    console.log('Player error:', error);
    if (navigator.onLine) attemptPlayerRecovery();
    else showNetworkStatus('Waiting for network connection...', 'warning');
  });

  // Buffer monitoring
  playerInstance.on('waiting', function () {
    if (navigator.onLine) showNetworkStatus('Buffering...', 'info');
  });

  playerInstance.on('playing', function () {
    const existingStatus = document.querySelector('.network-status');
    if (existingStatus?.textContent.includes('Buffering')) {
      existingStatus.remove();
    }
  });

  // ✅ CORRECTED loadedmetadata handler
  playerInstance.on('loadedmetadata', function () {
    const currentSrc = playerInstance.currentSrc();
    const isChannelLive = isLive === true || isLive === "true";

    // ✅ MOVED INSIDE: Update quality display when metadata loads
    updateQualityDisplay();

    // Only set controls for non-live, non-YouTube streams
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
  
  // Strategy: Retry current source after delay
  setTimeout(() => {
    try {
      // For YouTube videos, sometimes we need to reload the entire player
      if (currentVideoUrl.includes('youtube.com') || currentVideoUrl.includes('youtu.be')) {
        console.log('YouTube stream detected, attempting full reload...');
        // Get the current channel info and re-select it
        const currentItem = lastFocusedElement;
        if (currentItem && currentItem.dataset) {
          const { url, name, image, description, number, isLive } = currentItem.dataset;
          selectChannel(url, name, image, description, number, isLive);
        }
      } else {
        // For other streams, try reloading the source
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

  // Clear any previous timers (avoid stacking multiple animations)
  clearTimeout(overlayTimeoutShow);
  clearTimeout(overlayTimeoutHide);

  // Make sure modal is visible
  modal.style.display = "flex";

  // Reset state
  channelInfoOverlay.classList.remove("show");

  // Show overlay with a delay
  overlayTimeoutShow = setTimeout(() => {
    channelInfoOverlay.classList.add("show");
  }, 300);

  // Auto-hide after 10s
  overlayTimeoutHide = setTimeout(() => {
    channelInfoOverlay.classList.remove("show");
  }, 6000);
}

// Start tracking watch time
function startWatching(name) {
  currentVideoUrl = name;  // ✅ Store channel name for tracking
  watchStartTime = Date.now();
}

// Stop tracking and save to localStorage
function stopWatching() {
  if (!currentVideoUrl) return;

  const watchedMs = Date.now() - watchStartTime;
  const watchedSeconds = Math.floor(watchedMs / 1000);

  const watchData = JSON.parse(localStorage.getItem("watchTimePerChannel")) || {};
  
  // ✅ Use channel name as key instead of URL
  if (!watchData[currentVideoUrl]) watchData[currentVideoUrl] = 0;
  watchData[currentVideoUrl] += watchedSeconds;

  localStorage.setItem("watchTimePerChannel", JSON.stringify(watchData));

  // Reset
  currentVideoUrl = "";
  watchStartTime = 0;
}

//Load watch time on page load
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
  const height = playerInstance.videoHeight();
  qualityEl.textContent = height ? `${height}p` : "Auto";
}

function closeModal() {
  modal.style.display = "none";
  cleanup(); // ✅ Good placement
  updateAllChannelItems(); // ✅ Good placement
}


function saveRecentlyWatched(channel) {
  // Destructure and set defaults for resilience.
  const {
    name,
    url,
    image,
    description,
    number,
    // Ensure isLive defaults to 'false' string if not present
    isLive = "true",
    // Ensure category defaults to 'Unknown' if not present
    category = "Unknown",
  } = channel;

  let recent = JSON.parse(localStorage.getItem(recentlyWatchedKey) || "[]");

  // Remove duplicate by URL
  recent = recent.filter((item) => item.url !== url);

  // Add the full channel object to the front
  recent.unshift({
    name,
    url,
    image,
    description,
    number,
    isLive,
    category,
  });

  // Limit list length
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
    // remove from favorites
    favorites.splice(index, 1);
  } else {
    // add with full object including channel number
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
}

function createChannelItem(channel) {
  const item = document.createElement("div");
  // Handle blank number (if undefined or null)
  const numberText = channel.number ? channel.number : "";

  item.className = "content-card channel-item";
  item.setAttribute("tabindex", "0");
  item.dataset.url = channel.url;
  item.dataset.name = channel.name;
  item.dataset.image = channel.image;
  item.dataset.description = channel.description;
  item.dataset.number = numberText; // ✅ store number in dataset
  item.dataset.isLive = channel.isLive;
  item.dataset.category = channel.category;

  item.addEventListener("click", () => {
    selectChannel(
      channel.url,
      channel.name,
      channel.image,
      channel.description,
      channel.number,
      channel.isLive
    );

    saveRecentlyWatched(channel);
  });

  // ✅ wrapper for image & number
  const wrapper = document.createElement("div");
  wrapper.className = "thumb-wrapper";

  const img = document.createElement("img");
  img.src = channel.image;
  img.alt = `${channel.name} Logo`;

  // ✅ Add error handling for broken images
  img.onerror = function () {
    this.src = 'fallback-image.png';
    this.alt = 'Image not available';
  };

  // ✅ number badge
  const numberBadge = document.createElement("span");
  numberBadge.className = "channel-number";
  numberBadge.textContent = channel.number;

  // ✅ live indicator
  if (channel.isLive === true || channel.isLive === "true") {
    const liveIndicator = document.createElement("img");
    liveIndicator.src = "live.webp";
    liveIndicator.alt = "Live";
    liveIndicator.className = "live-indicator";
    wrapper.appendChild(liveIndicator);
  }

  wrapper.appendChild(img);
  wrapper.appendChild(numberBadge);

  //const info = document.createElement("div");
  //info.className = "channel-name";

  //const nameSpan = document.createElement("h4");
  //nameSpan.textContent = channel.name;

  //info.appendChild(nameSpan);

  const favoriteIcon = document.createElement("span");
  favoriteIcon.className = "favorite-icon";
  favoriteIcon.textContent = "★";
  favoriteIcon.onclick = (e) =>
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

  item.appendChild(wrapper);
  item.appendChild(favoriteIcon);
  //item.appendChild(info);

  return item;
}


function cleanupChannelItems() {
  allChannelItems.forEach(item => {
    if (item._handlers) {
      item.removeEventListener("click", item._handlers.clickHandler);
      const favoriteIcon = item.querySelector('.favorite-icon');
      if (favoriteIcon && item._handlers.favoriteHandler) {
        favoriteIcon.removeEventListener('click', item._handlers.favoriteHandler);
      }
    }
  });
  allChannelItems = [];
}

function renderChannels(channels) {
  const mainContainer = document.getElementById("channels");
  const existingGrids = mainContainer.querySelectorAll(".content-grid");

  const existingHeadings = mainContainer.querySelectorAll(
    "h2:not(.sort-container h2)"
  );

  // ✅ Use DocumentFragment for batch DOM updates
  const fragment = document.createDocumentFragment();

  existingGrids.forEach((grid) => grid.remove());
  existingHeadings.forEach((heading) => heading.remove());

  if (currentSortMethod === "none") {
    const categorizedChannels = channels.reduce((acc, channel) => {
      const category = channel.category;
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
          const item = createChannelItem(channel); // use locked number
          categoryGrid.appendChild(item);
        });
      }

      fragment.appendChild(categoryHeading);
      fragment.appendChild(categoryGrid);
    }

    // ✅ APPEND FRAGMENT TO MAIN CONTAINER
    mainContainer.appendChild(fragment);

  } else {
    const totalChannelCount = channels.length;
    const mainHeading = document.createElement("h2");
    mainHeading.textContent = `> Channels < (${totalChannelCount})`;
    mainHeading.className = "text-xl font-bold mt-6 mb-4 col-span-full";

    // ✅ ADD HEADING TO FRAGMENT, NOT DIRECTLY TO CONTAINER
    fragment.appendChild(mainHeading);

    const categoryGrid = document.createElement("div");
    categoryGrid.className = "content-grid";

    channels.forEach((channel) => {
      const item = createChannelItem(channel); // use locked number
      categoryGrid.appendChild(item);
    });

    // ✅ ADD GRID TO FRAGMENT
    fragment.appendChild(categoryGrid);

    // ✅ APPEND FRAGMENT TO MAIN CONTAINER
    mainContainer.appendChild(fragment);
  }

  // ✅ UPDATE allChannelItems after rendering
  updateAllChannelItems();
  console.log(`✅ Rendered ${channels.length} channels in ${currentSortMethod} view`);
}

let numberBuffer = "";
let numberTimeout;

document.addEventListener("keydown", (e) => {
  if (e.key >= "0" && e.key <= "9") {
    numberBuffer += e.key;

    const overlay = document.getElementById("channel-number-overlay");
    overlay.textContent = numberBuffer || "";
    overlay.style.display = "block"; // show overlay

    clearTimeout(numberTimeout);
    numberTimeout = setTimeout(() => {
      overlay.style.display = "none"; // hide overlay

      const channelNumber = parseInt(numberBuffer, 10);
      const channel = allChannels.find((c) => c.number === channelNumber);

      if (channel) {
        // ✅ Focus the corresponding channel item
        const index = allChannelItems.findIndex(
          (item) => parseInt(item.dataset.number, 10) === channelNumber
        );
        if (index !== -1) {
          focusedIndex = index; // update global focusedIndex
          allChannelItems[focusedIndex].focus();
          allChannelItems[focusedIndex].scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        }

        // ✅ Play the channel
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

      numberBuffer = ""; // reset buffer
    }, 1000); // wait 1s for multi-digit numbers
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
      renderChannels(allChannels); // grouped by category
      updateFavoriteIcons();
      updateAllChannelItems();
      return;
  }

  currentSortMethod = sortMethod;
  renderChannels(sortedChannels); // flat sorted list
  updateFavoriteIcons();
  updateAllChannelItems();
}

function handleSortChange() {
  const sortMethod = document.getElementById("sortChannels").value;

  // ✅ Save choice to localStorage
  localStorage.setItem("defaultSortMethod", sortMethod);

  sortChannelsAndRender(sortMethod);
}

function renderFavorites() {
  const container = document.getElementById("favoritesGrid");
  const favorites = JSON.parse(localStorage.getItem(favoritesKey) || "[]");
  container.innerHTML = "";
  if (favorites.length === 0) {
    document.getElementById("favorites").style.display = "none";
  } else {
    document.getElementById("favorites").style.display = "grid";
    favorites.forEach((channel) => {
      const item = createChannelItem(channel);
      container.appendChild(item);
    });
  }
}

function renderRecentlyWatched() {
  const container = document.getElementById("recentlyWatchedGrid");
  const recent = JSON.parse(localStorage.getItem(recentlyWatchedKey) || "[]");
  container.innerHTML = "";
  if (recent.length === 0) {
    document.getElementById("recentlyWatched").style.display = "none";
  } else {
    document.getElementById("recentlyWatched").style.display = "grid";
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

function nextTrack() {
  if (playerInstance && playerInstance.tech().featuresVolumeControl) {
    playerInstance.tech().nextVideo();
  }
}

function previousTrack() {
  if (playerInstance && playerInstance.tech().featuresVolumeControl) {
    playerInstance.tech().previousVideo();
  }
}

// Main initialize function
async function initialize() {
  const contentGrid = document.querySelector(".content-grid");
  const loadingElement = document.getElementById("loading-spinner"); // Assume you have an element with this ID for your animation

  // 1. Show the loading animation and hide the grid
  if (contentGrid) contentGrid.style.display = "none";
  if (loadingElement) loadingElement.style.display = "block";

  // Modal controls
  document.querySelector(".closeModal").addEventListener("click", closeModal);
  document.getElementById("videoModal").addEventListener("click", (event) => {
    if (event.target === document.getElementById("videoModal")) closeModal();
  });

  // ADD NETWORK MONITORING HERE:
  setupNetworkMonitoring();

  // Sorting dropdown
  document
    .getElementById("sortChannels")
    .addEventListener("change", handleSortChange);

  // 2. Perform all the loading tasks
  let savedChannels = localStorage.getItem("allChannelsData");

  if (savedChannels) {
    try {
      allChannels = JSON.parse(savedChannels);
      log(
        `Successfully loaded ${allChannels.length} channels from localStorage.`
      );
    } catch (e) {
      // Log the error using your custom error handler
      log(
        "Invalid 'allChannelsData' found in localStorage. The data will be ignored.",
        true
      );
      log(`Error details: ${e.message}`, true);

      console.warn("Invalid allChannelsData in localStorage, ignoring.", e);
      allChannels = [];
    }
  } else {
    // Log if no data was found
    log("No previous 'allChannelsData' found in localStorage. Starting fresh.");
    allChannels = [];
  }

  // ✅ LOAD STORED API KEY AT STARTUP
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

  loadWatchTime?.();

  const savedSort = localStorage.getItem("defaultSortMethod") || "none";
  sortChannelsAndRender(savedSort);
  document.getElementById("sortChannels").value = savedSort;

    renderFavorites();
    renderRecentlyWatched();
    updateFavoriteIcons();
  updateAllChannelItems();

  // 3. Hide the loading animation and show the grid
  if (loadingElement) loadingElement.style.display = "none";
  if (contentGrid) contentGrid.style.display = "grid"; // Or "flex", or whatever your original display property is

  // 4. Focus first channel if available
  if (lastFocusedElement && lastFocusedElement.isConnected) {
    lastFocusedElement.focus();
  } else if (allChannelItems.length > 0) {
    allChannelItems[0].focus();
  }
}

function getGridColumns() {
  const grid = document.querySelector(".content-grid");
  if (!grid) {
    return 1;
  }

  const gridComputedStyle = window.getComputedStyle(grid);
  const gridTemplateColumns = gridComputedStyle.getPropertyValue(
    "grid-template-columns"
  );

  if (!gridTemplateColumns) {
    return 1;
  }

  // Split the computed style string by spaces to count the columns
  const columnArray = gridTemplateColumns.split(" ");
  return columnArray.length;
}

let navigationDebounce;

document.addEventListener("keydown", (event) => {
  // Clear the previous timeout
  clearTimeout(navigationDebounce);

  // Set new timeout - will only execute after 50ms of no keypresses
  navigationDebounce = setTimeout(() => {
    const GRID_COLUMNS = getGridColumns();
    const isModalOpen = modal.style.display === "flex";
    let focusedElement = document.activeElement;
    let focusedIndex = allChannelItems.findIndex(
      (item) => item === focusedElement
    );

    // --- IF MODAL IS OPEN ---
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

    // --- IF MODAL IS CLOSED (GRID NAVIGATION) ---
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      if (allChannelItems.length === 0) return;

      if (focusedIndex === -1) {
        allChannelItems[0].focus();
        allChannelItems[0].scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
        focusedIndex = 0;
        return;
      }

      let newIndex = focusedIndex;
      if (event.key === "ArrowRight")
        newIndex = (focusedIndex + 1) % allChannelItems.length;
      else if (event.key === "ArrowLeft")
        newIndex =
          (focusedIndex - 1 + allChannelItems.length) % allChannelItems.length;
      else if (event.key === "ArrowDown")
        newIndex = Math.min(
          focusedIndex + GRID_COLUMNS,
          allChannelItems.length - 1
        );
      else if (event.key === "ArrowUp")
        newIndex = Math.max(focusedIndex - GRID_COLUMNS, 0);

      const newCard = allChannelItems[newIndex];
      newCard.focus();
      newCard.scrollIntoView({ behavior: "smooth", block: "center" });

      focusedIndex = newIndex;
      event.preventDefault();
    } else if (["PageUp", "PageDown", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      if (focusedIndex === -1 && allChannelItems.length > 0) {
        allChannelItems[0].focus();
        allChannelItems[0].scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      } else {
        let newIndex = focusedIndex;
        if (event.key === "PageUp") {
          newIndex = Math.max(focusedIndex - GRID_COLUMNS, 0);
        } else if (event.key === "PageDown") {
          newIndex = Math.min(
            focusedIndex + GRID_COLUMNS,
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
    } else if (event.key === "Enter" && focusedIndex !== -1) {
      event.preventDefault();
      const card = allChannelItems[focusedIndex];
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

  }, 50); // Wait 50ms after last keypress
});

window.addEventListener("DOMContentLoaded", async () => {
  await initialize();
});

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

// === Convert item (RSS or API) into channel object ===
function youtubeItemToChannel(videoId, title, feed) {
  return {
    url: `https://www.youtube.com/watch?v=${videoId}`,
    name: feed.name,
    image: feed.image,
    category: feed.category || "> Person <",
    description: title,
  };
}

/* ----------------------------------------------------
   📌 1. Load latest uploads (via RSS)
   ---------------------------------------------------- */
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
      // ⭐ RATE LIMITING: Add 100ms delay between requests
      if (index > 0) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      // ✅ CHECK CACHE FIRST
      const cacheKey = `rss_${feed.url}`;
      const cached = rssCache.get(cacheKey);

      if (cached && (Date.now() - cached.timestamp < CACHE_DURATION)) {
        // Use cached data
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

      // ✅ STORE IN CACHE
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

/* ----------------------------------------------------
   📌 2. Load live streams (via YouTube API v3)
   ---------------------------------------------------- */

async function loadYouTubeLiveFeeds() {
  // ✅ CHECK FOR API KEY FIRST
  if (!API_KEY) {
    API_KEY = getStoredAPIKey();
  }

  if (!API_KEY || !hasValidAPIKey()) {
    console.log('🔑 No valid API key found, prompting user...');
    showAPIKeyModal();
    return; // Stop execution until API key is provided
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
      // ⭐ RATE LIMITING: Add 200ms delay for YouTube API
      if (index > 0) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      // ✅ STOP if API quota exceeded
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

      // ✅ CHECK CACHE FIRST - USING liveCache
      const cacheKey = `live_${channelId}`;
      const cached = liveCache.get(cacheKey);

      if (cached && (Date.now() - cached.timestamp < CACHE_DURATION)) {
        // Use cached data
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
          // ✅ MARK quota exceeded and skip remaining channels
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

      // Check for YouTube API specific errors
      if (data.error) {
        if (data.error.code === 403) {
          apiQuotaExceeded = true;
          log("🚫 YouTube API quota exceeded (in response). Stopping live stream updates.");
          failedUpdates++;
          continue;
        }
        throw new Error(`YouTube API Error for ${feed.name}: ${data.error.message}`);
      }

      // ✅ STORE IN CACHE - USING liveCache
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
        // Cache "no stream" result too
        cacheData = null;
      }

      // ✅ STORE IN CACHE - USING liveCache
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

  // ✅ Summary log
  log(`Live streams update completed: ${successfulUpdates} successful, ${failedUpdates} failed, ${cacheHits} cache hits`);

  // ✅ If ALL updates failed due to quota, throw error to prevent cache update
  if (successfulUpdates === 0 && failedUpdates > 0 && apiQuotaExceeded) {
    throw new Error("YouTube API quota exceeded - no live streams updated");
  }
}


/* ----------------------------------------------------
   MASTER FUNCTION: Combines All Updates
   ---------------------------------------------------- */
/**
 * Executes both the RSS and Live API updates, then saves and renders the final data.
 * @returns {Promise<boolean>} True if all updates were successful, false otherwise.
 */

async function loadAllChannelFeeds() {
  log("Starting full channel update (RSS and Live API)...");

  try {
    log("1/2: Loading latest uploads from RSS...");
    await loadYouTubeLatestFeeds();
    log("1/2: Latest uploads loaded successfully.");

    log("2/2: Loading live streams (YouTube API)...");
    await loadYouTubeLiveFeeds();
    log("2/2: Live streams loaded successfully.");

    // Final steps executed ONLY ONCE after both methods complete
    log("Saving updated channel data to localStorage...");
    localStorage.setItem("allChannelsData", JSON.stringify(allChannels));

    // Execute all rendering and UI update functions
    log("Rendering UI and updating components...");
    renderChannels(allChannels);
    updateFavoriteIcons();
    renderRecentlyWatched();
    updateAllChannelItems();

    log("✅ Full channels update COMPLETE.");
    return true;

  } catch (e) {
    log(`❌ Critical error during full channel update: ${e.message}`, true);

    // ✅ Still update the UI with whatever data we have
    log("Updating UI with available data...");
    localStorage.setItem("allChannelsData", JSON.stringify(allChannels));
    renderChannels(allChannels);
    updateFavoriteIcons();
    renderRecentlyWatched();
    updateAllChannelItems();

    return false;
  }
}

/* ----------------------------------------------------
   AUTO-TRIGGER MECHANISM
   ---------------------------------------------------- */
/**
 * Initializes a recurring check to automatically trigger the channel update
 * when the 8-hour cache window has expired.
 */
function startChannelAutoUpdate() {
  console.log(`Auto-update service initializing. Check interval set to ${CHECK_INTERVAL_MS / 60000} minutes.`);

  const checkAndUpdate = async () => {
    const lastUpdateTimestamp = parseInt(localStorage.getItem(CACHE_KEY) || "0");
    const currentTime = Date.now();

    // ✅ FIXED: Calculate time since last SUCCESSFUL update
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
          // ✅ FIX: Don't update cache timestamp if update failed
          log("❌ Update failed. Cache timestamp preserved for retry.", true);

          // ✅ Calculate when we can retry (wait at least 1 hour before retrying after quota error)
          const retryTime = new Date(currentTime + (60 * 60 * 1000)).toLocaleString();
          log(`Next retry attempt after: ${retryTime}`);
        }
      } catch (error) {
        // ✅ FIX: Handle unexpected errors without updating cache
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

  // Log initial status
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

  // Run immediately and set interval
  checkAndUpdate();
  setInterval(checkAndUpdate, CHECK_INTERVAL_MS);

  console.log(`Auto-update service started. Checking every ${CHECK_INTERVAL_MS / 60000} minutes.`);
}

// You must call this function when your HTML page loads to start the service:
// startChannelAutoUpdate();

// Utility to log messages to the UI
function log(message, isError = false) {
  const logArea = document.getElementById("logArea");
  const prefix = isError ? "Error: " : "Info: ";
  logArea.innerHTML += `<div class="${isError ? "text-red-400" : ""
    }">${prefix}[${new Date().toLocaleTimeString()}] ${message}</div>`;
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

  // Stop tracking FIRST
  stopWatching();

  // Clear all timeouts
  if (overlayTimeoutShow) clearTimeout(overlayTimeoutShow);
  if (overlayTimeoutHide) clearTimeout(overlayTimeoutHide);
  if (numberTimeout) clearTimeout(numberTimeout);
  if (navigationDebounce) clearTimeout(navigationDebounce);

  // Player cleanup
  if (playerInstance) {
    try {
      playerInstance.pause();
      // Remove all event listeners first
      playerInstance.off('error');
      playerInstance.off('waiting');
      playerInstance.off('playing');
      playerInstance.dispose();
    } catch (e) {
      console.warn('Error during player disposal:', e);
    }
    playerInstance = null;
  }

  // DOM cleanup
  const currentVideoElement = document.getElementById("player");
  if (currentVideoElement) {
    currentVideoElement.remove();
  }

  const videoContainer = document.getElementById("player-container");
  if (videoContainer) {
    videoContainer.innerHTML = '';
  }

  // Clear all status messages and notifications
  document.querySelectorAll('.network-status, .error-notification, .play-fallback-overlay').forEach(el => {
    el.remove();
  });

  // Restore focus
  if (lastFocusedElement && lastFocusedElement.isConnected) {
    lastFocusedElement.focus();
  } else if (allChannelItems.length > 0) {
    allChannelItems[0].focus();
  }

  // Optional: Clear caches (be careful with this)
  // rssCache.clear();
  // liveCache.clear();
}

// Call on page unload
window.addEventListener('beforeunload', cleanup);


function processRSSData(data, feed) {
  if (!data.items || data.items.length === 0) return;

  // Find the latest NON-Shorts video
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

// ✅ API KEY MANAGEMENT FUNCTIONS
function saveAPIKey(apiKey) {
  if (apiKey && apiKey.trim()) {
    localStorage.setItem(API_KEY_STORAGE_KEY, apiKey.trim());
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
  return storedKey && storedKey.length > 10; // Basic validation
}

function clearAPIKey() {
  localStorage.removeItem(API_KEY_STORAGE_KEY);
  API_KEY = "";
  console.log("🗑️ API Key cleared from localStorage");
}

// ✅ API KEY MODAL MANAGEMENT
function showAPIKeyModal() {
  const modal = document.getElementById('apiKeyModal');
  if (!modal) return;

  modal.style.display = 'flex';

  // Focus on input
  const apiKeyInput = document.getElementById('apiKeyInput');
  if (apiKeyInput) {
    apiKeyInput.focus();
  }

  // Set up event listeners
  setupAPIKeyModalEvents();
}

function hideAPIKeyModal() {
  const modal = document.getElementById('apiKeyModal');
  if (modal) {
    modal.style.display = 'none';
  }
}

function setupAPIKeyModalEvents() {
  const submitBtn = document.getElementById('submitApiKey');
  const skipBtn = document.getElementById('skipApiKey');
  const apiKeyInput = document.getElementById('apiKeyInput');

  if (submitBtn) {
    submitBtn.onclick = function () {
      const apiKey = apiKeyInput.value.trim();
      const remember = document.getElementById('rememberKey').checked;

      if (!apiKey) {
        alert('Please enter a valid API key');
        return;
      }

      if (remember) {
        saveAPIKey(apiKey);
      } else {
        API_KEY = apiKey; // Use temporarily without saving
      }

      hideAPIKeyModal();

      // Notify user
      showNotification('API Key saved successfully!', 'success');

      // Optionally start live feeds update
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


// ✅ ADD SETTINGS MANAGEMENT
function showAPISettings() {
  const modal = document.getElementById('apiKeyModal');
  const apiKeyInput = document.getElementById('apiKeyInput');
  const rememberCheckbox = document.getElementById('rememberKey');

  if (modal && apiKeyInput) {
    // Pre-fill with current key (masked)
    const currentKey = getStoredAPIKey();
    apiKeyInput.value = currentKey ? '••••••••' : '';
    rememberCheckbox.checked = true;

    modal.style.display = 'flex';
  }
}

// ✅ ADD NOTIFICATION FUNCTION
function showNotification(message, type = 'info') {
  // Create or use existing notification system
  console.log(`📢 ${type.toUpperCase()}: ${message}`);
  // You can implement a proper UI notification here
}




function setupNetworkMonitoring() {
  window.addEventListener('online', handleNetworkRestored);
  window.addEventListener('offline', handleNetworkLost);

  // Optional: Periodic connection quality check
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

  // Try to resume playback
  if (playerInstance && playerInstance.paused() && currentVideoUrl) {
    try {
      // Small delay to ensure network is stable
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
  // Remove existing status if any
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
    background: ${type === 'error' ? '#9b2c2c' : type === 'warning' ? '#ef6c00' : '#276749'};
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

// Add this anywhere in your global scope (recommended at the bottom)
document.addEventListener('visibilitychange', function() {
  if (document.hidden) {
    // Tab hidden - pause player to save resources
    if (playerInstance && !playerInstance.paused()) {
      playerInstance.pause();
      console.log('Video paused due to tab switch');
    }
  }
  // Note: We don't auto-resume when tab becomes visible
  // as this can be annoying for users
});
