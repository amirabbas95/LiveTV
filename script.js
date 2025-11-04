let retryButton = null;
let retryTimeoutId = null;
const MAX_RECENT = 18;
const favoritesKey = "favorites";
const recentlyWatchedKey = "recentlyWatched";
let allChannelItems = [];
let lastFocusedElement = null;
let currentSortMethod = "none";
let playerInstance = null;
let fullscreenTimeoutId = null;
let retryCount = 0;
const maxRetries = 3;
const retryDelay = 5000;
let watchStartTime = 0;
let currentVideoUrl = "";
let overlayTimeoutShow;
let overlayTimeoutHide;
let isRecentOverlayActive = false;
const API_KEY = "AIzaSyDL6cStGYRBUeewAQntRv85hiz2xkpwun0"; // <-- replace with your API key
// --- Configuration and Global State ---
const CACHE_KEY = "lastChannelsUpdate";
// 8 hours in milliseconds (8 * 60 * 60 * 1000)
const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;
// Check status every 15 minutes
const CHECK_INTERVAL_MS = 15 * 60 * 1000;
let allChannels = [];
let focusedIndex = 0;

const rssCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

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

  const videoContainer = document.getElementById("player-container");
  videoContainer.innerHTML = `
    <div class="loading-state">
      <div class="spinner"></div>
      <p>Loading ${name}...</p>
    </div>
  `;
  const imageElement = document.getElementById("content-image");
  const videoTitleElement = document.getElementById("video-title");
  const channelInfoElement = document.getElementById("channel-description");

  lastFocusedElement = document.activeElement;

  // ✅ show channel number if available
  const numberEl = document.getElementById("channel-number");
  numberEl.textContent = number ? number + "." : "";

  // Clear any existing fullscreen timeout before setting up a new player
  if (fullscreenTimeoutId) {
    clearTimeout(fullscreenTimeoutId);
    fullscreenTimeoutId = null;
  }

  if (playerInstance) {
    playerInstance.dispose();
    playerInstance = null;
  }

  // Remove old video element if it exists
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
        enablejsapi: 1,
        modestbranding: 1,
      },
      events: {
        onReady: function (event) {
          event.target.playVideo();
          Android.onPlayerReady();
          log("Player is ready and video started.");
        },
        onError: function (error) {
          Android.onPlayerError(error.data);
          if (error.data === 101 || error.data === 150 || error.data === 153) {
            // Fallback
            log("Error requires fallback to mobile YouTube link.", true);
            window.location.href = "https://m.youtube.com/watch?v=$[url]";
          }
        },
      },
    },
  });

  playerInstance.ready(function () {
    playerInstance.play().catch((e) => {
      console.warn("Autoplay blocked:", e);
    });
    // ✅ ADD CONNECTION MONITORING
    monitorConnectionQuality();

    playerInstance.on("loadedmetadata", updateQualityDisplay);

    if (isYouTube) {
      const ytPlayer = playerInstance.tech().ytPlayer;
      ytPlayer.addEventListener("onPlaybackQualityChange", (e) => {
        document.getElementById("video-quality").textContent = e.data;
      });
    }
  });

  playerInstance.on("loadedmetadata", function () {
    const currentSrc = playerInstance.currentSrc();

    const isChannelLive = isLive === true || isLive === "true";

    if (!isChannelLive && !isYouTube) {
      playerInstance.controls(true);
    } else {
      playerInstance.controls(false);
    }

    //Clear the handler after execution to prevent duplicate listeners
    playerInstance.off("loadedmetadata");
  });

  // Set up the retry button for manual use only
  const retryButton = document.getElementById("retryButton");
  if (retryButton) {
    retryButton.onclick = function () {
      console.log("Manual retry triggered by user.");
      retryStream(url, name);
    };
    retryButton.style.display = "none";
  }

  addRetryListeners(name);
  retryCount = 0;

  startWatching(url);
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
function startWatching(url) {
  currentVideoUrl = url;
  watchStartTime = Date.now();
}

// Stop tracking and save to localStorage
function stopWatching() {
  if (!currentVideoUrl) return;

  const watchedMs = Date.now() - watchStartTime;
  const watchedSeconds = Math.floor(watchedMs / 1000);

  const watchData =
    JSON.parse(localStorage.getItem("watchTimePerChannel")) || {};
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
    const aTime = watchData[a.url] || 0;
    const bTime = watchData[b.url] || 0;
    return bTime - aTime; // highest watch time first
  });
}

function updateQualityDisplay() {
  const height = playerInstance.videoHeight();
  qualityEl.textContent = height ? `${height}p` : "Auto";
}

function closeModal() {
  stopWatching();
  modal.style.display = "none";

  if (retryTimeoutId) {
    clearTimeout(retryTimeoutId);
    retryTimeoutId = null;
  }
  if (playerInstance) {
    playerInstance.off("error", handlePlayerError);
    playerInstance.off("play", handlePlayerSuccess);
    playerInstance.dispose();
    playerInstance = null;
  }
  let currentVideoElement = document.getElementById("player");
  if (currentVideoElement) {
    currentVideoElement.remove();
  }
  updateAllChannelItems();

  if (lastFocusedElement && lastFocusedElement.isConnected) {
    lastFocusedElement.focus();
  } else if (allChannelItems.length > 0) {
    allChannelItems[0].focus();
  }
}

function handlePlayerError() {
  console.error("Video player error detected. Showing manual retry button.");
  if (retryButton) {
    retryButton.style.display = "block";
    retryButton.disabled = false;
    retryButton.textContent = "Retry";
  }
}

function handlePlayerSuccess() {
  console.log(
    "Video playback resumed or started successfully. Hiding retry button."
  );

  if (retryButton) {
    retryButton.style.display = "none";
    retryButton.disabled = false;
    retryButton.textContent = "Retry";
  }
  // Clear any pending auto-retry timeouts
  if (retryTimeoutId) {
    clearTimeout(retryTimeoutId);
    retryTimeoutId = null;
  }
  retryCount = 0;
}

function addRetryListeners(name) {
  if (playerInstance) {
    playerInstance.off("error", handlePlayerError);
    playerInstance.off("play", handlePlayerSuccess);
    playerInstance.on("error", handlePlayerError);
    playerInstance.on("play", handlePlayerSuccess);

    // ✅ Add network state monitoring
    playerInstance.on("loadstart", () => {
      log(`Loading stream for ${name}: ${playerInstance.currentSrc()}`);
    });

    playerInstance.on("stalled", () => {
      log("Stream stalled, attempting recovery...", true);
      setTimeout(() => playerInstance.play().catch(() => { }), 2000);
    });
  }
}

function retryStream(url, name) {
  if (!playerInstance || modal.style.display !== "flex") {
    return;
  }

  console.log("Manual retry initiated. Re-initializing player.");

  // Dispose of the old player instance
  playerInstance.dispose();

  // Pass original channel data to selectChannel to re-initialize it
  const channel = allChannels.find((c) => c.url === url);
  if (channel) {
    selectChannel(
      channel.url,
      channel.name,
      channel.image,
      channel.description
    );
  } else {
    console.error("Original channel data not found. Cannot retry.");
  }

  if (retryButton) {
    retryButton.style.display = "none";
  }
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

  //await loadYouTubeLatestFeeds();
  // For live streams (API, quota-based)
  //await loadYouTubeLiveFeeds();

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

/* // === Helper: Extract videoId from a YouTube link ===
function extractYouTubeID(url) {
  const match = url.match(
    /(?:youtube\.com\/(?:.*v=|live\/|embed\/)|youtu\.be\/)([^&?/]+)/i
  );
  return match ? match[1] : null;
} */

function extractChannelId(feedUrl) {
  const patterns = [
    /channel_id=([^&]+)/,
    /\/channel\/([^/?]+)/,
    /\/user\/([^/?]+)/,
    /\/c\/([^/?]+)/
  ];
  for (const pattern of patterns) {
    const match = feedUrl.match(pattern);
    if (match) return match[1];
  }
  return null;
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
        await new Promise(resolve => setTimeout(resolve, 150));
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

      //const apiUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&eventType=live&type=video&key=${API_KEY}`;
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

      if (!data.items || data.items.length === 0) {
        log(`ℹ️ No live stream found for ${feed.name}`);
        continue;
      }

      const item = data.items[0];
      const videoId = item.id.videoId;
      const title = item.snippet.title;

      const channelObj = youtubeItemToChannel(videoId, title, feed);
      updateOrAddChannel(channelObj);
      successfulUpdates++;

      log(`✅ ${feed.name} Successfully updated`);

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
  log(`Live streams update completed: ${successfulUpdates} successful, ${failedUpdates} failed`);

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

function monitorConnectionQuality() {
  let lastBitrate = 0;
  let qualityChanges = 0;

  if (playerInstance) {
    playerInstance.on('loadstart', () => {
      const connection = navigator.connection;
      if (connection) {
        const effectiveType = connection.effectiveType;
        log(`Network type: ${effectiveType}, Downlink: ${connection.downlink}Mb/s`);
      }
    });
  }
}

function validateChannelData(channel) {
  const required = ['url', 'name', 'image'];
  const missing = required.filter(field => !channel[field]);

  if (missing.length > 0) {
    console.warn(`Channel ${channel.name} missing fields:`, missing);
    return false;
  }

  // Validate URL format
  try {
    new URL(channel.url);
    return true;
  } catch {
    console.warn(`Invalid URL for channel: ${channel.url}`);
    return false;
  }
}

function cleanup() {
  // Clear intervals and timeouts
  if (retryTimeoutId) clearTimeout(retryTimeoutId);
  if (fullscreenTimeoutId) clearTimeout(fullscreenTimeoutId);
  if (overlayTimeoutShow) clearTimeout(overlayTimeoutShow);
  if (overlayTimeoutHide) clearTimeout(overlayTimeoutHide);

  // Clean up player
  if (playerInstance) {
    playerInstance.dispose();
    playerInstance = null;
  }

  // Clear caches
  rssCache.clear();
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