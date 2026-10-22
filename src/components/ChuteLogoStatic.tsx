import chuteSphere from "../assets/chute-sphere.svg";

interface ChuteLogoStaticProps {
  size?: number;
  className?: string;
}

/** Chute's mark: the same blue sphere as the website (src/assets/chute-sphere.svg). */
export default function ChuteLogoStatic({ size = 24, className = "" }: ChuteLogoStaticProps) {
  return (
    <img
      src={chuteSphere}
      width={size}
      height={size}
      alt=""
      aria-hidden
      draggable={false}
      className={`chute-logo shrink-0 ${className}`.trim()}
    />
  );
}
