import { api } from './api.js';

export const state = {
  user: null,
  ready: false,
};

const listeners = new Set();

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function commit(user) {
  state.user = user;
  for (const listener of listeners) {
    try {
      listener(user);
    } catch (error) {
      console.error('store listener failed', error);
    }
  }
}

export async function boot() {
  try {
    state.user = await api('/auth/me');
  } catch {
    state.user = null;
  } finally {
    state.ready = true;
  }
  return state.user;
}

export async function refreshMe() {
  const user = await api('/auth/me');
  commit(user);
  return user;
}

export async function login(email, password) {
  const user = await api('/auth/login', { method: 'POST', body: { email, password } });
  commit(user);
  return user;
}

export async function register(payload) {
  const user = await api('/auth/register', { method: 'POST', body: payload });
  commit(user);
  return user;
}

export async function logout() {
  try {
    await api('/auth/logout', { method: 'POST' });
  } finally {
    commit(null);
  }
}

export function setUser(user) {
  commit(user);
}

export function isDriver() {
  return state.user?.role === 'driver';
}

export function isAdmin() {
  return state.user?.role === 'admin';
}

export function isCustomer() {
  return state.user?.role === 'customer';
}
