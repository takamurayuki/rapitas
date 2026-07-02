// NOTE: `nameKey` / `labelKey` look up the display text in the `notes.editorColors`
// i18n namespace (see the 4 toolbar consumers); `value` stays a raw CSS color / font.
export const highlightColors = [
  { nameKey: 'yellow', value: '#fef08a' },
  { nameKey: 'green', value: '#bbf7d0' },
  { nameKey: 'blue', value: '#bfdbfe' },
  { nameKey: 'pink', value: '#fbcfe8' },
  { nameKey: 'purple', value: '#e9d5ff' },
  { nameKey: 'orange', value: '#fed7aa' },
] as const;

export const borderLineColors = [
  { nameKey: 'gray', value: '#a1a1aa' },
  { nameKey: 'blue', value: '#3b82f6' },
  { nameKey: 'green', value: '#22c55e' },
  { nameKey: 'red', value: '#ef4444' },
  { nameKey: 'purple', value: '#a855f7' },
  { nameKey: 'orange', value: '#f97316' },
] as const;

export const highlightStyles = [
  { nameKey: 'full', top: 0, label: 'A' },
  { nameKey: 'boldMarker', top: 50, label: 'A' },
  { nameKey: 'thinMarker', top: 70, label: 'A' },
  { nameKey: 'underline', top: 85, label: 'A' },
] as const;

export const programmingLanguages = [
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'python', label: 'Python' },
  { value: 'java', label: 'Java' },
  { value: 'csharp', label: 'C#' },
  { value: 'cpp', label: 'C++' },
  { value: 'c', label: 'C' },
  { value: 'ruby', label: 'Ruby' },
  { value: 'go', label: 'Go' },
  { value: 'rust', label: 'Rust' },
  { value: 'php', label: 'PHP' },
  { value: 'swift', label: 'Swift' },
  { value: 'kotlin', label: 'Kotlin' },
  { value: 'html', label: 'HTML' },
  { value: 'css', label: 'CSS' },
  { value: 'sql', label: 'SQL' },
  { value: 'bash', label: 'Bash' },
  { value: 'powershell', label: 'PowerShell' },
  { value: 'json', label: 'JSON' },
  { value: 'xml', label: 'XML' },
  { value: 'yaml', label: 'YAML' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'plaintext', label: 'Plain Text' },
];

export const fontSizes = [
  { value: '12px', label: '12px' },
  { value: '14px', label: '14px' },
  { value: '16px', label: '16px（標準）' },
  { value: '18px', label: '18px' },
  { value: '20px', label: '20px' },
  { value: '24px', label: '24px' },
  { value: '28px', label: '28px' },
  { value: '32px', label: '32px' },
  { value: '36px', label: '36px' },
];

export const fonts = [
  { value: 'inherit', labelKey: 'default' },
  { value: "'Noto Sans JP', sans-serif", labelKey: 'notoSansJp' },
  { value: "'Hiragino Sans', sans-serif", labelKey: 'hiraginoSans' },
  { value: "'Yu Gothic', sans-serif", labelKey: 'yuGothic' },
  { value: "'Meiryo', sans-serif", labelKey: 'meiryo' },
  { value: "'MS Gothic', monospace", labelKey: 'msGothic' },
  { value: 'Georgia, serif', labelKey: 'georgia' },
  { value: 'Arial, sans-serif', labelKey: 'arial' },
  { value: "'Times New Roman', serif", labelKey: 'timesNewRoman' },
  { value: "'Courier New', monospace", labelKey: 'courierNew' },
  { value: "'Consolas', monospace", labelKey: 'consolas' },
] as const;

export const textColors = [
  { name: '黒', value: '#000000' },
  { name: '濃いグレー', value: '#374151' },
  { name: 'グレー', value: '#6b7280' },
  { name: '薄いグレー', value: '#9ca3af' },
  { name: '赤', value: '#dc2626' },
  { name: 'オレンジ', value: '#ea580c' },
  { name: '黄', value: '#ca8a04' },
  { name: '緑', value: '#16a34a' },
  { name: '青', value: '#2563eb' },
  { name: '藍色', value: '#4f46e5' },
  { name: '紫', value: '#9333ea' },
  { name: 'ピンク', value: '#db2777' },
];

/** Font size presets shown in the dropdown picker */
export const fontSizePresets = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 32, 36, 48, 72];

/** Quick-access text color palette */
export const quickTextColors = [
  { color: '#000000', nameKey: 'black' },
  { color: '#DC2626', nameKey: 'red' },
  { color: '#EA580C', nameKey: 'orange' },
  { color: '#16A34A', nameKey: 'green' },
  { color: '#2563EB', nameKey: 'blue' },
  { color: '#9333EA', nameKey: 'purple' },
] as const;

/** Gray scale palette row */
export const grayScalePalette = [
  '#FFFFFF',
  '#F4F4F5',
  '#E4E4E7',
  '#D4D4D8',
  '#A1A1AA',
  '#71717A',
  '#52525B',
  '#3F3F46',
  '#27272A',
  '#000000',
];

/** Extended color palette row */
export const extendedColorPalette = [
  '#FCA5A5',
  '#FDBA74',
  '#FDE047',
  '#BEF264',
  '#86EFAC',
  '#6EE7B7',
  '#5EEAD4',
  '#7DD3FC',
  '#93C5FD',
  '#C4B5FD',
  '#E9D5FF',
  '#F9A8D4',
  '#FDA4AF',
  '#FCD34D',
  '#A3E635',
  '#4ADE80',
  '#2DD4BF',
  '#38BDF8',
  '#818CF8',
  '#C084FC',
];
