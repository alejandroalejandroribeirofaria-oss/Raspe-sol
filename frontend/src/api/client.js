const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

function authHeaders(token) {
  return {
    'Content-Type': 'application/json',
    'x-admin-token': token,
  };
}

async function request(url, options = {}) {
  const response = await fetch(url, options);

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error?.message || `Request failed: ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/csv')) {
    return response.text();
  }
  return response.json();
}

export const api = {
  // Public endpoints
  config: () => request(`${API_URL}/api/config`),
  stats: () => request(`${API_URL}/api/stats`),
  leaderboard: () => request(`${API_URL}/api/leaderboard`),

  tickets: (wallet) => 
    request(`${API_URL}/api/tickets/${encodeURIComponent(wallet)}`), // <-- só deixa essa

  purchase: (body) => 
    request(`${API_URL}/api/tickets/buy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  scratch: (id, wallet) => 
    request(`${API_URL}/api/tickets/${id}/scratch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet }),
    }),

  // Admin endpoints
  searchTickets: (query, token) => {
    const params = new URLSearchParams(
      Object.entries(query).filter(([, value]) => value != null && value !== '')
    ).toString();

    return request(`${API_URL}/api/tickets/search?${params}`, {
      headers: authHeaders(token),
    });
  },

  createManualBatch: (token) => 
    request(`${API_URL}/api/admin/create-batch`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ type: 'manual' }),
    }),

  createAutomaticBatch: (token) => 
    request(`${API_URL}/api/admin/create-batch`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ type: 'auto' }),
    }),

  exportReport: (token) => 
    request(`${API_URL}/api/admin/report.csv`, {
      headers: authHeaders(token),
    }),
};
