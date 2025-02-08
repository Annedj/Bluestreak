class StreakManager {
  constructor() {
    this.BSKY_API = 'https://public.api.bsky.app/xrpc';
    this.cache = new Map();
    this.debounceTimeout = null;
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
    let currentDate = new Date();

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
    localStorage.removeItem('bluestreak');
    this.updateOrInsertStreakInfo();
  }

  async updateOrInsertStreakInfo() {
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
    }

    this.debounceTimeout = setTimeout(async () => {
      try {
        const helpLink = document.querySelector('a[aria-label="Help"]');
        if (!helpLink) throw new Error('Help link not found');

        const handle = await this.getProfile();
        const container = helpLink.parentElement.parentElement;

        this.removeExistingStreakContainers();
        container.appendChild(this.createLoadingIndicator());

        const today = new Date(StreakManager.getUTCDate());
        // today.setDate(today.getDate() + 1);
        console.log("🚀 ~ today:", today);

        const bluestreak = JSON.parse(localStorage.getItem('bluestreak')) || {};
        const { streakDate, streakNumber = 0 } = bluestreak;

        let streak = streakNumber;
        let hasPostedToday = streakDate === today;

        console.log("🚀 ~ streakDate:", streakDate);
        console.log("🚀 ~ hasPostedToday:", hasPostedToday);
        console.log("🚀 ~ today - streakDate:", today.getDate() - new Date(streakDate).getDate())
        if (today.getDate() - new Date(streakDate).getDate() > 1) {
          hasPostedToday = false;
          streak = 0;
        } else if (!streakDate || streakDate < today) {
          if (streakDate && new Date(streakDate).getDate() === new Date(today).getDate() - 1) {
            hasPostedToday = await this.getPostsForDay(handle, new Date());
            streak = hasPostedToday ? streakNumber + 1 : streakNumber;
          } else {
            streak = await this.calculateStreak(handle);
            hasPostedToday = streak > 0;
          }
        }
        localStorage.setItem('bluestreak', JSON.stringify({
          streakDate: hasPostedToday ? today : streakDate,
          streakNumber: streak
        }));

        this.removeExistingStreakContainers();
        this.createStreakDisplay(container, streak, hasPostedToday);

      } catch (error) {
        console.error('Error updating streak:', error);
        this.showError('Failed to update streak. Please refresh.');
      }
    }, 300);
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
}

const observer = new MutationObserver((mutations, obs) => {
  const nav = document.querySelector('nav');
  if (nav) {
    obs.disconnect();
    new StreakManager();
  }
});

observer.observe(document.body, { childList: true, subtree: true });
