import { createClient } from '@insforge/sdk';

const insforgeUrl = import.meta.env.VITE_INSFORGE_URL || '';
const insforgeAnonKey = import.meta.env.VITE_INSFORGE_ANON_KEY || '';

export const insforge = createClient({
  baseUrl: insforgeUrl,
  anonKey: insforgeAnonKey,
});

export const isInsforgeConfigured = () => {
  return !!(import.meta.env.VITE_INSFORGE_URL && import.meta.env.VITE_INSFORGE_ANON_KEY);
};
