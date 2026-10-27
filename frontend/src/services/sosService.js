import { storage, KEYS } from './storage';
import { offlineQueue } from './offlineQueue';
import { sirenService } from './sirenService';
import { flashlightService } from '../plugins/flashlight';
import { buildSosLocation, buildSosRequestPayload } from './locationFix';

export const sosService = {
  getLocalEvents() {
    return storage.get(KEYS.SOS_EVENTS, []);
  },

  getActiveLocalEvent() {
    const events = this.getLocalEvents();
    return events.find((e) => e.status === 'active') || null;
  },

  saveLocalEvent(event) {
    const events = this.getLocalEvents();
    const idx = events.findIndex((e) => e.id === event.id);
    if (idx >= 0) {
      events[idx] = event;
    } else {
      events.push(event);
    }
    storage.set(KEYS.SOS_EVENTS, events);
    return event;
  },

  removeLocalEvent(id) {
    const events = this.getLocalEvents().filter((e) => e.id !== id);
    storage.set(KEYS.SOS_EVENTS, events);
  },

  getSosSettings() {
    return storage.get(KEYS.SOS_SETTINGS, {
      silentMode: false,
      soundEnabled: true,
      flashlightEnabled: false,
    });
  },

  // Start or stop sound and flashlight feedback based on user preferences.
  async activateFeedback() {
    const settings = this.getSosSettings();
    const feedback = { siren: false, strobe: false, silent: settings.silentMode };

    if (settings.silentMode) {
      return feedback;
    }

    if (settings.soundEnabled && sirenService.isSupported()) {
      const result = sirenService.start();
      feedback.siren = result.started;
    }

    if (settings.flashlightEnabled) {
      const availability = await flashlightService.isAvailable();
      if (availability.available) {
        const strobe = await flashlightService.strobe(200, 30000);
        feedback.strobe = strobe.started;
        feedback.stopStrobe = strobe.stop;
      }
    }

    return feedback;
  },

  deactivateFeedback(feedback = null) {
    sirenService.stop();
    if (feedback && typeof feedback.stopStrobe === 'function') {
      feedback.stopStrobe();
    } else {
      flashlightService.disable();
    }
    return { stopped: true };
  },

  async activateSOS(token, location = {}) {
    const eventId = `sos_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    // location must be a fix produced by the location hook. Without one the
    // record only carries `locationStatus` — coordinates are never invented.
    const locationFields = buildSosLocation(location);
    const payload = buildSosRequestPayload({
      location,
      category: 'personal',
      cancelCountdown: 30,
      clientEventId: eventId,
    });
    const event = {
      id: eventId,
      category: 'personal',
      status: 'active',
      location: locationFields,
      createdAt: new Date().toISOString(),
      syncState: 'local_only',
      deliveryStatus: 'pending',
    };

    this.saveLocalEvent(event);

    if (navigator.onLine) {
      try {
        const api = (await import('../api/client')).default;
        const res = await api.post('/api/auth/sos', payload, token);
        event.syncState = 'synced';
        event.serverId = res.event._id;
        event.deliveryStatus = 'recorded';
        this.saveLocalEvent(event);
        return { success: true, event, serverConfirmed: true };
      } catch (err) {
        if (err.status === 409) {
          event.syncState = 'synced';
          event.deliveryStatus = 'already_active';
          this.saveLocalEvent(event);
          return { success: false, reason: 'already_active', event };
        }
        offlineQueue.add({ type: 'sos_trigger', payload });
        event.syncState = 'queued';
        event.deliveryStatus = 'queued_offline';
        this.saveLocalEvent(event);
        return { success: true, event, serverConfirmed: false, queued: true };
      }
    } else {
      offlineQueue.add({ type: 'sos_trigger', payload });
      event.syncState = 'queued';
      event.deliveryStatus = 'queued_offline';
      this.saveLocalEvent(event);
      return { success: true, event, serverConfirmed: false, queued: true };
    }
  },

  async cancelSOS(token) {
    const active = this.getActiveLocalEvent();
    if (!active) return { success: false, reason: 'no_active_event' };

    active.status = 'cancelled';
    active.cancelledAt = new Date().toISOString();
    active.syncState = active.syncState === 'synced' ? 'synced' : 'local_only';
    this.saveLocalEvent(active);

    if (navigator.onLine && active.syncState === 'synced') {
      try {
        const api = (await import('../api/client')).default;
        await api.post('/api/auth/sos/cancel', null, token);
        return { success: true };
      } catch (err) {
        offlineQueue.add({ type: 'sos_cancel', payload: {} });
        return { success: true, queued: true };
      }
    } else {
      offlineQueue.add({ type: 'sos_cancel', payload: {} });
      return { success: true, queued: true };
    }
  },

  async syncPending(token) {
    if (!navigator.onLine) return { synced: 0, failed: 0 };
    const api = (await import('../api/client')).default;
    const results = await offlineQueue.sync(api, token);
    const synced = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    return { synced, failed, results };
  },
};