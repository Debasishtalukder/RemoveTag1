import * as React from "react";

interface RemoveTagLogoProps {
  className?: string;
  size?: "sm" | "md" | "lg" | "xl";
}

export function RemoveTagLogo({ className = "", size = "md" }: RemoveTagLogoProps) {
  // Dimensions and styling based on size
  let width = "155px";
  let height = "41px";
  
  if (size === "sm") {
    width = "120px";
    height = "32px";
  } else if (size === "lg") {
    width = "220px";
    height = "58px";
  } else if (size === "xl") {
    width = "300px";
    height = "80px";
  }

  return (
    <svg
      viewBox="0 0 310 82"
      style={{ width, height }}
      className={`select-none ${className}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <style>{`
          .logo-text-base {
            font-family: 'Fredoka', 'Plus Jakarta Sans', system-ui, sans-serif;
            font-size: 52px;
            font-weight: 700;
            fill: #ffffff;
            stroke: #1e293b;
            stroke-width: 10px;
            paint-order: stroke fill;
            stroke-linejoin: round;
            stroke-linecap: round;
          }
        `}</style>
      </defs>
      
      {/* 1. Underlying Hand-drawn Wavy Underline for "Remove" */}
      <path
        d="M 32,68 Q 105,79 175,68"
        stroke="#1e293b"
        strokeWidth="4.5"
        fill="none"
        strokeLinecap="round"
      />
      
      {/* 2. Top-right swoosh/brow accent above "Tag" */}
      <path
        d="M 194,18 Q 214,11 234,19"
        stroke="#1e293b"
        strokeWidth="4.5"
        fill="none"
        strokeLinecap="round"
      />
      
      {/* 3. Bubbly letter strokes with absolute positioning of each character */}
      <text
        x="10 43 70 110 140 168 194 224 252"
        y="56"
        className="logo-text-base"
      >
        RemoveTag
      </text>
      
      {/* 4. Orange inner counter dot within the character 'o' */}
      <circle
        cx="126"
        cy="41.2"
        r="7.5"
        fill="#ff4b1f"
        stroke="#1e293b"
        strokeWidth="3.2"
      />
    </svg>
  );
}
