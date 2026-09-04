/**
 * Mint Financial Group logo, recreated as vector so it stays crisp at any size.
 * Composition mirrors the original: gold-framed navy triangle with an MFG monogram,
 * a gold sweep, then the "Mint Financial" serif wordmark and a letter-spaced "GROUP".
 * Drop the official PNG at /public/mfg-logo.png and set USE_PNG to true to swap it in.
 */
const USE_PNG = false;

export function MfgMark({ size = 56, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size * 0.82} viewBox="0 0 300 246" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="mfg-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f1e3b5" />
          <stop offset="0.45" stopColor="#ebb43b" />
          <stop offset="1" stopColor="#a88656" />
        </linearGradient>
        <linearGradient id="mfg-navy-l" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a4f8f" />
          <stop offset="1" stopColor="#1b2d63" />
        </linearGradient>
        <linearGradient id="mfg-navy-r" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1b2d63" />
          <stop offset="1" stopColor="#0b1530" />
        </linearGradient>
      </defs>
      {/* sweep */}
      <path d="M22 178 C 90 96, 214 62, 286 96 C 248 74, 150 96, 74 160 Z" fill="url(#mfg-gold)" opacity="0.95" />
      {/* framed triangle */}
      <path d="M150 12 L272 226 L28 226 Z" fill="url(#mfg-gold)" />
      <path d="M150 40 L150 210 L48 210 Z" fill="url(#mfg-navy-l)" />
      <path d="M150 40 L252 210 L150 210 Z" fill="url(#mfg-navy-r)" />
      {/* gold ladder on the right edge */}
      {Array.from({ length: 9 }).map((_, i) => {
        const y = 62 + i * 17;
        const x = 150 + (y - 40) * 0.6;
        return <rect key={i} x={x - 2} y={y} width={14} height={6} fill="#f1e3b5" opacity="0.85" transform={`skewX(-30)`} style={{ transformOrigin: `${x}px ${y}px` }} />;
      })}
      <text x="150" y="190" textAnchor="middle" fontFamily="'Cormorant Garamond', Georgia, serif" fontWeight="600" fontSize="86" fill="#ffffff" letterSpacing="-2">MFG</text>
    </svg>
  );
}

export function MfgLogo({ tone = "light", height = 64, className = "" }: { tone?: "light" | "dark"; height?: number; className?: string }) {
  if (USE_PNG) {
    return <img src="/mfg-logo.png" alt="Mint Financial Group" style={{ height }} className={`w-auto ${className}`} />;
  }
  const word = tone === "light" ? "#f5f2ea" : "#0b1530";
  const group = tone === "light" ? "#b8bcc8" : "#9aa0ad";
  return (
    <svg height={height} viewBox="0 0 720 220" className={`w-auto ${className}`} role="img" aria-label="Mint Financial Group">
      <g transform="translate(0 4) scale(0.72)">
        <MarkInner />
      </g>
      <text x="236" y="118" fontFamily="'Cormorant Garamond', Georgia, serif" fontWeight="600" fontSize="84" fill={word} textLength="470" lengthAdjust="spacingAndGlyphs">Mint Financial</text>
      <line x1="240" y1="160" x2="360" y2="160" stroke={group} strokeWidth="1.5" opacity="0.7" />
      <text x="471" y="167" textAnchor="middle" fontFamily="'DM Sans', system-ui, sans-serif" fontWeight="500" fontSize="26" fill={group} letterSpacing="9">GROUP</text>
      <line x1="582" y1="160" x2="704" y2="160" stroke={group} strokeWidth="1.5" opacity="0.7" />
    </svg>
  );
}

function MarkInner() {
  return (
    <>
      <defs>
        <linearGradient id="mfg-gold2" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f1e3b5" />
          <stop offset="0.45" stopColor="#ebb43b" />
          <stop offset="1" stopColor="#a88656" />
        </linearGradient>
        <linearGradient id="mfg-navy-l2" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a4f8f" />
          <stop offset="1" stopColor="#1b2d63" />
        </linearGradient>
        <linearGradient id="mfg-navy-r2" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1b2d63" />
          <stop offset="1" stopColor="#0b1530" />
        </linearGradient>
      </defs>
      <path d="M22 178 C 90 96, 214 62, 286 96 C 248 74, 150 96, 74 160 Z" fill="url(#mfg-gold2)" opacity="0.95" />
      <path d="M150 12 L272 226 L28 226 Z" fill="url(#mfg-gold2)" />
      <path d="M150 40 L150 210 L48 210 Z" fill="url(#mfg-navy-l2)" />
      <path d="M150 40 L252 210 L150 210 Z" fill="url(#mfg-navy-r2)" />
      <text x="150" y="190" textAnchor="middle" fontFamily="'Cormorant Garamond', Georgia, serif" fontWeight="600" fontSize="86" fill="#ffffff" letterSpacing="-2">MFG</text>
    </>
  );
}

/**
 * MintIQ product wordmark: the MFG triangle mark plus "MintIQ" set in the serif,
 * with "IQ" in the bright brand gold. `tone="light"` for navy backgrounds,
 * `tone="dark"` for the cream memo surface.
 */
export function MintIQLogo({ tone = "light", height = 40, className = "" }: { tone?: "light" | "dark"; height?: number; className?: string }) {
  const mint = tone === "light" ? "#f5f2ea" : "#0b1530";
  const iq = tone === "light" ? "#ebb43b" : "#c9a84c";
  return (
    <span className={`inline-flex items-center gap-2.5 select-none ${className}`} style={{ height }} aria-label="MintIQ">
      <MfgMark size={height * 0.98} />
      <span className="font-serif font-semibold leading-none tracking-tight" style={{ fontSize: height * 0.78, color: mint }}>
        Mint<span style={{ color: iq }}>IQ</span>
      </span>
    </span>
  );
}
