const API_BASE = '/api';

const getToken = () => localStorage.getItem('auth_token');
const setToken = (token) => {
  if (token) localStorage.setItem('auth_token', token);
};
const clearToken = () => localStorage.removeItem('auth_token');

const handleResponse = async (res) => {
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || 'Er ging iets mis');
  }
  return data;
};

export const signup = async (payload) => {
  const res = await fetch(`${API_BASE}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await handleResponse(res);
  setToken(data.token);
  return data;
};

export const login = async (payload) => {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await handleResponse(res);
  setToken(data.token);
  return data;
};

export const fetchProfile = async () => {
  const token = getToken();
  if (!token) return null;
  const res = await fetch(`${API_BASE}/me/profile`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) return null;
  const data = await handleResponse(res);
  return data.profile;
};

export const saveProfile = async (profile) => {
  const token = getToken();
  const res = await fetch(`${API_BASE}/me/profile`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(profile),
  });
  const data = await handleResponse(res);
  return data.profile;
};

export const logout = () => clearToken();

export const getStoredToken = () => getToken();
