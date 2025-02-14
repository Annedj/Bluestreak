class StreakManager {
  constructor() {
    this.BSKY_API = 'https://public.api.bsky.app/xrpc';
    this.cache = new Map();
    this.debounceTimeout = null;
    this.isRefreshing = false;
    this.init();
  }

  static getUTCDate(date = new Date()) {
    return date.toLocaleDateString('en-US', { timeZone: 'UTC' });
  }

  async init() {
    this.setupObserver();
  }

  setupObserver() {
    const observer = new MutationObserver((mutations, obs) => {
      const nav = document.querySelector('nav');
      if (nav) {
        obs.disconnect();
        this.updateOrInsertStreakInfo();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  async getProfile() {
    const profileLink = document.querySelector('a[aria-label="Profile"]');
    if (!profileLink) throw new Error('Profile link not found');

    const handle = profileLink.getAttribute('href').split('/profile/')[1];
    this.textColor = profileLink.childNodes[1].style.color;
    return handle;
  }

  createLoadingIndicator() {
    const container = document.createElement('div');
    container.className = 'streak-container loading';
    container.textContent = 'Calculating streak...';
    container.style.fontSize = '12px';
    container.style.color = this.textColor;
    return container;
  }

  async fetchWithTimeout(url, options = {}, timeout = 5000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  async getPostsForDay(handle, date, retries = 3) {
    const cacheKey = `${handle}-${StreakManager.getUTCDate(date)}`;
    if (this.cache.has(cacheKey)) return this.cache.get(cacheKey);

    let cursor = null;
    let foundPost = false;
    const targetDate = StreakManager.getUTCDate(date);

    try {
      while (!foundPost) {
        const params = new URLSearchParams({
          actor: handle,
          limit: '100',
          filter: 'posts_no_replies',
          ...(cursor && { cursor })
        });

        const response = await this.fetchWithTimeout(
          `${this.BSKY_API}/app.bsky.feed.getAuthorFeed?${params}`
        );
        const data = await response.json();

        if (!data.feed?.length) break;

        foundPost = data.feed.some(post =>
          StreakManager.getUTCDate(new Date(post.post.indexedAt)) === targetDate
        );

        if (!foundPost && data.cursor) {
          cursor = data.cursor;
        } else {
          break;
        }
      }

      this.cache.set(cacheKey, foundPost);
      return foundPost;

    } catch (error) {
      if (retries > 0) {
        await new Promise(r => setTimeout(r, Math.pow(2, 3-retries) * 1000));
        return this.getPostsForDay(handle, date, retries - 1);
      }
      throw error;
    }
  }

  async calculateStreak(handle) {
    let streak = 0;
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    // First check yesterday to determine if we should continue counting
    const hasPostedYesterday = await this.getPostsForDay(handle, yesterday);
    if (!hasPostedYesterday) {
      return 0; // Streak is broken if no post yesterday
    }

    // Start counting from yesterday
    let currentDate = yesterday;

    while (true) {
      try {
        const hasPosted = await this.getPostsForDay(handle, currentDate);
        if (!hasPosted) break;
        streak++;
        currentDate.setDate(currentDate.getDate() - 1);
      } catch (error) {
        this.showError('Error calculating streak. Please try again later.');
        throw error;
      }
    }

    return streak;
  }

  showError(message) {
    const errorContainer = document.createElement('div');
    errorContainer.className = 'streak-error';
    errorContainer.textContent = message;
    errorContainer.style.fontSize = '12px';
    errorContainer.style.color = 'red';

    const existingError = document.querySelector('.streak-error');
    if (existingError) existingError.remove();

    const helpLink = document.querySelector('a[aria-label="Help"]');
    if (helpLink?.parentElement) {
      helpLink.parentElement.appendChild(errorContainer);
    }
  }

  async refreshStreak() {
    if (this.isRefreshing) return; // Prevent multiple refreshes

    try {
      this.isRefreshing = true;
      const helpLink = document.querySelector('a[aria-label="Help"]');
      if (!helpLink) throw new Error('Help link not found');

      const container = helpLink.parentElement.parentElement;
      const existingContainer = container.querySelector('.streak-main-container');

      if (existingContainer) {
        const refreshButton = existingContainer.querySelector('.streak-refresh');
        const streakText = existingContainer.querySelector('span');

        // Save the original text and update to "Refreshing..."
        const originalText = streakText.textContent;
        refreshButton.textContent = '⌛'; // Change to hourglass
        streakText.textContent = 'Refreshing...';

        // Clear cache and local storage
        this.cache.clear();
        localStorage.removeItem('bluestreak');

        // Wait a moment to show the refreshing state
        await new Promise(resolve => setTimeout(resolve, 500));

        // Recalculate streak
        await this.updateOrInsertStreakInfo();
      }
    } catch (error) {
      console.error('Error during refresh:', error);
      this.showError('Failed to refresh streak. Please try again.');
    } finally {
      this.isRefreshing = false;
    }
  }

  async updateOrInsertStreakInfo() {
    if (this.debounceTimeout && !this.isRefreshing) {
      clearTimeout(this.debounceTimeout);
    }

    const updateFunc = async () => {
      try {
        const helpLink = document.querySelector('a[aria-label="Help"]');
        if (!helpLink) throw new Error('Help link not found');

        const handle = await this.getProfile();
        const container = helpLink.parentElement.parentElement;

        // Only show loading indicator if not refreshing (to avoid flicker)
        if (!this.isRefreshing) {
          this.removeExistingStreakContainers();
          container.appendChild(this.createLoadingIndicator());
        }

        // Check if posted today
        const hasPostedToday = await this.checkRecentPostsForToday(handle);

        // Calculate base streak (up to yesterday)
        let streak = await this.calculateStreak(handle);

        // If we've posted today, add one to the streak
        if (hasPostedToday) {
          streak += 1;
        }

        // Save the current streak
        localStorage.setItem('bluestreak', JSON.stringify({
          streakDate: new Date().toISOString(),
          streakNumber: streak
        }));

        this.removeExistingStreakContainers();
        this.createStreakDisplay(container, streak, hasPostedToday);

      } catch (error) {
        console.error('Error updating streak:', error);
        this.showError('Failed to update streak. Please refresh.');
      }
    };

    if (this.isRefreshing) {
      await updateFunc();
    } else {
      this.debounceTimeout = setTimeout(updateFunc, 300);
    }
  }

  removeExistingStreakContainers() {
    document.querySelectorAll('.streak-main-container, .streak-container, .streak-error').forEach(el => el.remove());
  }

  createStreakDisplay(container, streak, postedToday) {
    const mainContainer = document.createElement('div');
    mainContainer.className = 'streak-main-container';

    const streakContainer = document.createElement('div');
    streakContainer.className = 'streak-container';
    streakContainer.style.color = this.textColor;

    const statusIcon = document.createElement('img');
    statusIcon.className = "streak-icon";
    statusIcon.src = chrome.runtime.getURL(postedToday ? 'images/posted.png' : 'images/not-posted.png');
    let hint = null;
    if (!postedToday) {
      hint = document.createElement('p');
      hint.textContent = "You haven't posted today";
      hint.style.fontSize = '12px';
      hint.style.color = '#666';
      hint.style.marginTop = '4px';
      hint.style.display = 'block';
    }

    const streakText = document.createElement('span');
    streakText.textContent = `${streak}-day streak`;

    const refreshButton = document.createElement('button');
    refreshButton.className = 'streak-refresh';
    refreshButton.textContent = '🔄';
    refreshButton.onclick = () => this.refreshStreak();

    streakContainer.append(statusIcon, streakText, refreshButton);
    mainContainer.append(streakContainer);
    if (hint) {
      mainContainer.appendChild(hint);
    }

    container.appendChild(mainContainer);
  }

  async checkRecentPostsForToday(handle) {
    const params = new URLSearchParams({
      actor: handle,
      limit: '5',
      filter: 'posts_no_replies'
    });

    try {
      const response = await this.fetchWithTimeout(
        `${this.BSKY_API}/app.bsky.feed.getAuthorFeed?${params}`
      );
      const data = await response.json();

      const today = StreakManager.getUTCDate();
      return data.feed.some(post =>
        StreakManager.getUTCDate(new Date(post.post.indexedAt)) === today
      );
    } catch (error) {
      console.error('Error fetching recent posts:', error);
      return false;
    }
  }
}

const observer = new MutationObserver((mutations, obs) => {
  const nav = document.querySelector('nav');
  if (nav) {
    obs.disconnect();
    new StreakManager();
  }
});

observer.observe(document.body, { childList: true, subtree: true });
