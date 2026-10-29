import UIKit

/// MonytixSplashViewController — UIKit splash matching HTML O-mark motion.
///
/// Sequence: contrast ring → amber seed bloom (full O) → seed fade + 4 segment
/// pop-in → divider → wordmark → tagline → dismiss (~3.6s).
public final class MonytixSplashViewController: UIViewController {
    // MARK: — Brand colours
    private enum Brand {
        static let nightSky  = UIColor(hex: "#0D1218")!
        static let yell      = UIColor(hex: "#F9C515")!
        static let cyan      = UIColor(hex: "#55C2EF")!
        static let orng      = UIColor(hex: "#F47521")!
        static let navySeg   = UIColor(hex: "#313A96")!
        static let sage      = UIColor(hex: "#8ABC9E")!
        static let amber     = UIColor(hex: "#C4956A")!
        static let ring      = UIColor(hex: "#111D2B")!
    }

    // MARK: — UI layers
    private let container   = UIView()
    private let ringView    = UIView()
    private let segY = CAShapeLayer(); private let segC = CAShapeLayer()
    private let segO = CAShapeLayer(); private let segN = CAShapeLayer()
    private let seed        = CAShapeLayer()
    private let divider     = UIView()
    private let wordmark    = UIView()
    private let tagline     = UILabel()
    private let category    = UILabel()
    private let glowTR      = CAGradientLayer(); private let glowBL = CAGradientLayer()

    public override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = Brand.nightSky
        setupGlows(); setupRing(); setupSeedDot(); setupOmark(); setupDivider(); setupWordmark(); setupLabels()
    }

    public override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        playReveal()
    }

    public override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }
    public override var prefersHomeIndicatorAutoHidden: Bool { true }

    // MARK: — Layout
    public override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        let w = view.bounds.width, h = view.bounds.height

        glowTR.frame  = CGRect(x: w*0.45, y: -80, width: 340, height: 340)
        glowBL.frame  = CGRect(x: -80, y: h*0.65, width: 280, height: 280)

        let oSize: CGFloat = 140
        let ringPad: CGFloat = 20
        let wrapSize = oSize + ringPad
        let wrapOrigin = CGPoint(x: (w - wrapSize) / 2, y: h * 0.36 - wrapSize / 2)
        ringView.frame = CGRect(origin: wrapOrigin, size: CGSize(width: wrapSize, height: wrapSize))
        ringView.layer.cornerRadius = wrapSize / 2
        container.frame = CGRect(x: (w - oSize) / 2, y: h * 0.36 - oSize / 2, width: oSize, height: oSize)
        layoutPaths(in: container.bounds)

        // Amber seed blooms to full O size
        seed.path = UIBezierPath(ovalIn: CGRect(x: 0, y: 0, width: oSize, height: oSize)).cgPath
        seed.bounds = CGRect(x: 0, y: 0, width: oSize, height: oSize)
        seed.position = CGPoint(x: oSize / 2, y: oSize / 2)

        divider.frame = CGRect(x: (w-180)/2, y: container.frame.maxY+28, width: 180, height: 1)
        wordmark.frame = CGRect(x: (w-260)/2, y: divider.frame.maxY+18, width: 260, height: 48)
        if wmNeedsBuild { buildWordmarkLayers(); wmNeedsBuild = false }
        tagline.frame = CGRect(x: 20, y: wordmark.frame.maxY+14, width: w-40, height: 20)
        category.frame = CGRect(x: 20, y: h-72, width: w-40, height: 16)
    }

    // MARK: — Setup
    private func setupGlows() {
        [glowTR, glowBL].forEach { $0.type = .radial; $0.startPoint = CGPoint(x: 0.5, y: 0.5); $0.endPoint = CGPoint(x: 1, y: 1); $0.opacity = 0; view.layer.addSublayer($0) }
        glowTR.colors = [Brand.sage.withAlphaComponent(0.13).cgColor, UIColor.clear.cgColor]
        glowBL.colors = [Brand.amber.withAlphaComponent(0.09).cgColor, UIColor.clear.cgColor]
    }

    private func setupRing() {
        ringView.backgroundColor = Brand.ring
        ringView.alpha = 0
        view.addSubview(ringView)
    }

    private func setupSeedDot() {
        seed.fillColor = Brand.amber.cgColor
        seed.opacity = 1
        seed.setAffineTransform(CGAffineTransform(scaleX: 0.01, y: 0.01))
        container.layer.insertSublayer(seed, at: 0)
    }

    private func setupOmark() {
        container.backgroundColor = .clear; view.addSubview(container)
        [segY, segC, segO, segN].forEach {
            $0.fillRule = .nonZero; $0.opacity = 0
            $0.setAffineTransform(CGAffineTransform(scaleX: 0.55, y: 0.55))
            container.layer.addSublayer($0)
        }
        segY.fillColor = Brand.yell.cgColor; segC.fillColor = Brand.cyan.cgColor
        segO.fillColor = Brand.orng.cgColor; segN.fillColor = Brand.navySeg.cgColor
    }

    private func layoutPaths(in rect: CGRect) {
        let sx = rect.width/134, sy = rect.height/148
        func t(_ path: UIBezierPath) -> CGPath { var af = CGAffineTransform(translationX: -308, y: -278).concatenating(CGAffineTransform(scaleX: sx, y: sy)); return path.cgPath.copy(using: &af)! }

        let y = UIBezierPath(); y.move(to: CGPoint(x: 383.54, y: 287.38)); y.addLine(to: CGPoint(x: 378.64, y: 310.29))
        y.addCurve(to: CGPoint(x: 331.49, y: 348.03), controlPoint1: CGPoint(x: 374.21, y: 309.52), controlPoint2: CGPoint(x: 354.60, y: 326.84))
        y.addLine(to: CGPoint(x: 308.10, y: 348.03))
        y.addCurve(to: CGPoint(x: 373.15, y: 285.54), controlPoint1: CGPoint(x: 309.43, y: 313.29), controlPoint2: CGPoint(x: 338.09, y: 285.54))
        y.addCurve(to: CGPoint(x: 383.54, y: 287.38), controlPoint1: CGPoint(x: 376.72, y: 285.54), controlPoint2: CGPoint(x: 380.18, y: 285.86))
        y.close(); segY.path = t(y)

        let c = UIBezierPath(); c.move(to: CGPoint(x: 435.86, y: 334.15)); c.addLine(to: CGPoint(x: 412.79, y: 338.79))
        c.addCurve(to: CGPoint(x: 383.91, y: 311.35), controlPoint1: CGPoint(x: 400.33, y: 329.34), controlPoint2: CGPoint(x: 390.55, y: 320.93))
        c.addLine(to: CGPoint(x: 388.76, y: 288.49))
        c.addCurve(to: CGPoint(x: 435.86, y: 334.15), controlPoint1: CGPoint(x: 411.56, y: 294.03), controlPoint2: CGPoint(x: 429.62, y: 311.67))
        c.close(); segC.path = t(c)

        let o = UIBezierPath(); o.move(to: CGPoint(x: 437.21, y: 339.86)); o.addLine(to: CGPoint(x: 414.25, y: 344.44)); o.addLine(to: CGPoint(x: 410.81, y: 345.12))
        o.addCurve(to: CGPoint(x: 381.67, y: 388.78), controlPoint1: CGPoint(x: 411.56, y: 356.25), controlPoint2: CGPoint(x: 399.61, y: 375.11))
        o.addLine(to: CGPoint(x: 382.49, y: 392.20)); o.addLine(to: CGPoint(x: 388.00, y: 414.95)); o.addLine(to: CGPoint(x: 388.83, y: 418.35))
        o.addCurve(to: CGPoint(x: 442.04, y: 351.45), controlPoint1: CGPoint(x: 419.28, y: 411.32), controlPoint2: CGPoint(x: 442.04, y: 383.80))
        o.addCurve(to: CGPoint(x: 440.89, y: 338.95), controlPoint1: CGPoint(x: 442.04, y: 347.18), controlPoint2: CGPoint(x: 441.65, y: 343.00))
        o.addLine(to: CGPoint(x: 437.21, y: 339.86)); o.close(); segO.path = t(o)

        let n = UIBezierPath(); n.move(to: CGPoint(x: 382.05, y: 416.20))
        n.addCurve(to: CGPoint(x: 373.10, y: 416.84), controlPoint1: CGPoint(x: 379.07, y: 416.63), controlPoint2: CGPoint(x: 376.08, y: 416.84))
        n.addCurve(to: CGPoint(x: 308.10, y: 354.35), controlPoint1: CGPoint(x: 338.04, y: 416.84), controlPoint2: CGPoint(x: 309.43, y: 389.08))
        n.addLine(to: CGPoint(x: 331.54, y: 354.35))
        n.addCurve(to: CGPoint(x: 373.10, y: 393.46), controlPoint1: CGPoint(x: 332.93, y: 376.14), controlPoint2: CGPoint(x: 351.04, y: 393.46))
        n.addCurve(to: CGPoint(x: 376.51, y: 393.25), controlPoint1: CGPoint(x: 374.27, y: 393.46), controlPoint2: CGPoint(x: 375.39, y: 393.41))
        n.addLine(to: CGPoint(x: 382.05, y: 416.20)); n.close(); segN.path = t(n)
    }

    private func setupDivider() {
        let g = CAGradientLayer(); g.type = .axial
        g.colors = [UIColor.clear.cgColor, Brand.amber.withAlphaComponent(0.65).cgColor, UIColor.clear.cgColor]
        g.locations = [0, 0.5, 1]; g.startPoint = CGPoint(x: 0, y: 0.5); g.endPoint = CGPoint(x: 1, y: 0.5)
        divider.alpha = 0; divider.transform = CGAffineTransform(scaleX: 0.01, y: 1)
        view.addSubview(divider)
        DispatchQueue.main.async { g.frame = self.divider.bounds; self.divider.layer.addSublayer(g) }
    }

    private var wmGoldLayer: CAGradientLayer?
    private var wmOSegs: [CAShapeLayer] = []
    private var wmLetterPaths: [CGPath] = []
    private var wmSegPaths: [CGPath] = []
    private var wmNeedsBuild = true

    private func setupWordmark() {
        wordmark.alpha = 0; wordmark.transform = CGAffineTransform(translationX: 0, y: 50)
        wordmark.backgroundColor = .clear
        view.addSubview(wordmark)
        wmLetterPaths = [wmM, wmN, wmY, wmT, wmI, wmX].map { fn in
            let p = UIBezierPath(); p.addLines(fn()); p.close(); return p.cgPath
        }
        wmSegPaths = [wmSegY, wmSegC, wmSegO, wmSegN].map { fn in
            let p = UIBezierPath(); p.addLines(fn()); p.close(); return p.cgPath
        }
        wmNeedsBuild = true
    }

    private func buildWordmarkLayers() {
        wmGoldLayer?.removeFromSuperlayer()
        wmOSegs.forEach { $0.removeFromSuperlayer() }; wmOSegs.removeAll()

        let w = wordmark.bounds.width, h = wordmark.bounds.height
        guard w > 0, h > 0 else { return }

        let gold = CAGradientLayer()
        gold.frame = wordmark.bounds
        gold.colors = [
            UIColor(hex: "#A2692A")!.cgColor, UIColor(hex: "#BE8C3B")!.cgColor,
            UIColor(hex: "#D4B260")!.cgColor, UIColor(hex: "#F9F0A0")!.cgColor,
            UIColor(hex: "#FCF8C5")!.cgColor, UIColor(hex: "#F9F0A0")!.cgColor,
            UIColor(hex: "#D4B260")!.cgColor, UIColor(hex: "#BE8C3B")!.cgColor,
            UIColor(hex: "#B27C31")!.cgColor, UIColor(hex: "#BB8331")!.cgColor,
            UIColor(hex: "#D5A346")!.cgColor, UIColor(hex: "#E1B454")!.cgColor,
            UIColor(hex: "#A46A2A")!.cgColor
        ]
        gold.startPoint = CGPoint(x: 0, y: 0); gold.endPoint = CGPoint(x: 0, y: 1)

        let mask = CAShapeLayer(); mask.fillRule = .nonZero
        let trans = CGAffineTransform(translationX: -168, y: -278).scaledBy(x: w/720, y: h/130)
        let mutable = CGMutablePath()
        for path in wmLetterPaths { mutable.addPath(path.copy(using: &trans)!) }
        mask.path = mutable
        gold.mask = mask
        wordmark.layer.addSublayer(gold)
        wmGoldLayer = gold

        let oColors: [UIColor] = [.init(hex: "#F9C515")!, .init(hex: "#55C2EF")!, .init(hex: "#F47521")!, .init(hex: "#313A96")!]
        let oX = (308 - 168) / 720 * w
        let oW = 134 / 720 * w
        let oTrans = CGAffineTransform(translationX: -308, y: -278).scaledBy(x: oW/134, y: h/148)
        for (idx, path) in wmSegPaths.enumerated() {
            let seg = CAShapeLayer()
            seg.path = path.copy(using: &oTrans)!
            seg.fillColor = oColors[idx].cgColor
            seg.frame = CGRect(x: oX, y: 0, width: oW, height: h)
            wordmark.layer.addSublayer(seg)
            wmOSegs.append(seg)
        }
    }

    private func setupLabels() {
        tagline.text = "ADAPTIVE FINANCIAL INTELLIGENCE"; tagline.font = UIFont.systemFont(ofSize: 11, weight: .medium)
        tagline.textColor = Brand.sage.withAlphaComponent(0.85); tagline.textAlignment = .center
        tagline.alpha = 0; tagline.adjustsFontSizeToFitWidth = true

        category.text = "· INDIA'S DECISION LAYER FOR MONEY ·"
        category.font = UIFont.systemFont(ofSize: 9, weight: .semibold)
        category.textColor = Brand.amber.withAlphaComponent(0.55); category.textAlignment = .center; category.alpha = 0

        view.addSubview(tagline); view.addSubview(category)
    }

    // MARK: — Animation sequence (HTML O-mark timing)
    private func playReveal() {
        // 1. Glows
        CATransaction.begin(); CATransaction.setAnimationDuration(1.5)
        glowTR.opacity = 1; glowBL.opacity = 1; CATransaction.commit()

        // 2. Contrast ring
        UIView.animate(withDuration: 0.45, delay: 0, options: .curveEaseInOut) { [weak self] in
            self?.ringView.alpha = 0.7
        }

        // 3. Amber seed bloom to full O (ease-in-out 650ms, starts ~0.20)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.20) { [weak self] in
            guard let self else { return }
            let bloom = CABasicAnimation(keyPath: "transform.scale")
            bloom.fromValue = 0.01; bloom.toValue = 1.0; bloom.duration = 0.65
            bloom.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            bloom.fillMode = .forwards; bloom.isRemovedOnCompletion = false
            self.seed.add(bloom, forKey: "bloom")
            self.seed.setAffineTransform(.identity)
        }

        // 4. Seed fade + segments (start ~0.85, 110ms stagger, scale 0.55→1)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.85) { [weak self] in
            guard let self else { return }
            let fade = CABasicAnimation(keyPath: "opacity")
            fade.fromValue = 1; fade.toValue = 0; fade.duration = 0.25
            fade.fillMode = .forwards; fade.isRemovedOnCompletion = false
            self.seed.add(fade, forKey: "fade")
            self.seed.opacity = 0
        }
        let segs: [(CAShapeLayer, TimeInterval)] = [
            (segY, 0.85), (segC, 0.96), (segO, 1.07), (segN, 1.18)
        ]
        for (lyr, delay) in segs { springSeg(lyr, delay: delay) }

        // 5. Divider (~1.76)
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.76) { [weak self] in
            UIView.animate(withDuration: 0.55, delay: 0, options: .curveEaseInOut) {
                self?.divider.alpha = 1; self?.divider.transform = .identity
            }
        }

        // 6. Wordmark (~2.01)
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.01) { [weak self] in
            UIViewPropertyAnimator(dampingRatio: 0.7, duration: 0.65) {
                self?.wordmark.alpha = 1; self?.wordmark.transform = .identity
            }.startAnimation()
        }

        // 7. Tagline + category
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.71) { [weak self] in
            UIView.animate(withDuration: 0.6) { self?.tagline.alpha = 1 }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.91) { [weak self] in
            UIView.animate(withDuration: 0.5) { self?.category.alpha = 1 }
        }

        // 8. Transition out (~3.6s)
        DispatchQueue.main.asyncAfter(deadline: .now() + 3.60) { [weak self] in self?.transitionOut() }
    }

    private func springSeg(_ layer: CAShapeLayer, delay: TimeInterval) {
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
            let fade = CABasicAnimation(keyPath: "opacity"); fade.fromValue = 0; fade.toValue = 1; fade.duration = 0.40
            let scale = CASpringAnimation(keyPath: "transform.scale")
            scale.fromValue = 0.55; scale.toValue = 1.0; scale.duration = 0.40
            scale.damping = 10; scale.initialVelocity = 6; scale.mass = 0.8
            let grp = CAAnimationGroup(); grp.animations = [fade, scale]; grp.duration = 0.40
            grp.fillMode = .forwards; grp.isRemovedOnCompletion = false
            layer.add(grp, forKey: "seg"); layer.opacity = 1; layer.setAffineTransform(.identity)
        }
    }

    private func transitionOut() {
        guard let window = view.window else { return }
        UIView.transition(with: window, duration: 0.45, options: .transitionCrossDissolve) {
            window.rootViewController = UIViewController() // replace with your main VC
        }
    }
}

// MARK: — O-mark segment paths (viewBox 308 278 134 148)
private func wmSegY() -> [CGPoint] {[
    .init(x:383.54,y:287.38),.init(x:378.64,y:310.29),.init(x:374.21,y:309.52),.init(x:354.60,y:326.84),.init(x:331.49,y:348.03),.init(x:308.10,y:348.03),.init(x:309.43,y:313.29),.init(x:338.09,y:285.54),.init(x:373.15,y:285.54),.init(x:376.72,y:285.54),.init(x:380.18,y:285.86),.init(x:383.54,y:287.38)
]}
private func wmSegC() -> [CGPoint] {[
    .init(x:435.86,y:334.15),.init(x:412.79,y:338.79),.init(x:400.33,y:329.34),.init(x:390.55,y:320.93),.init(x:383.91,y:311.35),.init(x:388.76,y:288.49),.init(x:411.56,y:294.03),.init(x:429.62,y:311.67),.init(x:435.86,y:334.15)
]}
private func wmSegO() -> [CGPoint] {[
    .init(x:437.21,y:339.86),.init(x:414.25,y:344.44),.init(x:410.81,y:345.12),.init(x:411.56,y:356.25),.init(x:399.61,y:375.11),.init(x:381.67,y:388.78),.init(x:382.49,y:392.20),.init(x:388.00,y:414.95),.init(x:388.83,y:418.35),.init(x:419.28,y:411.32),.init(x:442.04,y:383.80),.init(x:442.04,y:351.45),.init(x:442.04,y:347.18),.init(x:441.65,y:343.00),.init(x:440.89,y:338.95),.init(x:437.21,y:339.86)
]}
private func wmSegN() -> [CGPoint] {[
    .init(x:382.05,y:416.20),.init(x:379.07,y:416.63),.init(x:376.08,y:416.84),.init(x:373.10,y:416.84),.init(x:338.04,y:416.84),.init(x:309.43,y:389.08),.init(x:308.10,y:354.35),.init(x:331.54,y:354.35),.init(x:332.93,y:376.14),.init(x:351.04,y:393.46),.init(x:373.10,y:393.46),.init(x:374.27,y:393.46),.init(x:375.39,y:393.41),.init(x:376.51,y:393.25),.init(x:382.05,y:416.20)
]}

// MARK: — Gold-gradient wordmark (original logo SVG paths)
private func wmM() -> [CGPoint] {[
    .init(x:180.5,y:400.78),.init(x:178.34,y:399.48),.init(x:178.34,y:395.34),.init(x:178.34,y:335.97),.init(x:181.34,y:317.25),.init(x:187.33,y:311.30),.init(x:193.32,y:305.35),.init(x:201.52,y:302.38),.init(x:211.93,y:302.38),.init(x:222.22,y:303.73),.init(x:226.91,y:306.42),.init(x:231.60,y:309.12),.init(x:235.43,y:312.83),.init(x:238.41,y:317.57),.init(x:241.38,y:312.74),.init(x:245.19,y:309.00),.init(x:249.84,y:306.35),.init(x:254.48,y:303.70),.init(x:259.60,y:302.38),.init(x:265.17,y:302.38),.init(x:275.67,y:302.38),.init(x:283.86,y:305.35),.init(x:289.77,y:311.30),.init(x:295.67,y:317.24),.init(x:298.62,y:325.47),.init(x:298.62,y:335.97),.init(x:298.62,y:395.34),.init(x:297.90,y:397.36),.init(x:296.46,y:398.71),.init(x:295.02,y:400.05),.init(x:293.09,y:400.73),.init(x:290.68,y:400.73),.init(x:288.33,y:400.08),.init(x:286.89,y:398.78),.init(x:285.45,y:397.48),.init(x:284.73,y:395.67),.init(x:284.73,y:391.34),.init(x:284.73,y:331.97),.init(x:283.31,y:324.81),.init(x:280.48,y:321.47),.init(x:277.64,y:318.13),.init(x:273.02,y:316.45),.init(x:266.61,y:316.45),.init(x:260.76,y:316.45),.init(x:256.25,y:318.26),.init(x:253.09,y:321.89),.init(x:249.93,y:325.51),.init(x:248.35,y:330.62),.init(x:248.35,y:337.22),.init(x:248.35,y:396.59),.init(x:247.63,y:398.73),.init(x:246.19,y:400.03),.init(x:244.75,y:401.33),.init(x:242.82,y:401.98),.init(x:240.41,y:401.98),.init(x:238.11,y:401.33),.init(x:236.76,y:400.03),.init(x:235.42,y:398.73),.init(x:234.74,y:396.59),.init(x:234.74,y:391.22),.init(x:234.74,y:331.85),.init(x:233.11,y:320.26),.init(x:230.27,y:316.59),.init(x:227.02,y:312.92),.init(x:222.56,y:311.08),.init(x:216.89,y:311.08),.init(x:210.38,y:311.08),.init(x:206.54,y:312.75),.init(x:203.70,y:316.10),.init(x:200.86,y:319.44),.init(x:199.45,y:325.85),.init(x:199.45,y:335.97),.init(x:199.45,y:395.34),.init(x:198.73,y:397.57),.init(x:197.29,y:398.91),.init(x:195.85,y:400.25),.init(x:193.92,y:400.93),.init(x:191.51,y:400.93),.init(x:189.17,y:400.28),.init(x:187.73,y:398.98),.init(x:186.29,y:397.68),.init(x:185.55,y:395.65),.init(x:185.55,y:395.34)
]}
private func wmN() -> [CGPoint] {[
    .init(x:452.51,y:400.78),.init(x:451.12,y:399.48),.init(x:450.42,y:397.67),.init(x:450.42,y:395.34),.init(x:450.42,y:341.26),.init(x:454.21,y:319.57),.init(x:461.78,y:312.69),.init(x:469.35,y:305.81),.init(x:479.78,y:302.38),.init(x:493.07,y:302.38),.init(x:509.38,y:303.94),.init(x:515.79,y:307.05),.init(x:522.20,y:310.17),.init(x:527.10,y:314.65),.init(x:530.49,y:320.50),.init(x:533.88,y:326.36),.init(x:535.58,y:333.28),.init(x:535.58,y:341.27),.init(x:535.58,y:395.34),.init(x:534.88,y:397.66),.init(x:533.48,y:398.98),.init(x:532.09,y:400.30),.init(x:530.19,y:400.93),.init(x:527.77,y:400.93),.init(x:525.43,y:400.25),.init(x:523.98,y:398.91),.init(x:522.54,y:397.56),.init(x:521.81,y:395.77),.init(x:521.81,y:391.34),.init(x:521.81,y:336.85),.init(x:519.49,y:322.21),.init(x:514.84,y:317.75),.init(x:510.20,y:313.29),.init(x:503.60,y:311.06),.init(x:495.05,y:311.06),.init(x:486.50,y:311.06),.init(x:479.88,y:313.31),.init(x:475.19,y:317.82),.init(x:470.50,y:322.33),.init(x:468.15,y:328.67),.init(x:468.15,y:336.85),.init(x:468.15,y:391.34),.init(x:467.43,y:393.57),.init(x:465.99,y:394.91),.init(x:464.55,y:396.25),.init(x:462.62,y:396.93),.init(x:460.21,y:396.93),.init(x:457.89,y:396.28),.init(x:456.50,y:394.98),.init(x:455.12,y:393.68),.init(x:454.41,y:391.12),.init(x:454.41,y:391.34)
]}
private func wmY() -> [CGPoint] {[
    .init(x:629.79,y:304.34),.init(x:631.19,y:305.64),.init(x:631.88,y:307.45),.init(x:631.88,y:309.78),.init(x:631.88,y:325.39),.init(x:628.74,y:337.69),.init(x:622.47,y:345.49),.init(x:616.20,y:353.29),.init(x:607.54,y:357.99),.init(x:596.48,y:359.57),.init(x:596.48,y:385.35),.init(x:596.48,y:387.58),.init(x:594.79,y:389.50),.init(x:593.10,y:391.42),.init(x:590.95,y:390.94),.init(x:588.53,y:390.94),.init(x:586.19,y:390.29),.init(x:584.74,y:388.99),.init(x:583.30,y:387.69),.init(x:582.58,y:385.88),.init(x:582.58,y:383.55),.init(x:582.58,y:357.77),.init(x:571.43,y:356.19),.init(x:562.72,y:351.54),.init(x:554.01,y:346.89),.init(x:547.74,y:339.18),.init(x:547.74,y:339.18),.init(x:541.47,y:331.47),.init(x:538.33,y:321.39),.init(x:538.33,y:308.94),.init(x:538.33,y:293.33),.init(x:539.05,y:291.00),.init(x:540.49,y:289.70),.init(x:541.93,y:288.40),.init(x:543.86,y:287.75),.init(x:546.27,y:287.75),.init(x:548.61,y:288.42),.init(x:550.05,y:289.77),.init(x:551.49,y:291.12),.init(x:552.21,y:292.93),.init(x:552.21,y:294.29),.init(x:552.21,y:310.32),.init(x:554.60,y:322.45),.init(x:559.39,y:328.56),.init(x:564.18,y:334.67),.init(x:570.99,y:337.78),.init(x:579.82,y:337.78),.init(x:588.65,y:337.78),.init(x:594.44,y:335.02),.init(x:599.23,y:329.49),.init(x:604.02,y:323.96),.init(x:606.41,y:316.18),.init(x:606.41,y:306.15),.init(x:606.41,y:290.12),.init(x:606.41,y:287.76),.init(x:607.87,y:286.12),.init(x:609.33,y:284.48),.init(x:612.07,y:284.38),.init(x:614.49,y:284.38),.init(x:616.81,y:285.03),.init(x:618.25,y:286.33),.init(x:619.69,y:287.63),.init(x:620.44,y:289.60),.init(x:620.44,y:289.79)
]}
private func wmT() -> [CGPoint] {[
    .init(x:683.03,y:397.72),.init(x:683.03,y:311.31),.init(x:650.14,y:311.31),.init(x:646.98,y:311.31),.init(x:645.40,y:310.10),.init(x:645.40,y:307.69),.init(x:645.40,y:306.30),.init(x:645.79,y:305.30),.init(x:646.58,y:304.70),.init(x:647.37,y:304.10),.init(x:648.55,y:303.79),.init(x:650.13,y:303.79),.init(x:724.97,y:303.79),.init(x:728.13,y:303.79),.init(x:729.71,y:305.09),.init(x:729.71,y:307.69),.init(x:729.71,y:310.11),.init(x:728.13,y:311.31),.init(x:726.55,y:312.51),.init(x:723.39,y:311.31),.init(x:690.50,y:311.31),.init(x:690.50,y:397.72),.init(x:690.50,y:399.30),.init(x:690.08,y:400.53),.init(x:689.25,y:401.41),.init(x:688.42,y:402.29),.init(x:687.30,y:402.74),.init(x:685.90,y:402.74),.init(x:682.92,y:402.74),.init(x:681.44,y:401.06),.init(x:680.68,y:399.00),.init(x:680.68,y:397.72)
]}
private func wmI() -> [CGPoint] {[
    .init(x:750.83,y:401.41),.init(x:750.04,y:400.53),.init(x:749.65,y:399.30),.init(x:749.65,y:397.72),.init(x:749.65,y:307.41),.init(x:749.65,y:305.59),.init(x:751.14,y:304.39),.init(x:753.11,y:303.36),.init(x:755.08,y:302.38),.init(x:757.57,y:302.38),.init(x:761.94,y:302.38),.init(x:763.03,y:302.82),.init(x:763.82,y:303.70),.init(x:764.61,y:304.58),.init(x:765.01,y:305.82),.init(x:765.01,y:307.41),.init(x:765.01,y:397.72),.init(x:764.61,y:399.30),.init(x:763.82,y:400.41),.init(x:763.03,y:401.52),.init(x:761.94,y:402.08),.init(x:760.54,y:402.41),.init(x:757.26,y:402.41),.init(x:754.78,y:401.52),.init(x:752.82,y:400.61),.init(x:753.11,y:402.08)
]}
private func wmX() -> [CGPoint] {[
    .init(x:857.66,y:398.83),.init(x:857.66,y:400.13),.init(x:857.10,y:401.16),.init(x:855.99,y:401.90),.init(x:855.16,y:402.46),.init(x:854.36,y:402.74),.init(x:853.62,y:402.74),.init(x:852.32,y:402.74),.init(x:850.72,y:401.90),.init(x:848.42,y:400.23),.init(x:814.69,y:357.86),.init(x:780.96,y:400.23),.init(x:779.75,y:401.90),.init(x:778.45,y:402.74),.init(x:777.15,y:402.74),.init(x:776.40,y:402.74),.init(x:775.61,y:402.46),.init(x:774.78,y:401.90),.init(x:773.76,y:401.16),.init(x:773.24,y:400.14),.init(x:773.24,y:398.83),.init(x:773.24,y:397.90),.init(x:773.61,y:396.93),.init(x:774.36,y:395.90),.init(x:809.76,y:351.44),.init(x:776.03,y:309.21),.init(x:775.38,y:308.47),.init(x:775.06,y:307.49),.init(x:775.06,y:306.28),.init(x:775.06,y:304.89),.init(x:775.57,y:303.86),.init(x:776.59,y:303.22),.init(x:777.43,y:302.67),.init(x:778.17,y:302.39),.init(x:778.82,y:302.39),.init(x:780.03,y:302.39),.init(x:781.33,y:303.22),.init(x:783.23,y:305.73),.init(x:815.29,y:346.01),.init(x:847.35,y:305.73),.init(x:848.65,y:304.06),.init(x:849.95,y:303.22),.init(x:851.25,y:303.22),.init(x:852.09,y:303.22),.init(x:852.83,y:303.50),.init(x:853.48,y:304.05),.init(x:854.60,y:304.72),.init(x:855.15,y:305.78),.init(x:855.15,y:307.41),.init(x:855.15,y:308.34),.init(x:854.78,y:309.32),.init(x:854.04,y:310.34),.init(x:820.45,y:352.57),.init(x:855.85,y:397.03),.init(x:856.59,y:398.05),.init(x:856.96,y:399.02),.init(x:856.96,y:398.83)
]}

// MARK: — UIColor hex
extension UIColor { convenience init?(hex: String) {
    var s = hex.trimmingCharacters(in: .whitespacesAndNewlines); if s.hasPrefix("#") { s.removeFirst() }
    guard s.count == 6, let v = UInt64(s, radix: 16) else { return nil }
    self.init(red: CGFloat((v>>16)&0xFF)/255, green: CGFloat((v>>8)&0xFF)/255, blue: CGFloat(v&0xFF)/255, alpha: 1)
}}
