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
        <radialGradient id={`${base}-base`} cx="36%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#f8fbff" />
          <stop offset="22%" stopColor="#c8dcff" />
          <stop offset="48%" stopColor="#6b9de8" />
          <stop offset="74%" stopColor="#3d6fb8" />
          <stop offset="100%" stopColor="#1e3358" />
        </radialGradient>
        <radialGradient id={`${base}-depth`} cx="68%" cy="76%" r="50%">
          <stop offset="0%" stopColor="#152a4a" stopOpacity="0.75" />
          <stop offset="100%" stopColor="#0c1524" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${base}-spec`} cx="30%" cy="24%" r="24%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.88" />
          <stop offset="55%" stopColor="#ffffff" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${base}-rim`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="86%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="94%" stopColor="#ffffff" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#8eb8f0" stopOpacity="0.38" />
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

      <circle cx="64" cy="64" r="57" fill="#ffffff" fillOpacity="0.04" filter={`url(#${base}-soft)`} />

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
