import { Camera, MediaType, EncodingType } from '@capacitor/camera';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';

const EVIDENCE_DIR = 'evidence';
const MEDIA_DIR = `${EVIDENCE_DIR}/media`;
const INDEX_FILE = `${EVIDENCE_DIR}/index.json`;

function isNative() {
  return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
}

async function ensureDirs() {
  if (!isNative()) return;
  try {
    await Filesystem.mkdir({ path: MEDIA_DIR, directory: Directory.Data, recursive: true });
  } catch {
    // Directory may already exist
  }
}

async function readIndex() {
  try {
    const result = await Filesystem.readFile({
      path: INDEX_FILE,
      directory: Directory.Data,
      encoding: Encoding.UTF8,
    });
    return JSON.parse(result.data || '[]');
  } catch {
    return [];
  }
}

async function writeIndex(items) {
  await Filesystem.writeFile({
    path: INDEX_FILE,
    directory: Directory.Data,
    encoding: Encoding.UTF8,
    data: JSON.stringify(items),
    recursive: true,
  });
}

export const evidenceService = {
  isNative,

  async checkPermissions() {
    try {
      const status = await Camera.checkPermissions();
      return status;
    } catch (err) {
      return { camera: 'denied', photos: 'denied', error: err.message };
    }
  },

  async requestPermissions() {
    try {
      return await Camera.requestPermissions({ permissions: ['camera'] });
    } catch (err) {
      return { camera: 'denied', error: err.message };
    }
  },

  // Capture a photo and persist it to app-private storage.
  async capturePhoto(location = {}) {
    const permission = await this.requestPermissions();
    if (permission.camera !== 'granted' && permission.camera !== 'limited') {
      return { success: false, reason: 'permission_denied', message: 'Camera permission denied.' };
    }

    try {
      const result = await Camera.takePhoto({
        quality: 80,
        encodingType: EncodingType.JPEG,
        saveToGallery: false,
        includeMetadata: true,
      });

      return await this.persistEvidence(result, 'photo', location);
    } catch (err) {
      const code = err && err.code;
      if (code === 'OS-PLUG-CAMR-0006') {
        return { success: false, reason: 'cancelled', message: 'Photo capture cancelled.' };
      }
      return { success: false, reason: 'error', message: err.message || 'Failed to capture photo.' };
    }
  },

  // Record a video and persist it to app-private storage.
  async recordVideo(location = {}) {
    if (!isNative()) {
      return { success: false, reason: 'unsupported', message: 'Video recording is not available on web.' };
    }

    const permission = await this.requestPermissions();
    if (permission.camera !== 'granted' && permission.camera !== 'limited') {
      return { success: false, reason: 'permission_denied', message: 'Camera permission denied.' };
    }

    try {
      const result = await Camera.recordVideo({
        saveToGallery: false,
        isPersistent: true,
        includeMetadata: true,
      });

      return await this.persistEvidence(result, 'video', location);
    } catch (err) {
      const code = err && err.code;
      if (code === 'OS-PLUG-CAMR-0017') {
        return { success: false, reason: 'cancelled', message: 'Video recording cancelled.' };
      }
      return { success: false, reason: 'error', message: err.message || 'Failed to record video.' };
    }
  },

  async persistEvidence(result, type, location) {
    await ensureDirs();

    const id = `ev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const ext = type === 'video' ? 'mp4' : 'jpg';
    const mediaPath = `${MEDIA_DIR}/${id}.${ext}`;

    let sourcePath = result.uri || result.webPath;
    let mediaData = null;

    // Copy media into app-private storage when possible.
    if (isNative() && sourcePath) {
      try {
        const read = await Filesystem.readFile({ path: sourcePath });
        mediaData = read.data;
        await Filesystem.writeFile({
          path: mediaPath,
          directory: Directory.Data,
          data: mediaData,
          recursive: true,
        });
      } catch (err) {
        // Fall back to the original URI if the copy fails.
        console.warn('Evidence copy failed, using original path:', err.message);
      }
    }

    const evidence = {
      id,
      type,
      filename: `${id}.${ext}`,
      mediaPath,
      sourceUri: sourcePath,
      thumbnail: result.thumbnail || null,
      webPath: result.webPath || null,
      mimeType: type === 'video' ? 'video/mp4' : 'image/jpeg',
      size: result.metadata && result.metadata.size ? result.metadata.size : null,
      duration: result.metadata && result.metadata.duration ? result.metadata.duration : null,
      createdAt: new Date().toISOString(),
      latitude: location.latitude || null,
      longitude: location.longitude || null,
      accuracy: location.accuracy || null,
      syncState: 'local_only',
      uploaded: false,
    };

    const items = await readIndex();
    items.unshift(evidence);
    await writeIndex(items);

    return { success: true, evidence };
  },

  async list() {
    return readIndex();
  },

  async get(id) {
    const items = await readIndex();
    return items.find((i) => i.id === id) || null;
  },

  async rename(id, name) {
    const items = await readIndex();
    const item = items.find((i) => i.id === id);
    if (!item) return { success: false, reason: 'not_found' };
    item.name = name;
    item.renamedAt = new Date().toISOString();
    await writeIndex(items);
    return { success: true, evidence: item };
  },

  async remove(id) {
    const items = await readIndex();
    const item = items.find((i) => i.id === id);
    if (item) {
      try {
        await Filesystem.deleteFile({ path: item.mediaPath, directory: Directory.Data });
      } catch {
        // File may not exist
      }
    }
    const remaining = items.filter((i) => i.id !== id);
    await writeIndex(remaining);
    return { success: true };
  },

  // Explicit user-initiated export. Never automatic.
  async exportEvidence(id) {
    const item = await this.get(id);
    if (!item) return { success: false, reason: 'not_found' };

    try {
      const result = await Filesystem.readFile({
        path: item.mediaPath,
        directory: Directory.Data,
        encoding: Encoding.UTF8,
      });
      return { success: true, data: result.data, filename: item.filename, mimeType: item.mimeType };
    } catch (err) {
      // Fall back to source URI if the private copy is unavailable.
      return { success: false, reason: 'read_error', message: err.message };
    }
  },

  async clearAll() {
    const items = await readIndex();
    for (const item of items) {
      try {
        await Filesystem.deleteFile({ path: item.mediaPath, directory: Directory.Data });
      } catch {
        // ignore
      }
    }
    await writeIndex([]);
    return { success: true };
  },
};