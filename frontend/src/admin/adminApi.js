const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';

async function request(path, token, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'x-admin-token': token, 'Content-Type': 'application/json', ...options.headers },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || data.error || 'REQUEST_FAILED');
    err.code = data.error;
    throw err;
  }
  return data;
}

export const fetchDashboard = (token) => request('/api/admin/dashboard', token);
export const fetchChatStats = (token) => request('/api/admin/chat', token);
export const clearChat = (token) => request('/api/admin/chat/clear', token, { method: 'POST' });
export const kickChatWallet = (token, wallet) =>
  request('/api/admin/chat/kick', token, { method: 'POST', body: JSON.stringify({ wallet }) });
export const blockChatWallet = (token, wallet, minutes, reason) =>
  request('/api/admin/chat/block', token, { method: 'POST', body: JSON.stringify({ wallet, minutes, reason }) });

export const fetchClaims = (token) => request('/api/admin/claims', token);
export const markClaimPaid = (token, ticketUuid, admin) =>
  request(`/api/admin/claims/${ticketUuid}/mark-paid`, token, { method: 'POST', body: JSON.stringify({ admin }) });

export const fetchLots = (token) => request('/api/admin/lots', token);

