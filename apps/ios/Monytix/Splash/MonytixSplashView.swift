import SwiftUI

struct MonytixSplashView: View {
    let onComplete: (() -> Void)?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var track: Double = 0
    @State private var sweep: Double = 0
    @State private var loader: Double = 1
    @State private var markScale: CGFloat = 0.85
    @State private var markAlpha: Double = 0
    @State private var yellow: Double = 0
    @State private var cyan: Double = 0
    @State private var orange: Double = 0
    @State private var navy: Double = 0
    @State private var wipe: Double = 0
    @State private var shimmer: Double = 0
    @State private var shimmerVisible = false

    private let nightSky = Color(red: 13.0 / 255, green: 27.0 / 255, blue: 42.0 / 255)
    private let sage = Color(red: 138.0 / 255, green: 188.0 / 255, blue: 158.0 / 255)
    private let amber = Color(red: 196.0 / 255, green: 149.0 / 255, blue: 106.0 / 255)

    init(onComplete: (() -> Void)? = nil) {
        self.onComplete = onComplete
    }

    var body: some View {
        GeometryReader { geo in
            let wordWidth = min(300, geo.size.width * 0.64)
            VStack(spacing: 24) {
                ZStack {
                    LoaderRing(track: track, sweep: sweep, loader: loader, sage: sage, amber: amber)
                    OmarkShape(yellow: yellow, cyan: cyan, orange: orange, navy: navy)
                        .frame(width: 96, height: 96)
                        .scaleEffect(markScale)
                        .opacity(markAlpha)
                }
                .frame(width: 96, height: 96)

                GoldWordmark(width: wordWidth, wipe: wipe, shimmer: shimmer, shimmerVisible: shimmerVisible)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(nightSky.ignoresSafeArea())
        .task(id: reduceMotion) { await runSequence() }
    }

    private func runSequence() async {
        if reduceMotion {
            markScale = 1
            markAlpha = 1
            yellow = 1
            cyan = 1
            orange = 1
            navy = 1
            wipe = 1
            onComplete?()
            return
        }
        try? await Task.sleep(nanoseconds: 150_000_000)
        await tween(350, ease: easeOut) { track = $0 * 0.1 }
        await tween(900, ease: easeInOut) { sweep = $0 }
        try? await Task.sleep(nanoseconds: 60_000_000)
        await tween(250, ease: easeOut) { value in
            track = 0.1 * (1 - value)
            loader = 1 - value
        }
        track = 0
        loader = 0
        withAnimation(.timingCurve(0.34, 1.56, 0.64, 1, duration: 0.4)) {
            markScale = 1
        }
        withAnimation(.timingCurve(0.25, 0.1, 0.25, 1, duration: 0.18)) {
            markAlpha = 1
        }
        fadeSegment(delay: 0) { yellow = $0 }
        fadeSegment(delay: 0.06) { cyan = $0 }
        fadeSegment(delay: 0.12) { orange = $0 }
        fadeSegment(delay: 0.18) { navy = $0 }
        try? await Task.sleep(nanoseconds: 420_000_000)
        await tween(700, ease: easeInOut) { wipe = $0 }
        try? await Task.sleep(nanoseconds: 200_000_000)
        shimmerVisible = true
        await tween(700, ease: easeInOut) { shimmer = $0 }
        shimmerVisible = false
        try? await Task.sleep(nanoseconds: 600_000_000)
        onComplete?()
    }

    private func fadeSegment(delay: Double, set: @escaping (Double) -> Void) {
        Task {
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            await tween(220, ease: cssEase, set: set)
        }
    }

    private func tween(_ ms: Double, ease: (Double) -> Double, set: (Double) -> Void) async {
        let frames = max(1, Int(ms / (1000.0 / 60.0)))
        for frame in 0...frames {
            let t = Double(frame) / Double(frames)
            set(ease(t))
            try? await Task.sleep(nanoseconds: 16_666_667)
        }
    }

    private func easeOut(_ t: Double) -> Double {
        1 - pow(1 - t, 3)
    }

    private func easeInOut(_ t: Double) -> Double {
        t < 0.5 ? 4 * t * t * t : 1 - pow(-2 * t + 2, 3) / 2
    }

    private func cssEase(_ t: Double) -> Double {
        let c = UnitCurve.bezier(startControlPoint: .init(x: 0.25, y: 0.1), endControlPoint: .init(x: 0.25, y: 1))
        return c.value(at: t)
    }
}

private struct LoaderRing: View {
    let track: Double
    let sweep: Double
    let loader: Double
    let sage: Color
    let amber: Color

    var body: some View {
        Canvas { context, size in
            let stroke = 8 / 96 * size.width
            let radius = 35 / 96 * size.width
            let center = CGPoint(x: size.width / 2, y: size.height / 2)
            if track > 0 {
                let rect = CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2)
                context.stroke(Path(ellipseIn: rect), with: .color(sage.opacity(track)), style: StrokeStyle(lineWidth: stroke, lineCap: .butt))
            }
            if loader > 0 && sweep > 0 {
                var path = Path()
                path.addArc(
                    center: center,
                    radius: radius,
                    startAngle: .degrees(-90),
                    endAngle: .degrees(-90 + 360 * sweep),
                    clockwise: false
                )
                context.stroke(path, with: .color(amber.opacity(loader)), style: StrokeStyle(lineWidth: stroke, lineCap: .butt))
            }
        }
        .frame(width: 96, height: 96)
    }
}

private struct GoldWordmark: View {
    let width: CGFloat
    let wipe: Double
    let shimmer: Double
    let shimmerVisible: Bool

    var body: some View {
        Image("MonytixWordmarkGold")
            .resizable()
            .scaledToFit()
            .frame(width: width, height: 48)
            .overlay {
                GeometryReader { geo in
                    let start = geo.size.width * ((-80 + shimmer * 260) / 100)
                    LinearGradient(
                        stops: [
                            .init(color: .white.opacity(0), location: 0),
                            .init(color: .white.opacity(0), location: 0.45),
                            .init(color: .white.opacity(0.45), location: 0.5),
                            .init(color: .white.opacity(0), location: 0.55),
                            .init(color: .white.opacity(0), location: 1),
                        ],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                    .frame(width: geo.size.width * 0.6)
                    .offset(x: start)
                }
                .mask(Image("MonytixWordmarkGold").resizable().scaledToFit())
                .blendMode(.screen)
                .opacity(shimmerVisible ? 1 : 0)
                .allowsHitTesting(false)
            }
            .mask(alignment: .leading) {
                Rectangle().frame(width: width * wipe)
            }
            .frame(width: width, height: 48, alignment: .leading)
            .accessibilityLabel("Monytix")
    }
}

private struct OmarkShape: View {
    let yellow: Double
    let cyan: Double
    let orange: Double
    let navy: Double

    var body: some View {
        ZStack {
            segment(yellowPath, Color(red: 249.0 / 255, green: 197.0 / 255, blue: 21.0 / 255), yellow)
            segment(cyanPath, Color(red: 85.0 / 255, green: 194.0 / 255, blue: 239.0 / 255), cyan)
            segment(orangePath, Color(red: 244.0 / 255, green: 117.0 / 255, blue: 33.0 / 255), orange)
            segment(navyPath, Color(red: 49.0 / 255, green: 58.0 / 255, blue: 150.0 / 255), navy)
        }
    }

    private func segment(_ path: @escaping () -> Path, _ color: Color, _ alpha: Double) -> some View {
        Canvas { context, size in
            let transform = CGAffineTransform(translationX: -308, y: -278)
                .concatenating(CGAffineTransform(scaleX: size.width / 134, y: size.height / 148))
            context.fill(path().applying(transform), with: .color(color))
        }
        .opacity(alpha)
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
