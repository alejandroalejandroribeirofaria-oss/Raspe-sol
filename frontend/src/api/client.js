export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

async function request(path, { method = 'GET', body, adminToken } = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(adminToken ? { 'x-admin-token': adminToken } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error?.message || `Request failed: ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/csv')) return response.text();
  return response.json();
}

export const api = {
  config: () => request('/api/config'),
  stats: () => request('/api/stats'),
  leaderboard: () => request('/api/leaderboard'),
  tickets: (wallet) => request(`/api/tickets?wallet=${encodeURIComponent(wallet)}`),
  purchase: (payload) => request('/api/tickets/purchase', { method: 'POST', body: payload }),
  scratch: (ticketId, wallet) => request(`/api/tickets/${ticketId}/scratch`, {
    method: 'POST',
    body: { wallet }
  }),
  adminStats: (adminToken) => request('/api/admin/stats', { adminToken }),
  createManualBatch: (adminToken) => request('/api/admin/batches/manual', {
    method: 'POST',
    adminToken
  }),
  createAutomaticBatch: (adminToken) => request('/api/admin/batches/auto', {
    method: 'POST',
    adminToken
  }),
  searchTickets: (query, adminToken) => {
    const params = new URLSearchParams(Object.entries(query).filter(([, value]) => value));
    return request(`/api/admin/tickets/search?${params.toString()}`, { adminToken });
  },
  markPaid: (uuid, adminToken) => request(`/api/admin/tickets/${uuid}/pay`, {
    method: 'POST',
    adminToken
  }),
  exportReport: (adminToken) => request('/api/admin/report.csv', { adminToken })
};

