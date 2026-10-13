import SwiftUI

struct BusinessPalette: Sendable {
    let canvas: Color
    let surface: Color
    let surfaceRaised: Color
    let surfaceAlt: Color
    let textPrimary: Color
    let textSecondary: Color
    let accent: Color
    let border: Color
    let divider: Color
    let neutralFill: Color
    let neutralBorder: Color
    let neutralLabel: Color
    let positiveFill: Color
    let positiveBorder: Color
    let positiveLabel: Color
    let attentionFill: Color
    let attentionBorder: Color
    let attentionLabel: Color
    let goalFill: Color
    let goalBorder: Color
    let goalLabel: Color
    let symbolAttention: Color
    let symbolImpact: Color
    let disabledFill: Color
    let disabledBorder: Color
    let disabledLabel: Color
}

struct BusinessActionColors: Sendable {
    let `default`: Color
    let hover: Color
    let pressed: Color
    let border: Color
    let label: Color
}

enum BusinessTypeScale {
    static let caption: CGFloat = 12
    static let footnote: CGFloat = 13
    static let bodySmall: CGFloat = 14
    static let body: CGFloat = 15
    static let bodyLarge: CGFloat = 16
    static let titleSmall: CGFloat = 18
    static let title: CGFloat = 20
    static let headline: CGFloat = 25
    static let display: CGFloat = 26
    static let status: CGFloat = 38
    static let hero: CGFloat = 40
    static let progress: CGFloat = 44
    static let bodyLineHeight: CGFloat = 1.4
}

enum BusinessSpace {
    static let s4: CGFloat = 4
    static let s6: CGFloat = 6
    static let s8: CGFloat = 8
    static let s12: CGFloat = 12
    static let s14: CGFloat = 14
    static let s16: CGFloat = 16
    static let s18: CGFloat = 18
    static let s20: CGFloat = 20
    static let s22: CGFloat = 22
    static let s24: CGFloat = 24
    static let s28: CGFloat = 28
    static let s36: CGFloat = 36
    static let s40: CGFloat = 40
}

enum BusinessRadius {
    static let action: CGFloat = 18
    static let card: CGFloat = 28
    static let inset: CGFloat = 20
    static let symbol: CGFloat = 13
    static let pill: CGFloat = 999
}

enum BusinessTokens {
    static let action = BusinessActionColors(
        default: Color(hex: 0xF7C663),
        hover: Color(hex: 0xF9D183),
        pressed: Color(hex: 0xE9B64E),
        border: Color(hex: 0xE5AA38),
        label: Color(hex: 0x12181F)
    )

    static let light = BusinessPalette(
        canvas: Color(hex: 0xF4F7FA),
        surface: Color(hex: 0xFFFFFF),
        surfaceRaised: Color(hex: 0xEAF2F6),
        surfaceAlt: Color(hex: 0xEEF4F8),
        textPrimary: Color(hex: 0x12181F),
        textSecondary: Color(hex: 0x5B6D7A),
        accent: Color(hex: 0x146F65),
        border: Color(hex: 0xD7E0E6),
        divider: Color(hex: 0xD7E0E6),
        neutralFill: Color(hex: 0xEAF2F6),
        neutralBorder: Color(hex: 0xD7E0E6),
        neutralLabel: Color(hex: 0x6B7A8A),
        positiveFill: Color(hex: 0xEAF2F6),
        positiveBorder: Color(hex: 0xD7E0E6),
        positiveLabel: Color(hex: 0x146F65),
        attentionFill: Color(hex: 0xF7E8E1),
        attentionBorder: Color(hex: 0xE8D7D0),
        attentionLabel: Color(hex: 0xA34E47),
        goalFill: Color(hex: 0xEAF2F6),
        goalBorder: Color(hex: 0xD7E0E6),
        goalLabel: Color(hex: 0x6B7A8A),
        symbolAttention: Color(hex: 0xFFD3C5),
        symbolImpact: Color(hex: 0xFFE19B),
        disabledFill: Color(hex: 0xDCE4EA),
        disabledBorder: Color(hex: 0xD7E0E6),
        disabledLabel: Color(hex: 0x586875)
    )

    static let dark = BusinessPalette(
        canvas: Color(hex: 0x0F1418),
        surface: Color(hex: 0x1B2329),
        surfaceRaised: Color(hex: 0x26343D),
        surfaceAlt: Color(hex: 0x26343D),
        textPrimary: Color(hex: 0xE8F0F4),
        textSecondary: Color(hex: 0xAEC0D9),
        accent: Color(hex: 0x5CB8AA),
        border: Color(hex: 0x3B4B55),
        divider: Color(hex: 0x3B4B55),
        neutralFill: Color(hex: 0x26343D),
        neutralBorder: Color(hex: 0x3B4B55),
        neutralLabel: Color(hex: 0xA8C0D0),
        positiveFill: Color(hex: 0x193F3D),
        positiveBorder: Color(hex: 0x3B4B55),
        positiveLabel: Color(hex: 0x5CB8AA),
        attentionFill: Color(hex: 0x26343D),
        attentionBorder: Color(hex: 0x3B4B55),
        attentionLabel: Color(hex: 0xEDB5B1),
        goalFill: Color(hex: 0x193F3D),
        goalBorder: Color(hex: 0x3B4B55),
        goalLabel: Color(hex: 0x5CB8AA),
        symbolAttention: Color(hex: 0x20324D),
        symbolImpact: Color(hex: 0x193F3D),
        disabledFill: Color(hex: 0x34424B),
        disabledBorder: Color(hex: 0x3B4B55),
        disabledLabel: Color(hex: 0xB6C4CE)
    )
}

private extension Color {
    init(hex: UInt32, alpha: Double = 1) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: alpha
        )
    }
}
