export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  (process.env.NODE_ENV === 'production'
    ? 'https://linguawave-backend-qk64.onrender.com/api/v1'
    : 'http://localhost:5000/api/v1');

export const SOCKET_URL =
  process.env.NEXT_PUBLIC_SOCKET_URL || API_URL.replace(/\/api\/v1\/?$/, '');

export const LANGUAGES = [
  { code: 'en', name: 'English', flag: '🇺🇸', speech: 'en-US' },
  { code: 'fr', name: 'French', flag: '🇫🇷', speech: 'fr-FR' },
  { code: 'es', name: 'Spanish', flag: '🇪🇸', speech: 'es-ES' },
  { code: 'de', name: 'German', flag: '🇩🇪', speech: 'de-DE' },
  { code: 'ja', name: 'Japanese', flag: '🇯🇵', speech: 'ja-JP' },
  { code: 'zh', name: 'Mandarin', flag: '🇨🇳', speech: 'zh-CN' },
  { code: 'it', name: 'Italian', flag: '🇮🇹', speech: 'it-IT' },
  { code: 'pt', name: 'Portuguese', flag: '🇧🇷', speech: 'pt-BR' },
];
