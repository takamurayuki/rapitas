export const highlightColors = [
  { name: 'イエロー', value: '#fef08a' },
  { name: 'グリーン', value: '#bbf7d0' },
  { name: 'ブルー', value: '#bfdbfe' },
  { name: 'ピンク', value: '#fbcfe8' },
  { name: 'パープル', value: '#e9d5ff' },
  { name: 'オレンジ', value: '#fed7aa' },
];

export const borderLineColors = [
  { name: 'グレー', value: '#a1a1aa' },
  { name: 'ブルー', value: '#3b82f6' },
  { name: 'グリーン', value: '#22c55e' },
  { name: 'レッド', value: '#ef4444' },
  { name: 'パープル', value: '#a855f7' },
  { name: 'オレンジ', value: '#f97316' },
];

export const highlightStyles = [
  { name: '全体', top: 0, label: 'A' },
  { name: '太マーカー', top: 50, label: 'A' },
  { name: '細マーカー', top: 70, label: 'A' },
  { name: '下線', top: 85, label: 'A' },
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
  { value: 'inherit', label: 'デフォルト' },
  { value: "'Noto Sans JP', sans-serif", label: 'Noto Sans JP' },
  { value: "'Hiragino Sans', sans-serif", label: 'ヒラギノ角ゴ' },
  { value: "'Yu Gothic', sans-serif", label: '游ゴシック' },
  { value: "'Meiryo', sans-serif", label: 'メイリオ' },
  { value: "'MS Gothic', monospace", label: 'MS ゴシック' },
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: 'Arial, sans-serif', label: 'Arial' },
  { value: "'Times New Roman', serif", label: 'Times New Roman' },
  { value: "'Courier New', monospace", label: 'Courier New' },
  { value: "'Consolas', monospace", label: 'Consolas' },
];

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
  { color: '#000000', name: '黒' },
  { color: '#DC2626', name: '赤' },
  { color: '#EA580C', name: '橙' },
  { color: '#16A34A', name: '緑' },
  { color: '#2563EB', name: '青' },
  { color: '#9333EA', name: '紫' },
];

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
