import SwiftUI

struct PersonalPalette: Sendable {
    let canvas: Color
    let surface: Color
    let surfaceRaised: Color
    let textPrimary: Color
    let textSecondary: Color
    let accent: Color
    let border: Color
    let divider: Color
    let widgetGoalStart: Color
    let widgetGoalMid: Color
    let widgetGoalEnd: Color
    let widgetGoalBorder: Color
    let widgetDecision: Color
    let widgetDecisionBorder: Color
    let widgetChange: Color
    let widgetChangeBorder: Color
    let widgetCashStart: Color
    let widgetCashEnd: Color
    let widgetCashBorder: Color
    let widgetWeight: Color
    let widgetWeightBorder: Color
    let widgetImpactStart: Color
    let widgetImpactEnd: Color
    let widgetImpactBorder: Color
    let popover: Color
    let popoverBorder: Color
    let pointer: Color
    let sheet: Color
    let sheetBorder: Color
    let backdrop: Color
    let anchor: Color
    let closeFill: Color
    let dismiss: Color
    let mission: Color
    let progressTrack: Color
    let progressFill: Color
    let dragHandle: Color
    let cashFlexible: Color
    let cashCommitted: Color
}

struct PersonalStatus: Sendable {
    let gold: Color
    let goldBorder: Color
    let mint: Color
    let mintBorder: Color
    let coral: Color
    let coralBorder: Color
    let lavender: Color
    let lavenderBorder: Color
}

struct PersonalActionColors: Sendable {
    let `default`: Color
    let hover: Color
    let pressed: Color
    let disabledFill: Color
    let disabledLabel: Color
    let label: Color
}

struct PersonalElevation: Sendable {
    let y: CGFloat
    let blur: CGFloat
    let color: Color
}

struct PersonalElevations: Sendable {
    let action: PersonalElevation
    let card: PersonalElevation
    let sheet: PersonalElevation
}

enum PersonalTypeScale {
    static let caption: CGFloat = 11
    static let footnote: CGFloat = 13
    static let bodySmall: CGFloat = 14
    static let body: CGFloat = 15
    static let bodyLarge: CGFloat = 16
    static let titleSmall: CGFloat = 18
    static let title: CGFloat = 20
    static let headline: CGFloat = 24
    static let display: CGFloat = 26
    static let amount: CGFloat = 36
    static let hero: CGFloat = 40
    static let bodyLineHeight: CGFloat = 1.4
}

enum PersonalSpace {
    static let s4: CGFloat = 4
    static let s6: CGFloat = 6
    static let s8: CGFloat = 8
    static let s12: CGFloat = 12
    static let s14: CGFloat = 14
    static let s16: CGFloat = 16
    static let s20: CGFloat = 20
    static let s24: CGFloat = 24
    static let s28: CGFloat = 28
    static let s32: CGFloat = 32
    static let s48: CGFloat = 48
}

enum PersonalRadius {
    static let action: CGFloat = 18
    static let card: CGFloat = 28
    static let popover: CGFloat = 24
    static let sheet: CGFloat = 28
    static let pill: CGFloat = 999
    static let inset: CGFloat = 20
}

enum PersonalTokens {
    static let status = PersonalStatus(
        gold: Color(hex: 0xF7C663),
        goldBorder: Color(hex: 0xE5AA38),
        mint: Color(hex: 0xBCE9DB),
        mintBorder: Color(hex: 0x8BD7C0),
        coral: Color(hex: 0xFFD4CA),
        coralBorder: Color(hex: 0xF4B9A9),
        lavender: Color(hex: 0xDED3FA),
        lavenderBorder: Color(hex: 0xCDB9F3)
    )

    static let action = PersonalActionColors(
        default: Color(hex: 0xF7C663),
        hover: Color(hex: 0xFFD47D),
        pressed: Color(hex: 0xE9AF3E),
        disabledFill: Color(hex: 0xE7E7E2),
        disabledLabel: Color(hex: 0x777D79),
        label: Color(hex: 0x12181F)
    )

    static let elevation = PersonalElevations(
        action: PersonalElevation(y: 3, blur: 4, color: Color(hex: 0x2B1F0F, alpha: 0.15)),
        card: PersonalElevation(y: 5, blur: 16, color: Color(hex: 0x18382E, alpha: 0.04)),
        sheet: PersonalElevation(y: 12, blur: 32, color: Color(hex: 0x20332D, alpha: 0.12))
    )

    static let light = PersonalPalette(
        canvas: Color(hex: 0xF9FAF8),
        surface: Color(hex: 0xFFFFFF),
        surfaceRaised: Color(hex: 0xF2F5F2),
        textPrimary: Color(hex: 0x12181F),
        textSecondary: Color(hex: 0x2F3634),
        accent: Color(hex: 0x003731),
        border: Color(hex: 0xE3E5E5),
        divider: Color(hex: 0xE3E5E5),
        widgetGoalStart: Color(hex: 0xFFF2D7),
        widgetGoalMid: Color(hex: 0xFFEDE5),
        widgetGoalEnd: Color(hex: 0xEAE5FF),
        widgetGoalBorder: Color(hex: 0xDDC4A6),
        widgetDecision: Color(hex: 0xFFE3DB),
        widgetDecisionBorder: Color(hex: 0xF4B9A9),
        widgetChange: Color(hex: 0xFFFFFF),
        widgetChangeBorder: Color(hex: 0xE3E5E5),
        widgetCashStart: Color(hex: 0xDCF5EE),
        widgetCashEnd: Color(hex: 0xDCF5EE),
        widgetCashBorder: Color(hex: 0x8BD7C0),
        widgetWeight: Color(hex: 0xEAE1FF),
        widgetWeightBorder: Color(hex: 0xCDB9F3),
        widgetImpactStart: Color(hex: 0xFFF0D4),
        widgetImpactEnd: Color(hex: 0xFFF0D4),
        widgetImpactBorder: Color(hex: 0xF0CA82),
        popover: Color(hex: 0xFFFFFF),
        popoverBorder: Color(hex: 0xF0CA82),
        pointer: Color(hex: 0xFFFFFF),
        sheet: Color(hex: 0xFFFFFF),
        sheetBorder: Color(hex: 0xE3E5E5),
        backdrop: Color(hex: 0xDDE6E1),
        anchor: Color(hex: 0xF2F5F2),
        closeFill: Color(hex: 0xFFFFFF),
        dismiss: Color(hex: 0xF7F2FF),
        mission: Color(hex: 0xFFF0D4),
        progressTrack: Color(hex: 0xFFFFFF),
        progressFill: Color(hex: 0xE59A28),
        dragHandle: Color(hex: 0xBFC8C2),
        cashFlexible: Color(hex: 0x83D8CF),
        cashCommitted: Color(hex: 0xEDB5B1)
    )

    static let dark = PersonalPalette(
        canvas: Color(hex: 0x0A1530),
        surface: Color(hex: 0x14264A),
        surfaceRaised: Color(hex: 0x20304A),
        textPrimary: Color(hex: 0xE8F0F4),
        textSecondary: Color(hex: 0xBACAC5),
        accent: Color(hex: 0x57F1DB),
        border: Color(hex: 0x344568),
        divider: Color(hex: 0x344568),
        widgetGoalStart: Color(hex: 0x203A62),
        widgetGoalMid: Color(hex: 0x203A62),
        widgetGoalEnd: Color(hex: 0x14264A),
        widgetGoalBorder: Color(hex: 0x344568),
        widgetDecision: Color(hex: 0x252A40),
        widgetDecisionBorder: Color(hex: 0x344568),
        widgetChange: Color(hex: 0x14264A),
        widgetChangeBorder: Color(hex: 0x344568),
        widgetCashStart: Color(hex: 0x1B464E),
        widgetCashEnd: Color(hex: 0x142C42),
        widgetCashBorder: Color(hex: 0x344568),
        widgetWeight: Color(hex: 0x27243F),
        widgetWeightBorder: Color(hex: 0x344568),
        widgetImpactStart: Color(hex: 0x334041),
        widgetImpactEnd: Color(hex: 0x14264A),
        widgetImpactBorder: Color(hex: 0x344568),
        popover: Color(hex: 0x071124),
        popoverBorder: Color(hex: 0xE9BE80),
        pointer: Color(hex: 0x0A1530),
        sheet: Color(hex: 0x14264A),
        sheetBorder: Color(hex: 0x344568),
        backdrop: Color(hex: 0x071124),
        anchor: Color(hex: 0x20304A),
        closeFill: Color(hex: 0x1A2E52),
        dismiss: Color(hex: 0x252B45),
        mission: Color(hex: 0x20304A),
        progressTrack: Color(hex: 0x344568),
        progressFill: Color(hex: 0xE59A28),
        dragHandle: Color(hex: 0xBFC8C2),
        cashFlexible: Color(hex: 0x83D8CF),
        cashCommitted: Color(hex: 0xEDB5B1)
    )
}

extension Color {
    fileprivate init(hex: UInt32, alpha: Double = 1) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: alpha
        )
    }
}
