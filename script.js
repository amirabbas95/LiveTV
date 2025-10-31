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

// Function to extract YouTube ID
function extractYouTubeID(url) {
  const match = url.match(/(?:youtube\.com\/.*v=|youtu\.be\/)([^&?/]+)/);
  return match ? match[1] : null;
}

// UI elements
const modal = document.getElementById("videoModal");
const qualityEl = document.getElementById("video-quality");

function selectChannel(url, name, image, description, number, isLive) {
  if (!url) return;

  const videoContainer = document.getElementById("player-container");
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
        },
        onError: function (error) {
          Android.onPlayerError(error.data);
          if (error.data === 101 || error.data === 150 || error.data === 153) {
            // Fallback
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

    if (!isChannelLive && isYouTube) {
      playerInstance.controls(false);
    } else if (isChannelLive && isYouTube) {
      playerInstance.controls(false);
    } else {
      playerInstance.controls(true);
    }
  });

  // Set up the retry button for manual use only
  const retryButton = document.getElementById("retryButton");
  if (retryButton) {
    retryButton.onclick = function () {
      console.log("Manual retry triggered by user.");
      retryStream(url);
    };
    retryButton.style.display = "none";
  }

  addRetryListeners();
  retryCount = 0;

  startWatching(url);
}

function showChannelInfoOverlay() {
  const channelInfoOverlay = document.getElementById("channel-info-overlay");

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

function renderRecentOverlay() {
  const container = document.getElementById("recentChannelsGrid");
  const recent = JSON.parse(localStorage.getItem(recentlyWatchedKey) || "[]");
  container.innerHTML = "";

  recent.forEach((channel, index) => {
    const item = document.createElement("div");
    item.className = "recent-item";
    item.setAttribute("tabindex", "0");
    item.dataset.channel = JSON.stringify(channel);

    const img = document.createElement("img");
    img.src = channel.image;
    img.alt = channel.name;

    // ✅ live indicator
    if (channel.isLive === true || channel.isLive === "true") {
      const liveIndicator = document.createElement("img");
      liveIndicator.src = "live.webp";
      liveIndicator.alt = "Live";
      liveIndicator.className = "live-indicator";
      item.appendChild(liveIndicator);
    }

    item.appendChild(img);

    item.addEventListener("click", () => {
      selectChannel(
        channel.url,
        channel.name,
        channel.image,
        channel.description,
        channel.number,
        channel.isLive
      );
      hideRecentChannelOverlay();
      saveRecentlyWatched(channel);
    });

    container.appendChild(item);
  });

  // Focus first recent channel when overlay opens
  const first = container.querySelector(".recent-item");
  if (first) first.focus();
}

function showRecentChannelOverlay() {
  const overlay = document.getElementById("recent-channel-overlay");
  renderRecentOverlay();
  overlay.classList.add("show");
  isRecentOverlayActive = true;
}

function hideRecentChannelOverlay() {
  const overlay = document.getElementById("recent-channel-overlay");
  overlay.classList.remove("show");
  isRecentOverlayActive = false;
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

function addRetryListeners() {
  if (playerInstance) {
    playerInstance.off("error", handlePlayerError);
    playerInstance.off("play", handlePlayerSuccess);
    playerInstance.on("error", handlePlayerError);
    playerInstance.on("play", handlePlayerSuccess);
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
  renderRecentOverlay();
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

      mainContainer.appendChild(categoryHeading);
      mainContainer.appendChild(categoryGrid);
    }
  } else {
    const totalChannelCount = channels.length;
    const mainHeading = document.createElement("h2");
    mainHeading.textContent = `> Channels < (${totalChannelCount})`;
    mainHeading.className = "text-xl font-bold mt-6 mb-4 col-span-full";
    mainContainer.appendChild(mainHeading);

    const categoryGrid = document.createElement("div");
    categoryGrid.className = "content-grid";

    channels.forEach((channel) => {
      const item = createChannelItem(channel); // use locked number
      categoryGrid.appendChild(item);
    });

    mainContainer.appendChild(categoryGrid);
  }
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
    } catch {
      console.warn("Invalid allChannelsData in localStorage, ignoring.");
      allChannels = [];
    }
  }

  await loadYouTubeLatestFeeds();
  // For live streams (API, quota-based)
  await loadYouTubeLiveFeeds();

  allChannels.forEach((ch, i) => {
    if (!ch.number) ch.number = i + 1;
  });

  loadWatchTime?.();

  const savedSort = localStorage.getItem("defaultSortMethod") || "none";
  sortChannelsAndRender(savedSort);
  document.getElementById("sortChannels").value = savedSort;

  renderFavorites();
  renderRecentlyWatched();
  renderRecentOverlay();
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

document.addEventListener("keydown", (event) => {
  const GRID_COLUMNS = getGridColumns();
  const isModalOpen = modal.style.display === "flex";
  let focusedElement = document.activeElement;
  let focusedIndex = allChannelItems.findIndex(
    (item) => item === focusedElement
  );

  // --- IF MODAL IS OPEN AND RECENT OVERLAY IS ACTIVE ---
  if (isModalOpen && isRecentOverlayActive) {
    const items = Array.from(
      document.querySelectorAll("#recentChannelsGrid .recent-item")
    );
    let idx = items.indexOf(focusedElement);

    if (event.key === "ArrowRight") {
      event.preventDefault();
      if (items.length > 0) items[(idx + 1) % items.length].focus();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      hideRecentChannelOverlay();
      if (items.length > 0)
        items[(idx - 1 + items.length) % items.length].focus();
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (focusedElement && focusedElement.dataset.channel) {
        const ch = JSON.parse(focusedElement.dataset.channel);
        selectChannel(
          ch.url,
          ch.name,
          ch.image,
          ch.description,
          ch.number,
          ch.isLive
        );
        saveRecentlyWatched(ch);

        // ✅ update lastFocusedElement to the real grid card
        const realCard = allChannelItems.find(
          (item) => item.dataset.name === ch.name
        );
        if (realCard) {
          lastFocusedElement = realCard;
          realCard.focus();
        }

        hideRecentChannelOverlay();
      }
    }
    return; // ✅ stop here so no other keys interfere
  }

  // --- IF MODAL IS OPEN AND RECENT OVERLAY IS NOT ACTIVE ---
  if (isModalOpen) {
    if (event.key === "Enter") {
      event.preventDefault();
      showRecentChannelOverlay(); // open recent overlay
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
        isLive = "false", // If data-isLive is missing, default to 'false'
        category = "Unknown", // If data-category is missing, default to 'Unknown'
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

// === Helper: Extract videoId from a YouTube link ===
function extractYouTubeID(url) {
  const match = url.match(
    /(?:youtube\.com\/(?:.*v=|live\/|embed\/)|youtu\.be\/)([^&?/]+)/i
  );
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
  if (!feeds || feeds.length === 0) return;

  for (const feed of feeds) {
    try {
      const feedUrl =
        "https://api.rss2json.com/v1/api.json?rss_url=" +
        encodeURIComponent(feed.url);

      const res = await fetch(feedUrl);
      const data = await res.json();
      if (!data.items || data.items.length === 0) continue;

      // Find the latest NON-Shorts video
      let latestValid = data.items.find(
        (item) => !item.link.includes("/shorts/")
      );
      if (!latestValid) continue;

      const videoId = extractYouTubeID(latestValid.link);
      if (!videoId) continue;

      const channelObj = youtubeItemToChannel(videoId, latestValid.title, feed);

      // Update or insert
      const existing = allChannels.find((ch) => ch.name === channelObj.name);
      if (existing) {
        existing.url = channelObj.url;
        existing.description = channelObj.description;
        existing.image = channelObj.image;
      } else {
        allChannels.push(channelObj);
      }
    } catch (e) {
      console.error("Error loading RSS feed:", feed.name, e);
    }
  }

  localStorage.setItem("allChannelsData", JSON.stringify(allChannels));
  renderChannels(allChannels);
  updateFavoriteIcons();
  renderRecentlyWatched();
  renderRecentOverlay();
  updateAllChannelItems();
}

/* ----------------------------------------------------
   📌 2. Load live streams (via YouTube API v3)
   ---------------------------------------------------- */
function extractChannelId(feedUrl) {
  const match = feedUrl.match(/channel_id=([^&]+)/);
  return match ? match[1] : null;
}

async function loadYouTubeLiveFeeds() {
  if (!live || live.length === 0) return;

  for (const feed of live) {
    try {
      const channelId = extractChannelId(feed.url);
      if (!channelId) {
        console.warn("No channelId found in feed:", feed.url);
        continue;
      }

      const apiUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&eventType=live&type=video&key=${API_KEY}`;

      const res = await fetch(apiUrl);
      const data = await res.json();

      if (!data.items || data.items.length === 0) continue;

      const item = data.items[0];
      const videoId = item.id.videoId;
      const title = item.snippet.title;

      const channelObj = youtubeItemToChannel(videoId, title, feed);

      // Update or insert
      const existing = allChannels.find((ch) => ch.name === channelObj.name);
      if (existing) {
        existing.url = channelObj.url;
        existing.description = channelObj.description;
        existing.image = channelObj.image;
      } else {
        allChannels.push(channelObj);
      }
    } catch (e) {
      console.error("Error loading live feed:", feed.name, e);
    }
  }

  localStorage.setItem("allChannelsData", JSON.stringify(allChannels));
  renderChannels(allChannels);
  updateFavoriteIcons();
  renderRecentlyWatched();
  renderRecentOverlay();
  updateAllChannelItems();
}
