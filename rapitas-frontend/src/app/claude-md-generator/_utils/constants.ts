/**
 * constants
 *
 * Static data sets for the spec-document generator wizard: genres, sub-genres,
 * elements, platforms, scales, and priorities. Labels are resolved at runtime
 * via the translation function; `icon` is a lucide icon name resolved through
 * the WizardIcon registry (see ./wizard-icons). Emoji were replaced with line
 * icons to match the app's visual language and avoid an "AI-generated" feel.
 */

export const GENRES = [
  { id: 'game', icon: 'Gamepad2' },
  { id: 'sns', icon: 'MessageCircle' },
  { id: 'ecommerce', icon: 'ShoppingBag' },
  { id: 'saas', icon: 'Briefcase' },
  { id: 'media', icon: 'Newspaper' },
  { id: 'health', icon: 'HeartPulse' },
  { id: 'finance', icon: 'Wallet' },
  { id: 'edu', icon: 'GraduationCap' },
  { id: 'ai_tool', icon: 'Bot' },
  { id: 'creative', icon: 'Palette' },
  { id: 'map', icon: 'Map' },
  { id: 'util', icon: 'PocketKnife' },
];

export const SUB_GENRES: Record<string, { id: string; icon: string }[]> = {
  game: [
    { id: 'rpg', icon: 'Swords' },
    { id: 'action', icon: 'Zap' },
    { id: 'shooting', icon: 'Crosshair' },
    { id: 'fighting', icon: 'Sword' },
    { id: 'strategy', icon: 'Castle' },
    { id: 'puzzle', icon: 'Puzzle' },
    { id: 'simulation', icon: 'Building2' },
    { id: 'adventure', icon: 'Compass' },
    { id: 'sports', icon: 'Goal' },
    { id: 'card', icon: 'Spade' },
    { id: 'idle', icon: 'Hourglass' },
    { id: 'rhythm', icon: 'Music' },
  ],
  sns: [
    { id: 'micro', icon: 'MessageSquare' },
    { id: 'photo', icon: 'Image' },
    { id: 'video', icon: 'Video' },
    { id: 'forum', icon: 'MessagesSquare' },
    { id: 'dating', icon: 'Heart' },
    { id: 'local', icon: 'MapPin' },
    { id: 'interest', icon: 'Bookmark' },
    { id: 'pro', icon: 'Contact' },
  ],
  ecommerce: [
    { id: 'b2c', icon: 'Store' },
    { id: 'b2b', icon: 'Factory' },
    { id: 'c2c', icon: 'Handshake' },
    { id: 'subscription', icon: 'RefreshCw' },
    { id: 'digital', icon: 'HardDrive' },
    { id: 'auction', icon: 'Gavel' },
    { id: 'food', icon: 'UtensilsCrossed' },
    { id: 'ticket', icon: 'Ticket' },
  ],
  saas: [
    { id: 'crm', icon: 'Users' },
    { id: 'pm', icon: 'ClipboardList' },
    { id: 'hr', icon: 'Building' },
    { id: 'accounting', icon: 'Calculator' },
    { id: 'helpdesk', icon: 'Headphones' },
    { id: 'analytics', icon: 'LineChart' },
    { id: 'cms', icon: 'FileText' },
    { id: 'inventory', icon: 'Package' },
  ],
  media: [
    { id: 'blog', icon: 'PenTool' },
    { id: 'news', icon: 'Newspaper' },
    { id: 'podcast', icon: 'Mic' },
    { id: 'newsletter', icon: 'Mail' },
    { id: 'wiki', icon: 'BookOpen' },
    { id: 'review', icon: 'Star' },
  ],
  health: [
    { id: 'workout', icon: 'Dumbbell' },
    { id: 'diet', icon: 'Salad' },
    { id: 'sleep', icon: 'Moon' },
    { id: 'mental', icon: 'Brain' },
    { id: 'habit', icon: 'CheckCheck' },
    { id: 'medical', icon: 'Stethoscope' },
  ],
  finance: [
    { id: 'kakeibo', icon: 'Notebook' },
    { id: 'invest', icon: 'TrendingUp' },
    { id: 'crypto', icon: 'Bitcoin' },
    { id: 'budget', icon: 'Banknote' },
    { id: 'split', icon: 'Split' },
    { id: 'tax', icon: 'Receipt' },
  ],
  edu: [
    { id: 'course', icon: 'BookMarked' },
    { id: 'quiz', icon: 'HelpCircle' },
    { id: 'flashcard', icon: 'StickyNote' },
    { id: 'language', icon: 'Languages' },
    { id: 'coding', icon: 'Code' },
    { id: 'kids', icon: 'Baby' },
    { id: 'lms', icon: 'School' },
  ],
  ai_tool: [
    { id: 'chatbot', icon: 'MessageCircle' },
    { id: 'writing', icon: 'PenLine' },
    { id: 'image_gen', icon: 'ImagePlus' },
    { id: 'code_gen', icon: 'Code2' },
    { id: 'data_anal', icon: 'PieChart' },
    { id: 'voice', icon: 'Mic' },
    { id: 'automation', icon: 'Cog' },
    { id: 'search', icon: 'Search' },
  ],
  creative: [
    { id: 'design', icon: 'Brush' },
    { id: 'music', icon: 'Music' },
    { id: 'video_edit', icon: 'Clapperboard' },
    { id: '3d', icon: 'Box' },
    { id: 'photo_edit', icon: 'Camera' },
    { id: 'writing2', icon: 'ScrollText' },
  ],
  map: [
    { id: 'navigation', icon: 'Navigation' },
    { id: 'spot', icon: 'MapPin' },
    { id: 'delivery', icon: 'Truck' },
    { id: 'geofence', icon: 'Radar' },
    { id: 'tourism', icon: 'Plane' },
  ],
  util: [
    { id: 'todo', icon: 'ListChecks' },
    { id: 'note', icon: 'StickyNote' },
    { id: 'calendar', icon: 'Calendar' },
    { id: 'timer', icon: 'Timer' },
    { id: 'password', icon: 'KeyRound' },
    { id: 'file', icon: 'Files' },
    { id: 'translate', icon: 'Languages' },
    { id: 'qr', icon: 'QrCode' },
  ],
};

export const ELEMENTS = [
  { id: 'multiplayer', icon: 'Users' },
  { id: 'realtime', icon: 'Activity' },
  { id: 'auth', icon: 'Lock' },
  { id: 'payment', icon: 'CreditCard' },
  { id: 'ai', icon: 'Bot' },
  { id: 'notification', icon: 'Bell' },
  { id: 'offline', icon: 'WifiOff' },
  { id: 'social', icon: 'Share2' },
  { id: 'analytics', icon: 'LineChart' },
  { id: 'upload', icon: 'Upload' },
  { id: 'map_feat', icon: 'Map' },
  { id: 'search_feat', icon: 'Search' },
  { id: 'admin', icon: 'Settings' },
  { id: 'api_feat', icon: 'Plug' },
  { id: 'multilang', icon: 'Languages' },
  { id: 'dark_mode', icon: 'MoonStar' },
  { id: 'pwa', icon: 'Smartphone' },
  { id: 'export', icon: 'Download' },
  { id: 'subscription_feat', icon: 'RefreshCw' },
  { id: 'ranking', icon: 'Trophy' },
];

export const PLATFORMS = [
  { id: 'web', icon: 'AppWindow' },
  { id: 'ios', icon: 'Apple' },
  { id: 'android', icon: 'Smartphone' },
  { id: 'mobile', icon: 'TabletSmartphone' },
  { id: 'desktop', icon: 'Monitor' },
  { id: 'web_mobile', icon: 'MonitorSmartphone' },
];

export const SCALES = [
  { id: 'solo', icon: 'User' },
  { id: 'small', icon: 'Users' },
  { id: 'mid', icon: 'Building' },
  { id: 'large', icon: 'Network' },
];

export const PRIORITIES = [
  { id: 'speed', icon: 'Zap' },
  { id: 'quality', icon: 'Gem' },
  { id: 'scale', icon: 'TrendingUp' },
  { id: 'security', icon: 'ShieldCheck' },
];

/** A target AI coding agent and the repo path its instruction file lives at. */
export interface AgentTarget {
  /** stable id / 識別子 */
  id: string;
  /** display name (proper noun) / 表示名 */
  label: string;
  /** repo-relative path to write the agent guide to / 指示ファイルの相対パス */
  path: string;
}

/**
 * Where the generated agent guide is written, per primary agent. The first
 * entry is the default. Paths follow each tool's documented convention so the
 * scaffolded repo is immediately usable by that agent.
 */
export const AGENT_TARGETS: AgentTarget[] = [
  { id: 'claude', label: 'Claude Code', path: '.claude/CLAUDE.md' },
  { id: 'agents', label: 'AGENTS.md', path: 'AGENTS.md' },
  { id: 'gemini', label: 'Gemini CLI', path: 'GEMINI.md' },
  { id: 'cursor', label: 'Cursor', path: '.cursorrules' },
  { id: 'copilot', label: 'GitHub Copilot', path: '.github/copilot-instructions.md' },
];
