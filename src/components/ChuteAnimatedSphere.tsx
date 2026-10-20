import { useId, useMemo } from "react";
import ChuteLogoStatic from "./ChuteLogoStatic";

interface ChuteAnimatedSphereProps {
  size?: number;
  className?: string;
}

/** Realistic glass orb with a subtle drift animation for the onboarding hero. */
export default function ChuteAnimatedSphere({
  size = 168,
  className = "",
}: ChuteAnimatedSphereProps) {
  const id = useId().replace(/:/g, "");
  const reduceMotion = useMemo(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  if (reduceMotion) {
    return <ChuteLogoStatic size={size} className={className} />;
  }
  const base = `kla-${id}`;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 128 128"
      fill="none"
      aria-hidden
      className={`chute-logo chute-logo-animated chute-orb-realistic shrink-0 ${className}`.trim()}
    >
      <defs>
        {/* Same palette as the website's mark (website/public/chute-sphere.svg). */}
        <radialGradient id={`${base}-base`} cx="34%" cy="28%" r="72%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="18%" stopColor="#f3f8ff" />
          <stop offset="42%" stopColor="#9ec5ff" />
          <stop offset="68%" stopColor="#4d8ef7" />
          <stop offset="88%" stopColor="#2563eb" />
          <stop offset="100%" stopColor="#1e3a8a" />
        </radialGradient>
        <radialGradient id={`${base}-depth`} cx="72%" cy="78%" r="48%">
          <stop offset="0%" stopColor="#1e40af" stopOpacity="0.62" />
          <stop offset="100%" stopColor="#1e3a8a" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${base}-spec`} cx="28%" cy="22%" r="26%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="55%" stopColor="#ffffff" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${base}-rim`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="84%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="93%" stopColor="#ffffff" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#93c5fd" stopOpacity="0.55" />
        </radialGradient>
        <radialGradient id={`${base}-mist`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#eef4ff" stopOpacity="0.15" />
          <stop offset="55%" stopColor="#ffffff" stopOpacity="0.05" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <clipPath id={`${base}-orb`}>
          <circle cx="64" cy="64" r="54" />
        </clipPath>
        <filter id={`${base}-mist-filter`} x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.018 0.045" numOctaves="2" seed="8" result="noise">
            <animate attributeName="seed" values="8;24;8" dur="20s" repeatCount="indefinite" />
            <animate
              attributeName="baseFrequency"
              values="0.018 0.045;0.022 0.05;0.018 0.045"
              dur="14s"
              repeatCount="indefinite"
            />
          </feTurbulence>
          <feColorMatrix
            in="noise"
            type="matrix"
            values="0 0 0 0 0.97
                    0 0 0 0 0.98
                    0 0 0 0 1
                    0 0 0 0.16 0"
            result="tint"
          />
          <feGaussianBlur in="tint" stdDeviation="1.8" result="soft" />
          <feBlend in="SourceGraphic" in2="soft" mode="soft-light" />
        </filter>
        <filter id={`${base}-soft`} x="-15%" y="-15%" width="130%" height="130%">
          <feGaussianBlur stdDeviation="1.2" />
        </filter>
      </defs>

      <circle cx="64" cy="64" r="56" fill="#60a5fa" fillOpacity="0.1" filter={`url(#${base}-soft)`} />

      <g clipPath={`url(#${base}-orb)`}>
        <circle cx="64" cy="64" r="54" fill={`url(#${base}-base)`} />
        <circle cx="64" cy="64" r="54" fill={`url(#${base}-depth)`} />

        <ellipse cx="64" cy="60" rx="54" ry="15" fill={`url(#${base}-mist)`} opacity="0.75">
          <animate attributeName="opacity" values="0.6;0.8;0.6" dur="8s" repeatCount="indefinite" />
        </ellipse>

        <circle cx="64" cy="64" r="54" fill="#dbeafe" fillOpacity="0.12" filter={`url(#${base}-mist-filter)`} />

        <g transform="translate(64 64)">
          <g>
            <animateTransform
              attributeName="transform"
              type="rotate"
              from="0"
              to="360"
              dur="28s"
              repeatCount="indefinite"
            />
            <ellipse cx="-16" cy="-20" rx="15" ry="10" fill="#ffffff" fillOpacity="0.18" filter={`url(#${base}-soft)`} />
          </g>
        </g>

        <circle cx="64" cy="64" r="54" fill={`url(#${base}-spec)`} />
        <circle cx="64" cy="64" r="54" fill={`url(#${base}-rim)`} />
      </g>
    </svg>
  );
}
