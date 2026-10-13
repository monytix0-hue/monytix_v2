import SwiftUI

struct MonytixSplashView: View {
    let onComplete: (() -> Void)?

    @State private var glowsVisible = false
    @State private var ringOpacity: Double = 0
    @State private var seedScale: CGFloat = 0.01
    @State private var seedOpacity: Double = 1
    @State private var yel = false
    @State private var cyn = false
    @State private var org = false
    @State private var nav = false
    @State private var showDivider = false
    @State private var showWordmark = false
    @State private var showTagline = false
    @State private var showCategory = false

    private let nightSky = Color(red: 13.0 / 255, green: 18.0 / 255, blue: 24.0 / 255)
    private let sage = Color(red: 138.0 / 255, green: 188.0 / 255, blue: 158.0 / 255)
    private let amber = Color(red: 196.0 / 255, green: 149.0 / 255, blue: 106.0 / 255)
    private let contrast = Color(red: 17.0 / 255, green: 29.0 / 255, blue: 43.0 / 255)
    private let omarkSize: CGFloat = 140

    init(onComplete: (() -> Void)? = nil) {
        self.onComplete = onComplete
    }

    var body: some View {
        ZStack {
            nightSky.ignoresSafeArea()
            RadialGradient(colors: [sage.opacity(0.15), .clear], center: .topTrailing, startRadius: 0, endRadius: 400)
                .ignoresSafeArea()
                .opacity(glowsVisible ? 1 : 0)
            RadialGradient(colors: [amber.opacity(0.09), .clear], center: .bottomLeading, startRadius: 0, endRadius: 340)
                .ignoresSafeArea()
                .opacity(glowsVisible ? 1 : 0)

            VStack(spacing: 0) {
                Spacer()
                ZStack {
                    Circle()
                        .fill(contrast)
                        .frame(width: omarkSize + 20, height: omarkSize + 20)
                        .opacity(ringOpacity)
                    Circle()
                        .fill(amber)
                        .frame(width: omarkSize * seedScale, height: omarkSize * seedScale)
                        .opacity(seedOpacity)
                    OmarkShape(yel: yel, cyn: cyn, org: org, nav: nav)
                        .frame(width: omarkSize, height: omarkSize)
                }
                .frame(width: omarkSize + 20, height: omarkSize + 20)

                RoundedRectangle(cornerRadius: 0.5)
                    .fill(LinearGradient(colors: [.clear, amber.opacity(0.65), .clear], startPoint: .leading, endPoint: .trailing))
                    .frame(width: showDivider ? 180 : 0, height: 1)
                    .padding(.top, 28)
                    .animation(.easeInOut(duration: 0.55), value: showDivider)

                Image("MonytixWordmark")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 260, height: 48)
                    .padding(.top, 18)
                    .opacity(showWordmark ? 1 : 0)
                    .offset(y: showWordmark ? 0 : 40)
                    .animation(.spring(dampingFraction: 0.7), value: showWordmark)

                Text("ADAPTIVE FINANCIAL INTELLIGENCE")
                    .font(.custom("Inter-SemiBold", size: 11))
                    .tracking(2.5)
                    .foregroundStyle(sage.opacity(0.85))
                    .padding(.top, 14)
                    .opacity(showTagline ? 1 : 0)
                    .animation(.easeIn(duration: 0.6), value: showTagline)
                Spacer()
            }

            VStack {
                Spacer()
                Text("INDIA'S DECISION LAYER FOR MONEY")
                    .font(.custom("Inter-SemiBold", size: 9))
                    .tracking(2.8)
                    .foregroundStyle(amber.opacity(0.55))
                    .padding(.bottom, 48)
                    .opacity(showCategory ? 1 : 0)
                    .animation(.easeIn(duration: 0.5), value: showCategory)
            }
        }
        .ignoresSafeArea()
        .task { await runSequence() }
    }

    private func runSequence() async {
        glowsVisible = true
        withAnimation(.easeInOut(duration: 0.45)) { ringOpacity = 0.7 }
        try? await Task.sleep(nanoseconds: 200_000_000)
        withAnimation(.easeInOut(duration: 0.65)) { seedScale = 1 }
        try? await Task.sleep(nanoseconds: 710_000_000)
        withAnimation(.easeOut(duration: 0.25)) { seedOpacity = 0 }
        let segAnim = Animation.spring(response: 0.4, dampingFraction: 0.55)
        withAnimation(segAnim) { yel = true }
        try? await Task.sleep(nanoseconds: 110_000_000)
        withAnimation(segAnim) { cyn = true }
        try? await Task.sleep(nanoseconds: 110_000_000)
        withAnimation(segAnim) { org = true }
        try? await Task.sleep(nanoseconds: 110_000_000)
        withAnimation(segAnim) { nav = true }
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

private struct OmarkShape: View {
    let yel: Bool
    let cyn: Bool
    let org: Bool
    let nav: Bool

    var body: some View {
        ZStack {
            segment(yellowPath, Color(red: 249.0 / 255, green: 197.0 / 255, blue: 21.0 / 255), yel)
            segment(cyanPath, Color(red: 85.0 / 255, green: 194.0 / 255, blue: 239.0 / 255), cyn)
            segment(orangePath, Color(red: 244.0 / 255, green: 117.0 / 255, blue: 33.0 / 255), org)
            segment(navyPath, Color(red: 49.0 / 255, green: 58.0 / 255, blue: 150.0 / 255), nav)
        }
    }

    private func segment(_ path: () -> Path, _ color: Color, _ visible: Bool) -> some View {
        Canvas { context, size in
            let transform = CGAffineTransform(translationX: -308, y: -278)
                .concatenating(CGAffineTransform(scaleX: size.width / 134, y: size.height / 148))
            context.fill(path().applying(transform), with: .color(color))
        }
        .opacity(visible ? 1 : 0)
        .scaleEffect(visible ? 1 : 0.55)
    }
}

private func yellowPath() -> Path {
    var path = Path()
    path.move(to: CGPoint(x: 383.54, y: 287.38))
    path.addLine(to: CGPoint(x: 378.64, y: 310.29))
    path.addCurve(to: CGPoint(x: 331.49, y: 348.03), control1: CGPoint(x: 374.21, y: 309.52), control2: CGPoint(x: 354.60, y: 326.84))
    path.addLine(to: CGPoint(x: 308.10, y: 348.03))
    path.addCurve(to: CGPoint(x: 373.15, y: 285.54), control1: CGPoint(x: 309.43, y: 313.29), control2: CGPoint(x: 338.09, y: 285.54))
    path.addCurve(to: CGPoint(x: 383.54, y: 287.38), control1: CGPoint(x: 376.72, y: 285.54), control2: CGPoint(x: 380.18, y: 285.86))
    path.closeSubpath()
    return path
}

private func cyanPath() -> Path {
    var path = Path()
    path.move(to: CGPoint(x: 435.86, y: 334.15))
    path.addLine(to: CGPoint(x: 412.79, y: 338.79))
    path.addCurve(to: CGPoint(x: 383.91, y: 311.35), control1: CGPoint(x: 400.33, y: 329.34), control2: CGPoint(x: 390.55, y: 320.93))
    path.addLine(to: CGPoint(x: 388.76, y: 288.49))
    path.addCurve(to: CGPoint(x: 435.86, y: 334.15), control1: CGPoint(x: 411.56, y: 294.03), control2: CGPoint(x: 429.62, y: 311.67))
    path.closeSubpath()
    return path
}

private func orangePath() -> Path {
    var path = Path()
    path.move(to: CGPoint(x: 437.21, y: 339.86))
    path.addLine(to: CGPoint(x: 414.25, y: 344.44))
    path.addLine(to: CGPoint(x: 410.81, y: 345.12))
    path.addCurve(to: CGPoint(x: 381.67, y: 388.78), control1: CGPoint(x: 411.56, y: 356.25), control2: CGPoint(x: 399.61, y: 375.11))
    path.addLine(to: CGPoint(x: 382.49, y: 392.20))
    path.addLine(to: CGPoint(x: 388.00, y: 414.95))
    path.addLine(to: CGPoint(x: 388.83, y: 418.35))
    path.addCurve(to: CGPoint(x: 442.04, y: 351.45), control1: CGPoint(x: 419.28, y: 411.32), control2: CGPoint(x: 442.04, y: 383.80))
    path.addCurve(to: CGPoint(x: 440.89, y: 338.95), control1: CGPoint(x: 442.04, y: 347.18), control2: CGPoint(x: 441.65, y: 343.00))
    path.addLine(to: CGPoint(x: 437.21, y: 339.86))
    path.closeSubpath()
    return path
}

private func navyPath() -> Path {
    var path = Path()
    path.move(to: CGPoint(x: 382.05, y: 416.20))
    path.addCurve(to: CGPoint(x: 373.10, y: 416.84), control1: CGPoint(x: 379.07, y: 416.63), control2: CGPoint(x: 376.08, y: 416.84))
    path.addCurve(to: CGPoint(x: 308.10, y: 354.35), control1: CGPoint(x: 338.04, y: 416.84), control2: CGPoint(x: 309.43, y: 389.08))
    path.addLine(to: CGPoint(x: 331.54, y: 354.35))
    path.addCurve(to: CGPoint(x: 373.10, y: 393.46), control1: CGPoint(x: 332.93, y: 376.14), control2: CGPoint(x: 351.04, y: 393.46))
    path.addCurve(to: CGPoint(x: 376.51, y: 393.25), control1: CGPoint(x: 374.27, y: 393.46), control2: CGPoint(x: 375.39, y: 393.41))
    path.addLine(to: CGPoint(x: 382.05, y: 416.20))
    path.closeSubpath()
    return path
}
