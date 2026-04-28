/**
 * Tomato Icon - Custom icon for Pomodoro timer
 * Based on the original fruit icon from @lucide/lab
 */
import React from 'react';

interface TomatoProps extends React.SVGProps<SVGSVGElement> {
  className?: string;
}

export const Tomato: React.FC<TomatoProps> = ({ className, ...props }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      {/* Tomato body - circle (same size as lucide Circle) */}
      <circle cx="12" cy="12" r="10" />

      {/* Tomato stem - X mark on top */}
      <path d="M10 6l4 4" />
      <path d="M14 6l-4 4" />
    </svg>
  );
};

export default Tomato;
