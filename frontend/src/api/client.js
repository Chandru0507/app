const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

const DEFAULT_TIMEOUT = 10000;

class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new ApiError('Request timed out. Please check your network connection.', 0);
    }
    throw new ApiError('Network error. Please check your connection and try again.', 0);
  }
}

async function handleResponse(response) {
  let data;
  try {
    data = await response.json();
  } catch {
    throw new ApiError('Invalid response from server', response.status);
  }

  if (!response.ok) {
    throw new ApiError(data.message || 'Request failed', response.status, data);
  }

  return data;
}

function getHeaders(token = null) {
  const headers = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

export const api = {
  get: async (path, token = null) => {
    const response = await fetchWithTimeout(`${API_URL}${path}`, {
      method: 'GET',
      headers: getHeaders(token),
    });
    return handleResponse(response);
  },

  post: async (path, data = null, token = null) => {
    const options = {
      method: 'POST',
      headers: getHeaders(token),
    };
    if (data !== null) {
      options.body = JSON.stringify(data);
    }
    const response = await fetchWithTimeout(`${API_URL}${path}`, options);
    return handleResponse(response);
  },

  put: async (path, data = null, token = null) => {
    const options = {
      method: 'PUT',
      headers: getHeaders(token),
    };
    if (data !== null) {
      options.body = JSON.stringify(data);
    }
    const response = await fetchWithTimeout(`${API_URL}${path}`, options);
    return handleResponse(response);
  },

  delete: async (path, token = null) => {
    const response = await fetchWithTimeout(`${API_URL}${path}`, {
      method: 'DELETE',
      headers: getHeaders(token),
    });
    return handleResponse(response);
  },
};

export { ApiError };
export default api;