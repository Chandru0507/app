const PREFIX = 'kavach_';

export const storage = {
  get(key, defaultValue = null) {
    try {
      const item = localStorage.getItem(PREFIX + key);
      return item ? JSON.parse(item) : defaultValue;
    } catch {
      return defaultValue;
    }
  },

  set(key, value) {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },

  remove(key) {
    localStorage.removeItem(PREFIX + key);
  },

  keys() {
    return Object.keys(localStorage)
      .filter((k) => k.startsWith(PREFIX))
      .map((k) => k.slice(PREFIX.length));
  },
};

export const KEYS = {
  SOS_EVENTS: 'sos_events',
  SESSIONS: 'sessions',
  CONTACTS_CACHE: 'contacts_cache',
  OFFLINE_QUEUE: 'offline_queue',
  PREFS: 'preferences',
  LAST_SYNC: 'last_sync',
  SHAKE_SETTINGS: 'shake_settings',
  SAFE_ZONES: 'safe_zones',
  SOS_SETTINGS: 'sos_settings',
  GUIDE_FAVORITES: 'guide_favorites',
  NEARBY_CACHE: 'nearby_cache',
};