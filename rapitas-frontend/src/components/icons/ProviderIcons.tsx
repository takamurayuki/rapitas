import React from 'react';

interface IconProps {
  className?: string;
}

// Simple geometric icon for Claude - hexagon with circuit pattern
export const ClaudeIcon: React.FC<IconProps> = ({ className = 'w-6 h-6' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M12 2L21.5 7.5V16.5L12 22L2.5 16.5V7.5L12 2Z"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
    <path
      d="M12 9V6M12 18V15M9 12H6M18 12H15"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
  </svg>
);

// Simple geometric icon for ChatGPT - rounded square with chat bubble
export const ChatGPTIcon: React.FC<IconProps> = ({ className = 'w-6 h-6' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="3" y="3" width="18" height="18" rx="4" stroke="currentColor" strokeWidth="2" />
    <path d="M8 10H16M8 14H13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

// Simple geometric icon for Gemini - two connected diamonds
export const GeminiIcon: React.FC<IconProps> = ({ className = 'w-6 h-6' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M7 3L12 8L7 13L2 8L7 3Z"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
    />
    <path
      d="M17 11L22 16L17 21L12 16L17 11Z"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
    />
    <path d="M12 8L12 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

// Generic AI icon for fallback
export const GenericAIIcon: React.FC<IconProps> = ({ className = 'w-6 h-6' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
    <path d="M12 7V12L15 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <circle cx="12" cy="12" r="2" fill="currentColor" />
  </svg>
);
