import { ImageResponse } from "next/og";

export const alt = "OUTBOX — the Automate305 outbound command center";
export const contentType = "image/png";
export const size = { height: 630, width: 1200 };

export default function OpenGraphImage() {
  return new ImageResponse(
    <div style={{ background: "radial-gradient(circle at 80% 18%, #3d176a 0%, transparent 32%), linear-gradient(135deg, #09070d 0%, #130d1d 54%, #08070c 100%)", color: "#f7f2fb", display: "flex", height: "100%", padding: "68px 76px", position: "relative", width: "100%" }}>
      <div style={{ border: "1px solid rgba(214, 165, 255, .18)", borderRadius: 38, display: "flex", flexDirection: "column", height: "100%", justifyContent: "space-between", padding: "48px 54px", width: "100%" }}>
        <div style={{ alignItems: "center", color: "#c084fc", display: "flex", fontFamily: "Arial, sans-serif", fontSize: 24, fontWeight: 800, letterSpacing: 5 }}>
          AUTOMATE305
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontFamily: "Arial, sans-serif", fontSize: 92, fontWeight: 900, letterSpacing: 8, lineHeight: 1 }}>OUTBOX</div>
          <div style={{ color: "#b9afc4", fontFamily: "Arial, sans-serif", fontSize: 31, marginTop: 24 }}>Outbound operations, approvals, and mailbox health.</div>
        </div>
        <div style={{ color: "#a88abf", display: "flex", fontFamily: "Arial, sans-serif", fontSize: 23, letterSpacing: 1 }}>outbox.automate305.com</div>
      </div>
      <div style={{ alignItems: "center", background: "linear-gradient(135deg, #d49cff 0%, #8c3fe1 55%, #54229d 100%)", borderRadius: 999, boxShadow: "0 0 110px rgba(173, 91, 255, .48)", color: "white", display: "flex", fontFamily: "Arial, sans-serif", fontSize: 172, fontWeight: 900, height: 260, justifyContent: "center", position: "absolute", right: 82, top: 74, width: 260 }}>ϟ</div>
    </div>,
    size,
  );
}
