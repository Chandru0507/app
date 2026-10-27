import { storage, KEYS } from './storage.js';

let queue = storage.get(KEYS.OFFLINE_QUEUE, []);
let listeners = [];

function notify() {
  listeners.forEach((fn) => fn(queue));
}

function persist() {
  storage.set(KEYS.OFFLINE_QUEUE, queue);
}

export const offlineQueue = {
  subscribe(fn) {
    listeners.push(fn);
    return () => {
      listeners = listeners.filter((f) => f !== fn);
    };
  },

  getAll() {
    return [...queue];
  },

  getPending() {
    return queue.filter((op) => op.status === 'queued' || op.status === 'failed');
  },

  add(operation) {
    const op = {
      id: `op_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      status: 'queued',
      retries: 0,
      maxRetries: 3,
      ...operation,
    };
    queue.push(op);
    persist();
    notify();
    return op.id;
  },

  update(id, updates) {
    const idx = queue.findIndex((op) => op.id === id);
    if (idx === -1) return;
    queue[idx] = { ...queue[idx], ...updates };
    persist();
    notify();
  },

  remove(id) {
    queue = queue.filter((op) => op.id !== id);
    persist();
    notify();
  },

  clear() {
    queue = [];
    persist();
    notify();
  },

  async sync(api, token) {
    const pending = this.getPending();
    const results = [];

    for (const op of pending) {
      try {
        this.update(op.id, { status: 'syncing' });

        let result;
        switch (op.type) {
          case 'sos_trigger':
            result = await api.post('/api/auth/sos', op.payload, token);
            break;
          case 'sos_cancel':
            result = await api.post('/api/auth/sos/cancel', null, token);
            break;
          case 'session_start':
            result = await api.post('/api/sessions', op.payload, token);
            break;
          case 'session_cancel':
            result = await api.post('/api/sessions/cancel', null, token);
            break;
          case 'contact_add':
            result = await api.post('/api/auth/contacts', op.payload, token);
            break;
          case 'contact_update':
            result = await api.put(`/api/auth/contacts/${op.payload.id}`, op.payload.data, token);
            break;
          case 'contact_delete':
            result = await api.delete(`/api/auth/contacts/${op.payload.id}`, token);
            break;
          default:
            throw new Error(`Unknown operation type: ${op.type}`);
        }

        this.update(op.id, { status: 'synced', syncedAt: Date.now(), result });
        results.push({ id: op.id, success: true });
      } catch (err) {
        const retries = op.retries + 1;
        if (retries >= op.maxRetries) {
          this.update(op.id, { status: 'failed', retries, error: err.message });
        } else {
          this.update(op.id, { status: 'queued', retries, error: err.message });
        }
        results.push({ id: op.id, success: false, error: err.message });
      }
    }

    storage.set(KEYS.LAST_SYNC, Date.now());
    return results;
  },
};