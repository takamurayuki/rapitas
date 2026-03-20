/**
 * constants
 *
 * Static data sets for the CLAUDE.md generator wizard: genres, sub-genres,
 * elements, platforms, scales, and priorities. Labels are resolved at runtime
 * via the translation function — only IDs and icons live here.
 */

export const GENRES = [
  { id: 'game', icon: '🎮' },
  { id: 'sns', icon: '💬' },
  { id: 'ecommerce', icon: '🛍' },
  { id: 'saas', icon: '💼' },
  { id: 'media', icon: '📰' },
  { id: 'health', icon: '🏋' },
  { id: 'finance', icon: '💰' },
  { id: 'edu', icon: '📚' },
  { id: 'ai_tool', icon: '🤖' },
  { id: 'creative', icon: '🎨' },
  { id: 'map', icon: '🗺' },
  { id: 'util', icon: '🔧' },
];

export const SUB_GENRES: Record<string, { id: string; icon: string }[]> = {
  game: [
    { id: 'rpg', icon: '⚔️' },
    { id: 'action', icon: '💥' },
    { id: 'shooting', icon: '🔫' },
    { id: 'fighting', icon: '🥊' },
    { id: 'strategy', icon: '♟' },
    { id: 'puzzle', icon: '🧩' },
    { id: 'simulation', icon: '🏙' },
    { id: 'adventure', icon: '🌍' },
    { id: 'sports', icon: '⚽' },
    { id: 'card', icon: '🃏' },
    { id: 'idle', icon: '⏱' },
    { id: 'rhythm', icon: '🎵' },
  ],
  sns: [
    { id: 'micro', icon: '🐦' },
    { id: 'photo', icon: '📸' },
    { id: 'video', icon: '🎬' },
    { id: 'forum', icon: '💭' },
    { id: 'dating', icon: '❤️' },
    { id: 'local', icon: '📍' },
    { id: 'interest', icon: '🔖' },
    { id: 'pro', icon: '👔' },
  ],
  ecommerce: [
    { id: 'b2c', icon: '🏪' },
    { id: 'b2b', icon: '🏭' },
    { id: 'c2c', icon: '🤝' },
    { id: 'subscription', icon: '🔄' },
    { id: 'digital', icon: '💾' },
    { id: 'auction', icon: '🔨' },
    { id: 'food', icon: '🍔' },
    { id: 'ticket', icon: '🎟' },
  ],
  saas: [
    { id: 'crm', icon: '👥' },
    { id: 'pm', icon: '📋' },
    { id: 'hr', icon: '🏢' },
    { id: 'accounting', icon: '📊' },
    { id: 'helpdesk', icon: '🎧' },
    { id: 'analytics', icon: '📈' },
    { id: 'cms', icon: '📝' },
    { id: 'inventory', icon: '📦' },
  ],
  media: [
    { id: 'blog', icon: '✍️' },
    { id: 'news', icon: '📰' },
    { id: 'podcast', icon: '🎙' },
    { id: 'newsletter', icon: '📧' },
    { id: 'wiki', icon: '📖' },
    { id: 'review', icon: '⭐' },
  ],
  health: [
    { id: 'workout', icon: '💪' },
    { id: 'diet', icon: '🥗' },
    { id: 'sleep', icon: '😴' },
    { id: 'mental', icon: '🧘' },
    { id: 'habit', icon: '✅' },
    { id: 'medical', icon: '🏥' },
  ],
  finance: [
    { id: 'kakeibo', icon: '📒' },
    { id: 'invest', icon: '📈' },
    { id: 'crypto', icon: '🪙' },
    { id: 'budget', icon: '💵' },
    { id: 'split', icon: '🍕' },
    { id: 'tax', icon: '🧾' },
  ],
  edu: [
    { id: 'course', icon: '🎓' },
    { id: 'quiz', icon: '❓' },
    { id: 'flashcard', icon: '🗂' },
    { id: 'language', icon: '🌐' },
    { id: 'coding', icon: '💻' },
    { id: 'kids', icon: '👶' },
    { id: 'lms', icon: '🏫' },
  ],
  ai_tool: [
    { id: 'chatbot', icon: '💬' },
    { id: 'writing', icon: '✍️' },
    { id: 'image_gen', icon: '🖼' },
    { id: 'code_gen', icon: '⌨️' },
    { id: 'data_anal', icon: '📊' },
    { id: 'voice', icon: '🎤' },
    { id: 'automation', icon: '⚙️' },
    { id: 'search', icon: '🔍' },
  ],
  creative: [
    { id: 'design', icon: '🎨' },
    { id: 'music', icon: '🎵' },
    { id: 'video_edit', icon: '🎬' },
    { id: '3d', icon: '🧊' },
    { id: 'photo_edit', icon: '📸' },
    { id: 'writing2', icon: '📖' },
  ],
  map: [
    { id: 'navigation', icon: '🧭' },
    { id: 'spot', icon: '📍' },
    { id: 'delivery', icon: '🚚' },
    { id: 'geofence', icon: '📡' },
    { id: 'tourism', icon: '🏖' },
  ],
  util: [
    { id: 'todo', icon: '✅' },
    { id: 'note', icon: '📝' },
    { id: 'calendar', icon: '📅' },
    { id: 'timer', icon: '⏱' },
    { id: 'password', icon: '🔐' },
    { id: 'file', icon: '📁' },
    { id: 'translate', icon: '🌐' },
    { id: 'qr', icon: '📱' },
  ],
};

export const ELEMENTS = [
  { id: 'multiplayer', icon: '👥' },
  { id: 'realtime', icon: '⚡' },
  { id: 'auth', icon: '🔐' },
  { id: 'payment', icon: '💳' },
  { id: 'ai', icon: '🤖' },
  { id: 'notification', icon: '🔔' },
  { id: 'offline', icon: '📵' },
  { id: 'social', icon: '💬' },
  { id: 'analytics', icon: '📊' },
  { id: 'upload', icon: '📁' },
  { id: 'map_feat', icon: '🗺' },
  { id: 'search_feat', icon: '🔍' },
  { id: 'admin', icon: '🛠' },
  { id: 'api_feat', icon: '🔌' },
  { id: 'multilang', icon: '🌍' },
  { id: 'dark_mode', icon: '🌙' },
  { id: 'pwa', icon: '📲' },
  { id: 'export', icon: '📤' },
  { id: 'subscription_feat', icon: '🔄' },
  { id: 'ranking', icon: '🏆' },
];

export const PLATFORMS = [
  { id: 'web', icon: '🌐' },
  { id: 'ios', icon: '🍎' },
  { id: 'android', icon: '🤖' },
  { id: 'mobile', icon: '📲' },
  { id: 'desktop', icon: '🖥' },
  { id: 'web_mobile', icon: '🔀' },
];

export const SCALES = [
  { id: 'solo', icon: '🧑' },
  { id: 'small', icon: '👨‍👩‍👧' },
  { id: 'mid', icon: '🏘' },
  { id: 'large', icon: '🌏' },
];

export const PRIORITIES = [
  { id: 'speed', icon: '⚡' },
  { id: 'quality', icon: '🏆' },
  { id: 'scale', icon: '📈' },
  { id: 'security', icon: '🔒' },
];
