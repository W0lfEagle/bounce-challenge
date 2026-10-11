export const apiUrl = (process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:3000').replace(
  /\/$/,
  '',
);

export const backends = [
  { id: 'node', label: 'Node.js', url: apiUrl },
  {
    id: 'elixir',
    label: 'Elixir',
    url: (process.env.EXPO_PUBLIC_ELIXIR_API_URL ?? 'http://127.0.0.1:3001').replace(/\/$/, ''),
  },
] as const;

export type Backend = (typeof backends)[number];

export function loadBackend(): Backend {
  try {
    return (
      backends.find(
        (backend) => backend.id === globalThis.sessionStorage?.getItem('bounce:backend'),
      ) ?? backends[0]
    );
  } catch {
    return backends[0];
  }
}

export function saveBackend(backend: Backend) {
  try {
    globalThis.sessionStorage?.setItem('bounce:backend', backend.id);
  } catch {
    // Selection still works when browser storage is unavailable.
  }
}
