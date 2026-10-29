import SwiftUI

/// MonytixSplashView — SwiftUI splash matching HTML O-mark motion.
///
/// Sequence: contrast ring → amber seed bloom (full O) → seed fade + 4 segment
/// pop-in (scale 0.55→1, 110ms stagger) → divider expand → wordmark slide-up
/// → tagline fade → category footer → dismiss (~3.6s).
struct MonytixSplashView: View {
    let onComplete: (() -> Void)?

    @State private var glowsVisible  = false
    @State private var ringOpacity: Double = 0
    @State private var seedScale: CGFloat = 0.01
    @State private var seedOpacity: Double = 1
    @State private var yel = false; @State private var cyn = false
    @State private var org = false; @State private var nav = false
    @State private var showDivider  = false
    @State private var showWordmark = false
    @State private var showTagline  = false
    @State private var showCategory = false

    private let bkg  = Color(hex: 0x0D1218)
    private let sage = Color(hex: 0x8ABC9E)
    private let amber = Color(hex: 0xC4956A)
    private let omarkSize: CGFloat = 140

    init(onComplete: (() -> Void)? = nil) { self.onComplete = onComplete }

    var body: some View {
        ZStack {
            bkg.ignoresSafeArea()

            RadialGradient(colors: [sage.opacity(0.15), .clear],
                           center: .topTrailing, startRadius: 0, endRadius: 400)
                .ignoresSafeArea().opacity(glowsVisible ? 1 : 0)
                .animation(.easeIn(duration: 1.4).delay(0.2), value: glowsVisible)

            RadialGradient(colors: [amber.opacity(0.09), .clear],
                           center: .bottomLeading, startRadius: 0, endRadius: 340)
                .ignoresSafeArea().opacity(glowsVisible ? 1 : 0)
                .animation(.easeIn(duration: 1.4).delay(0.4), value: glowsVisible)

            VStack(spacing: 0) {
                Spacer()
                ZStack {
                    // Contrast ring (HTML: #111D2B @ 0.7)
                    Circle()
                        .fill(Color(hex: 0x111D2B))
                        .frame(width: omarkSize + 20, height: omarkSize + 20)
                        .opacity(ringOpacity)

                    // Amber seed — blooms to full O size, then fades
                    Circle()
                        .fill(amber)
                        .frame(width: omarkSize * seedScale, height: omarkSize * seedScale)
                        .opacity(seedOpacity)

                    // O-mark segments
                    OmarkShape4(yel: yel, cyn: cyn, org: org, nav: nav)
                        .frame(width: omarkSize, height: omarkSize)
                }
                .frame(width: omarkSize + 20, height: omarkSize + 20)

                RoundedRectangle(cornerRadius: 0.5)
                    .fill(LinearGradient(colors: [.clear, amber.opacity(0.65), .clear],
                                         startPoint: .leading, endPoint: .trailing))
                    .frame(width: showDivider ? 180 : 0, height: 1).padding(.top, 28)
                    .animation(.easeInOut(duration: 0.55), value: showDivider)

                ZStack(alignment: .topLeading) {
                    WordmarkCanvas()
                    MiniOMark()
                        .frame(width: 50, height: 48)
                        .offset(x: 51)
                }
                .frame(width: 260, height: 48)
                .padding(.top, 18)
                .opacity(showWordmark ? 1 : 0).offset(y: showWordmark ? 0 : 40)
                .animation(.spring(dampingFraction: 0.7), value: showWordmark)

                Text("ADAPTIVE FINANCIAL INTELLIGENCE")
                    .font(.custom("Inter", size: 11).weight(.medium)).tracking(2.5)
                    .foregroundColor(sage.opacity(0.85)).padding(.top, 14)
                    .opacity(showTagline ? 1 : 0)
                    .animation(.easeIn(duration: 0.6), value: showTagline)

                Spacer()
            }

            VStack {
                Spacer()
                HStack(spacing: 8) {
                    Circle().fill(amber.opacity(0.5)).frame(width: 4, height: 4)
                    Text("INDIA'S DECISION LAYER FOR MONEY")
                        .font(.custom("Inter", size: 9).weight(.semibold)).tracking(2.8)
                        .foregroundColor(amber.opacity(0.55))
                    Circle().fill(amber.opacity(0.5)).frame(width: 4, height: 4)
                }.padding(.bottom, 48)
                    .opacity(showCategory ? 1 : 0)
                    .animation(.easeIn(duration: 0.5), value: showCategory)
            }
        }
        .ignoresSafeArea()
        .task { await runSequence() }
    }

    /// Timeline (HTML O-mark + retained brand chrome):
    /// ring 0.00 → seed 0.20–0.85 → segments 0.85–1.58 → divider 1.76
    /// → wordmark 2.01 → tagline 2.71 → footer 2.91 → dismiss ~3.6s
    private func runSequence() async {
        glowsVisible = true

        // Contrast ring fade-in (~0.45s ease)
        withAnimation(.easeInOut(duration: 0.45)) { ringOpacity = 0.7 }
        try? await Task.sleep(nanoseconds: 200_000_000)

        // Seed blooms to full O (ease-in-out, 650ms)
        withAnimation(.easeInOut(duration: 0.65)) { seedScale = 1 }
        try? await Task.sleep(nanoseconds: 650_000_000)
        try? await Task.sleep(nanoseconds: 60_000_000)

        // Seed fades while segments pop (HTML: 250ms fade, 400ms / 110ms stagger)
        withAnimation(.easeOut(duration: 0.25)) { seedOpacity = 0 }

        let segAnim = Animation.spring(response: 0.4, dampingFraction: 0.55)
        withAnimation(segAnim) { yel = true }
        try? await Task.sleep(nanoseconds: 110_000_000)
        withAnimation(segAnim) { cyn = true }
        try? await Task.sleep(nanoseconds: 110_000_000)
        withAnimation(segAnim) { org = true }
        try? await Task.sleep(nanoseconds: 110_000_000)
        withAnimation(segAnim) { nav = true }

        // ~580ms after last segment start → divider
        try? await Task.sleep(nanoseconds: 580_000_000)
        showDivider = true
        try? await Task.sleep(nanoseconds: 250_000_000)
        showWordmark = true
        try? await Task.sleep(nanoseconds: 700_000_000)
        showTagline = true
        try? await Task.sleep(nanoseconds: 200_000_000)
        showCategory = true
        try? await Task.sleep(nanoseconds: 700_000_000)
        onComplete?()
    }
}

// MARK: — O-mark 4-segment shape rendered via Canvas
private struct OmarkShape4: View {
    let yel, cyn, org, nav: Bool

    var body: some View {
        ZStack {
            SegCanvas(path: yellowP, color: Color(hex: 0xF9C515))
                .opacity(yel ? 1 : 0)
                .scaleEffect(yel ? 1 : 0.55)
            SegCanvas(path: cyanP, color: Color(hex: 0x55C2EF))
                .opacity(cyn ? 1 : 0)
                .scaleEffect(cyn ? 1 : 0.55)
            SegCanvas(path: orangeP, color: Color(hex: 0xF47521))
                .opacity(org ? 1 : 0)
                .scaleEffect(org ? 1 : 0.55)
            SegCanvas(path: navyP, color: Color(hex: 0x313A96))
                .opacity(nav ? 1 : 0)
                .scaleEffect(nav ? 1 : 0.55)
        }
    }
}

private struct SegCanvas: View {
    let path: () -> Path
    let color: Color

    var body: some View {
        Canvas { ctx, size in
            let sx = size.width / 134, sy = size.height / 148
            var p = path()
            p = p.applying(CGAffineTransform(translationX: -308, y: -278)
                .concatenating(CGAffineTransform(scaleX: sx, y: sy)))
            ctx.fill(p, with: .color(color))
        }
    }
}

// MARK: — Mini O-mark embedded in wordmark (between M and N)
private struct MiniOMark: View {
    var body: some View {
        GeometryReader { geo in
            Canvas { ctx, size in
                let sx = size.width / 134, sy = size.height / 148
                func map(_ path: inout Path) {
                    path = path.applying(CGAffineTransform(translationX: -308, y: -278)
                        .concatenating(CGAffineTransform(scaleX: sx, y: sy)))
                }
                var py = yellowP(); map(&py); ctx.fill(py, with: .color(Color(hex: 0xF9C515)))
                var pc = cyanP();   map(&pc); ctx.fill(pc, with: .color(Color(hex: 0x55C2EF)))
                var po = orangeP(); map(&po); ctx.fill(po, with: .color(Color(hex: 0xF47521)))
                var pn = navyP();   map(&pn); ctx.fill(pn, with: .color(Color(hex: 0x313A96)))
            }
        }
    }
}

// MARK: — Bezier paths (viewBox 308 278 134 148)
private func yellowP() -> Path {
    var p = Path(); p.move(to: CGPoint(x: 383.54, y: 287.38))
    p.addLine(to: CGPoint(x: 378.64, y: 310.29))
    p.addCurve(to: CGPoint(x: 331.49, y: 348.03), control1: CGPoint(x: 374.21, y: 309.52), control2: CGPoint(x: 354.60, y: 326.84))
    p.addLine(to: CGPoint(x: 308.10, y: 348.03))
    p.addCurve(to: CGPoint(x: 373.15, y: 285.54), control1: CGPoint(x: 309.43, y: 313.29), control2: CGPoint(x: 338.09, y: 285.54))
    p.addCurve(to: CGPoint(x: 383.54, y: 287.38), control1: CGPoint(x: 376.72, y: 285.54), control2: CGPoint(x: 380.18, y: 285.86))
    p.closeSubpath(); return p
}
private func cyanP() -> Path {
    var p = Path(); p.move(to: CGPoint(x: 435.86, y: 334.15))
    p.addLine(to: CGPoint(x: 412.79, y: 338.79))
    p.addCurve(to: CGPoint(x: 383.91, y: 311.35), control1: CGPoint(x: 400.33, y: 329.34), control2: CGPoint(x: 390.55, y: 320.93))
    p.addLine(to: CGPoint(x: 388.76, y: 288.49))
    p.addCurve(to: CGPoint(x: 435.86, y: 334.15), control1: CGPoint(x: 411.56, y: 294.03), control2: CGPoint(x: 429.62, y: 311.67))
    p.closeSubpath(); return p
}
private func orangeP() -> Path {
    var p = Path(); p.move(to: CGPoint(x: 437.21, y: 339.86))
    p.addLine(to: CGPoint(x: 414.25, y: 344.44)); p.addLine(to: CGPoint(x: 410.81, y: 345.12))
    p.addCurve(to: CGPoint(x: 381.67, y: 388.78), control1: CGPoint(x: 411.56, y: 356.25), control2: CGPoint(x: 399.61, y: 375.11))
    p.addLine(to: CGPoint(x: 382.49, y: 392.20)); p.addLine(to: CGPoint(x: 388.00, y: 414.95))
    p.addLine(to: CGPoint(x: 388.83, y: 418.35))
    p.addCurve(to: CGPoint(x: 442.04, y: 351.45), control1: CGPoint(x: 419.28, y: 411.32), control2: CGPoint(x: 442.04, y: 383.80))
    p.addCurve(to: CGPoint(x: 440.89, y: 338.95), control1: CGPoint(x: 442.04, y: 347.18), control2: CGPoint(x: 441.65, y: 343.00))
    p.addLine(to: CGPoint(x: 437.21, y: 339.86)); p.closeSubpath(); return p
}
private func navyP() -> Path {
    var p = Path(); p.move(to: CGPoint(x: 382.05, y: 416.20))
    p.addCurve(to: CGPoint(x: 373.10, y: 416.84), control1: CGPoint(x: 379.07, y: 416.63), control2: CGPoint(x: 376.08, y: 416.84))
    p.addCurve(to: CGPoint(x: 308.10, y: 354.35), control1: CGPoint(x: 338.04, y: 416.84), control2: CGPoint(x: 309.43, y: 389.08))
    p.addLine(to: CGPoint(x: 331.54, y: 354.35))
    p.addCurve(to: CGPoint(x: 373.10, y: 393.46), control1: CGPoint(x: 332.93, y: 376.14), control2: CGPoint(x: 351.04, y: 393.46))
    p.addCurve(to: CGPoint(x: 376.51, y: 393.25), control1: CGPoint(x: 374.27, y: 393.46), control2: CGPoint(x: 375.39, y: 393.41))
    p.addLine(to: CGPoint(x: 382.05, y: 416.20)); p.closeSubpath(); return p
}

// MARK: — Gold-gradient wordmark (original logo SVG paths)
private struct WordmarkCanvas: View {
    var body: some View {
        GeometryReader { geo in
            Canvas { ctx, size in
                let sx = size.width / 720, sy = size.height / 130
                let grad: Gradient = .init(colors: [
                    Color(hex: 0xA2692A), Color(hex: 0xBE8C3B), Color(hex: 0xD4B260),
                    Color(hex: 0xF9F0A0), Color(hex: 0xFCF8C5), Color(hex: 0xF9F0A0),
                    Color(hex: 0xD4B260), Color(hex: 0xBE8C3B), Color(hex: 0xB27C31),
                    Color(hex: 0xBB8331), Color(hex: 0xD5A346), Color(hex: 0xE1B454),
                    Color(hex: 0xA46A2A)
                ])
                func map(_ p: inout Path) {
                    p = p.applying(CGAffineTransform(translationX: -168, y: -278)
                        .concatenating(CGAffineTransform(scaleX: sx, y: sy)))
                }
                for path in [wmM, wmN, wmY, wmT, wmI, wmX] {
                    var p = path(); map(&p); ctx.fill(p, with: .linearGradient(grad, startPoint: .zero, endPoint: CGPoint(x: 0, y: size.height)))
                }
            }
        }
    }
}
private func wmM() -> Path { var p=Path()
    p.addLines([CGPoint(x:180.5,y:400.78),CGPoint(x:178.34,y:399.48),CGPoint(x:178.34,y:395.34),CGPoint(x:178.34,y:335.97),CGPoint(x:181.34,y:317.25),CGPoint(x:187.33,y:311.30),CGPoint(x:193.32,y:305.35),CGPoint(x:201.52,y:302.38),CGPoint(x:211.93,y:302.38),CGPoint(x:222.22,y:303.73),CGPoint(x:226.91,y:306.42),CGPoint(x:231.60,y:309.12),CGPoint(x:235.43,y:312.83),CGPoint(x:238.41,y:317.57),CGPoint(x:241.38,y:312.74),CGPoint(x:245.19,y:309.00),CGPoint(x:249.84,y:306.35),CGPoint(x:254.48,y:303.70),CGPoint(x:259.60,y:302.38),CGPoint(x:265.17,y:302.38),CGPoint(x:275.67,y:302.38),CGPoint(x:283.86,y:305.35),CGPoint(x:289.77,y:311.30),CGPoint(x:295.67,y:317.24),CGPoint(x:298.62,y:325.47),CGPoint(x:298.62,y:335.97),CGPoint(x:298.62,y:395.34),CGPoint(x:297.90,y:397.36),CGPoint(x:296.46,y:398.71),CGPoint(x:295.02,y:400.05),CGPoint(x:293.09,y:400.73),CGPoint(x:290.68,y:400.73),CGPoint(x:288.33,y:400.08),CGPoint(x:286.89,y:398.78),CGPoint(x:285.45,y:397.48),CGPoint(x:284.73,y:395.67),CGPoint(x:284.73,y:391.34),CGPoint(x:284.73,y:331.97),CGPoint(x:283.31,y:324.81),CGPoint(x:280.48,y:321.47),CGPoint(x:277.64,y:318.13),CGPoint(x:273.02,y:316.45),CGPoint(x:266.61,y:316.45),CGPoint(x:260.76,y:316.45),CGPoint(x:256.25,y:318.26),CGPoint(x:253.09,y:321.89),CGPoint(x:249.93,y:325.51),CGPoint(x:248.35,y:330.62),CGPoint(x:248.35,y:337.22),CGPoint(x:248.35,y:396.59),CGPoint(x:247.63,y:398.73),CGPoint(x:246.19,y:400.03),CGPoint(x:244.75,y:401.33),CGPoint(x:242.82,y:401.98),CGPoint(x:240.41,y:401.98),CGPoint(x:238.11,y:401.33),CGPoint(x:236.76,y:400.03),CGPoint(x:235.42,y:398.73),CGPoint(x:234.74,y:396.59),CGPoint(x:234.74,y:391.22),CGPoint(x:234.74,y:331.85),CGPoint(x:233.11,y:320.26),CGPoint(x:230.27,y:316.59),CGPoint(x:227.02,y:312.92),CGPoint(x:222.56,y:311.08),CGPoint(x:216.89,y:311.08),CGPoint(x:210.38,y:311.08),CGPoint(x:206.54,y:312.75),CGPoint(x:203.70,y:316.10),CGPoint(x:200.86,y:319.44),CGPoint(x:199.45,y:325.85),CGPoint(x:199.45,y:335.97),CGPoint(x:199.45,y:395.34),CGPoint(x:198.73,y:397.57),CGPoint(x:197.29,y:398.91),CGPoint(x:195.85,y:400.25),CGPoint(x:193.92,y:400.93),CGPoint(x:191.51,y:400.93),CGPoint(x:189.17,y:400.28),CGPoint(x:187.73,y:398.98),CGPoint(x:186.29,y:397.68),CGPoint(x:185.55,y:395.65),CGPoint(x:185.55,y:395.34)]);return p }
private func wmN() -> Path { var p=Path()
    p.addLines([CGPoint(x:452.51,y:400.78),CGPoint(x:451.12,y:399.48),CGPoint(x:450.42,y:397.67),CGPoint(x:450.42,y:395.34),CGPoint(x:450.42,y:341.26),CGPoint(x:454.21,y:319.57),CGPoint(x:461.78,y:312.69),CGPoint(x:469.35,y:305.81),CGPoint(x:479.78,y:302.38),CGPoint(x:493.07,y:302.38),CGPoint(x:509.38,y:303.94),CGPoint(x:515.79,y:307.05),CGPoint(x:522.20,y:310.17),CGPoint(x:527.10,y:314.65),CGPoint(x:530.49,y:320.50),CGPoint(x:533.88,y:326.36),CGPoint(x:535.58,y:333.28),CGPoint(x:535.58,y:341.27),CGPoint(x:535.58,y:395.34),CGPoint(x:534.88,y:397.66),CGPoint(x:533.48,y:398.98),CGPoint(x:532.09,y:400.30),CGPoint(x:530.19,y:400.93),CGPoint(x:527.77,y:400.93),CGPoint(x:525.43,y:400.25),CGPoint(x:523.98,y:398.91),CGPoint(x:522.54,y:397.56),CGPoint(x:521.81,y:395.77),CGPoint(x:521.81,y:391.34),CGPoint(x:521.81,y:336.85),CGPoint(x:519.49,y:322.21),CGPoint(x:514.84,y:317.75),CGPoint(x:510.20,y:313.29),CGPoint(x:503.60,y:311.06),CGPoint(x:495.05,y:311.06),CGPoint(x:486.50,y:311.06),CGPoint(x:479.88,y:313.31),CGPoint(x:475.19,y:317.82),CGPoint(x:470.50,y:322.33),CGPoint(x:468.15,y:328.67),CGPoint(x:468.15,y:336.85),CGPoint(x:468.15,y:391.34),CGPoint(x:467.43,y:393.57),CGPoint(x:465.99,y:394.91),CGPoint(x:464.55,y:396.25),CGPoint(x:462.62,y:396.93),CGPoint(x:460.21,y:396.93),CGPoint(x:457.89,y:396.28),CGPoint(x:456.50,y:394.98),CGPoint(x:455.12,y:393.68),CGPoint(x:454.41,y:391.12),CGPoint(x:454.41,y:391.34)]);return p }
private func wmY() -> Path { var p=Path()
    p.addLines([CGPoint(x:629.79,y:304.34),CGPoint(x:631.19,y:305.64),CGPoint(x:631.88,y:307.45),CGPoint(x:631.88,y:309.78),CGPoint(x:631.88,y:325.39),CGPoint(x:628.74,y:337.69),CGPoint(x:622.47,y:345.49),CGPoint(x:616.20,y:353.29),CGPoint(x:607.54,y:357.99),CGPoint(x:596.48,y:359.57),CGPoint(x:596.48,y:385.35),CGPoint(x:596.48,y:387.58),CGPoint(x:594.79,y:389.50),CGPoint(x:593.10,y:391.42),CGPoint(x:590.95,y:390.94),CGPoint(x:588.53,y:390.94),CGPoint(x:586.19,y:390.29),CGPoint(x:584.74,y:388.99),CGPoint(x:583.30,y:387.69),CGPoint(x:582.58,y:385.88),CGPoint(x:582.58,y:383.55),CGPoint(x:582.58,y:357.77),CGPoint(x:571.43,y:356.19),CGPoint(x:562.72,y:351.54),CGPoint(x:554.01,y:346.89),CGPoint(x:547.74,y:339.18),CGPoint(x:541.47,y:331.47),CGPoint(x:538.33,y:321.39),CGPoint(x:538.33,y:308.94),CGPoint(x:538.33,y:293.33),CGPoint(x:539.05,y:291.00),CGPoint(x:540.49,y:289.70),CGPoint(x:541.93,y:288.40),CGPoint(x:543.86,y:287.75),CGPoint(x:546.27,y:287.75),CGPoint(x:548.61,y:288.42),CGPoint(x:550.05,y:289.77),CGPoint(x:551.49,y:291.12),CGPoint(x:552.21,y:292.93),CGPoint(x:552.21,y:294.29),CGPoint(x:552.21,y:310.32),CGPoint(x:554.60,y:322.45),CGPoint(x:559.39,y:328.56),CGPoint(x:564.18,y:334.67),CGPoint(x:570.99,y:337.78),CGPoint(x:579.82,y:337.78),CGPoint(x:588.65,y:337.78),CGPoint(x:594.44,y:335.02),CGPoint(x:599.23,y:329.49),CGPoint(x:604.02,y:323.96),CGPoint(x:606.41,y:316.18),CGPoint(x:606.41,y:306.15),CGPoint(x:606.41,y:290.12),CGPoint(x:606.41,y:287.76),CGPoint(x:607.87,y:286.12),CGPoint(x:609.33,y:284.48),CGPoint(x:612.07,y:284.38),CGPoint(x:614.49,y:284.38),CGPoint(x:616.81,y:285.03),CGPoint(x:618.25,y:286.33),CGPoint(x:619.69,y:287.63),CGPoint(x:620.44,y:289.60),CGPoint(x:620.44,y:289.79)]);return p }
private func wmT() -> Path { var p=Path()
    p.addLines([CGPoint(x:683.03,y:397.72),CGPoint(x:683.03,y:311.31),CGPoint(x:650.14,y:311.31),CGPoint(x:646.98,y:311.31),CGPoint(x:645.40,y:310.10),CGPoint(x:645.40,y:307.69),CGPoint(x:645.40,y:306.30),CGPoint(x:645.79,y:305.30),CGPoint(x:646.58,y:304.70),CGPoint(x:647.37,y:304.10),CGPoint(x:648.55,y:303.79),CGPoint(x:650.13,y:303.79),CGPoint(x:724.97,y:303.79),CGPoint(x:728.13,y:303.79),CGPoint(x:729.71,y:305.09),CGPoint(x:729.71,y:307.69),CGPoint(x:729.71,y:310.11),CGPoint(x:728.13,y:311.31),CGPoint(x:726.55,y:312.51),CGPoint(x:723.39,y:311.31),CGPoint(x:690.50,y:311.31),CGPoint(x:690.50,y:397.72),CGPoint(x:690.50,y:399.30),CGPoint(x:690.08,y:400.53),CGPoint(x:689.25,y:401.41),CGPoint(x:688.42,y:402.29),CGPoint(x:687.30,y:402.74),CGPoint(x:685.90,y:402.74),CGPoint(x:682.92,y:402.74),CGPoint(x:681.44,y:401.06),CGPoint(x:680.68,y:399.00),CGPoint(x:680.68,y:397.72)]);return p }
private func wmI() -> Path { var p=Path()
    p.addLines([CGPoint(x:750.83,y:401.41),CGPoint(x:750.04,y:400.53),CGPoint(x:749.65,y:399.30),CGPoint(x:749.65,y:397.72),CGPoint(x:749.65,y:307.41),CGPoint(x:749.65,y:305.59),CGPoint(x:751.14,y:304.39),CGPoint(x:753.11,y:303.36),CGPoint(x:755.08,y:302.38),CGPoint(x:757.57,y:302.38),CGPoint(x:761.94,y:302.38),CGPoint(x:763.03,y:302.82),CGPoint(x:763.82,y:303.70),CGPoint(x:764.61,y:304.58),CGPoint(x:765.01,y:305.82),CGPoint(x:765.01,y:307.41),CGPoint(x:765.01,y:397.72),CGPoint(x:764.61,y:399.30),CGPoint(x:763.82,y:400.41),CGPoint(x:763.03,y:401.52),CGPoint(x:761.94,y:402.08),CGPoint(x:760.54,y:402.41),CGPoint(x:757.26,y:402.41),CGPoint(x:754.78,y:401.52),CGPoint(x:752.82,y:400.61),CGPoint(x:753.11,y:402.08)]);return p }
private func wmX() -> Path { var p=Path()
    p.addLines([CGPoint(x:857.66,y:398.83),CGPoint(x:857.66,y:400.13),CGPoint(x:857.10,y:401.16),CGPoint(x:855.99,y:401.90),CGPoint(x:855.16,y:402.46),CGPoint(x:854.36,y:402.74),CGPoint(x:853.62,y:402.74),CGPoint(x:852.32,y:402.74),CGPoint(x:850.72,y:401.90),CGPoint(x:848.42,y:400.23),CGPoint(x:814.69,y:357.86),CGPoint(x:780.96,y:400.23),CGPoint(x:779.75,y:401.90),CGPoint(x:778.45,y:402.74),CGPoint(x:777.15,y:402.74),CGPoint(x:776.40,y:402.74),CGPoint(x:775.61,y:402.46),CGPoint(x:774.78,y:401.90),CGPoint(x:773.76,y:401.16),CGPoint(x:773.24,y:400.14),CGPoint(x:773.24,y:398.83),CGPoint(x:773.24,y:397.90),CGPoint(x:773.61,y:396.93),CGPoint(x:774.36,y:395.90),CGPoint(x:809.76,y:351.44),CGPoint(x:776.03,y:309.21),CGPoint(x:775.38,y:308.47),CGPoint(x:775.06,y:307.49),CGPoint(x:775.06,y:306.28),CGPoint(x:775.06,y:304.89),CGPoint(x:775.57,y:303.86),CGPoint(x:776.59,y:303.22),CGPoint(x:777.43,y:302.67),CGPoint(x:778.17,y:302.39),CGPoint(x:778.82,y:302.39),CGPoint(x:780.03,y:302.39),CGPoint(x:781.33,y:303.22),CGPoint(x:783.23,y:305.73),CGPoint(x:815.29,y:346.01),CGPoint(x:847.35,y:305.73),CGPoint(x:848.65,y:304.06),CGPoint(x:849.95,y:303.22),CGPoint(x:851.25,y:303.22),CGPoint(x:852.09,y:303.22),CGPoint(x:852.83,y:303.50),CGPoint(x:853.48,y:304.05),CGPoint(x:854.60,y:304.72),CGPoint(x:855.15,y:305.78),CGPoint(x:855.15,y:307.41),CGPoint(x:855.15,y:308.34),CGPoint(x:854.78,y:309.32),CGPoint(x:854.04,y:310.34),CGPoint(x:820.45,y:352.57),CGPoint(x:855.85,y:397.03),CGPoint(x:856.59,y:398.05),CGPoint(x:856.96,y:399.02),CGPoint(x:856.96,y:398.83)]);return p }

// MARK: — Color hex
extension Color { init(hex: UInt) { self.init(.sRGB, red: Double((hex>>16)&0xFF)/255, green: Double((hex>>8)&0xFF)/255, blue: Double(hex&0xFF)/255) } }

#Preview { MonytixSplashView().preferredColorScheme(.dark) }
