import CoreText
import SwiftUI

struct PersonalTheme: Sendable {
    let isDark: Bool
    let palette: PersonalPalette

    static let light = PersonalTheme(isDark: false, palette: PersonalTokens.light)
    static let dark = PersonalTheme(isDark: true, palette: PersonalTokens.dark)
}

extension EnvironmentValues {
    @Entry var personalTheme: PersonalTheme = .light
}

enum PersonalTextRole {
    case primary
    case secondary
    case accent
}

enum PersonalTextWeight {
    case regular
    case bold
    case extraBold
}

enum PersonalActionState {
    case `default`
    case hover
    case pressed
    case disabled
}

enum PersonalStatusTone {
    case gold
    case mint
    case coral
    case lavender
}

enum PersonalSurfaceRole {
    case goal
    case decision
    case change
    case cash
    case weight
    case impact
    case popover
    case sheet
    case backdrop
    case anchor
    case mission
    case dismiss
}

enum PersonalFontRegistration {
    static func register() {
        let names = ["inter_regular", "inter_semibold", "inter_bold", "inter_extrabold"]
        for name in names {
            let url = Bundle.main.url(forResource: name, withExtension: "ttf", subdirectory: "Fonts")
                ?? Bundle.main.url(forResource: name, withExtension: "ttf")
            guard let url else { continue }
            CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        }
    }
}

enum PersonalFont {
    static func font(size: CGFloat, weight: PersonalTextWeight) -> Font {
        switch weight {
        case .regular:
            .custom("Inter-Regular", size: size)
        case .bold:
            .custom("Inter-Bold", size: size)
        case .extraBold:
            .custom("Inter-ExtraBold", size: size)
        }
    }
}

private struct PersonalThemeAdapter: ViewModifier {
    @Environment(\.colorScheme) private var colorScheme

    func body(content: Content) -> some View {
        content.environment(\.personalTheme, colorScheme == .dark ? .dark : .light)
    }
}

private struct PersonalCanvasModifier: ViewModifier {
    @Environment(\.personalTheme) private var theme

    func body(content: Content) -> some View {
        content.background(theme.palette.canvas)
    }
}

private struct PersonalTextModifier: ViewModifier {
    @Environment(\.personalTheme) private var theme
    let role: PersonalTextRole
    let size: CGFloat
    let weight: PersonalTextWeight

    func body(content: Content) -> some View {
        content
            .font(PersonalFont.font(size: size, weight: weight))
            .foregroundStyle(color)
            .lineSpacing(size * (PersonalTypeScale.bodyLineHeight - 1))
    }

    private var color: Color {
        switch role {
        case .primary:
            theme.palette.textPrimary
        case .secondary:
            theme.palette.textSecondary
        case .accent:
            theme.palette.accent
        }
    }
}

private struct PersonalActionModifier: ViewModifier {
    @Environment(\.personalTheme) private var theme
    let state: PersonalActionState

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: PersonalRadius.action, style: .continuous)
        content
            .font(PersonalFont.font(size: PersonalTypeScale.bodySmall, weight: .bold))
            .foregroundStyle(label)
            .frame(maxWidth: .infinity, minHeight: 48)
            .background(fill, in: shape)
            .overlay(shape.stroke(border, lineWidth: 1))
            .shadow(color: showsShadow ? PersonalTokens.elevation.action.color : .clear, radius: PersonalTokens.elevation.action.blur / 2, x: 0, y: PersonalTokens.elevation.action.y)
    }

    private var fill: Color {
        switch state {
        case .default:
            PersonalTokens.action.default
        case .hover:
            PersonalTokens.action.hover
        case .pressed:
            PersonalTokens.action.pressed
        case .disabled:
            PersonalTokens.action.disabledFill
        }
    }

    private var label: Color {
        state == .disabled ? PersonalTokens.action.disabledLabel : PersonalTokens.action.label
    }

    private var border: Color {
        state == .disabled ? theme.palette.border : PersonalTokens.status.goldBorder
    }

    private var showsShadow: Bool {
        state == .default || state == .hover
    }
}

private struct PersonalStatusModifier: ViewModifier {
    @Environment(\.personalTheme) private var theme
    let tone: PersonalStatusTone

    func body(content: Content) -> some View {
        let shape = Capsule()
        content
            .font(PersonalFont.font(size: PersonalTypeScale.caption, weight: .bold))
            .foregroundStyle(theme.palette.textPrimary)
            .padding(.horizontal, PersonalSpace.s12)
            .padding(.vertical, PersonalSpace.s6)
            .background(fill, in: shape)
            .overlay(shape.stroke(border, lineWidth: 1))
            .shadow(color: PersonalTokens.elevation.action.color, radius: PersonalTokens.elevation.action.blur / 2, x: 0, y: PersonalTokens.elevation.action.y)
    }

    private var fill: Color {
        switch tone {
        case .gold:
            PersonalTokens.status.gold
        case .mint:
            PersonalTokens.status.mint
        case .coral:
            PersonalTokens.status.coral
        case .lavender:
            PersonalTokens.status.lavender
        }
    }

    private var border: Color {
        switch tone {
        case .gold:
            PersonalTokens.status.goldBorder
        case .mint:
            PersonalTokens.status.mintBorder
        case .coral:
            PersonalTokens.status.coralBorder
        case .lavender:
            PersonalTokens.status.lavenderBorder
        }
    }
}

private struct PersonalSurfaceModifier: ViewModifier {
    @Environment(\.personalTheme) private var theme
    let role: PersonalSurfaceRole

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .background(background)
            .clipShape(shape)
            .overlay(shape.stroke(border, lineWidth: 1))
            .shadow(color: shadow.color, radius: shadow.blur / 2, x: 0, y: shadow.y)
    }

    private var shape: AnyShape {
        if role == .sheet {
            AnyShape(
                UnevenRoundedRectangle(
                    topLeadingRadius: PersonalRadius.sheet,
                    bottomLeadingRadius: 0,
                    bottomTrailingRadius: 0,
                    topTrailingRadius: PersonalRadius.sheet,
                    style: .continuous
                )
            )
        } else {
            AnyShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
        }
    }

    private var palette: PersonalPalette { theme.palette }

    private var radius: CGFloat {
        switch role {
        case .popover:
            PersonalRadius.popover
        case .sheet, .backdrop:
            PersonalRadius.sheet
        case .mission:
            PersonalRadius.inset
        case .dismiss:
            PersonalRadius.action
        default:
            PersonalRadius.card
        }
    }

    private var padding: CGFloat {
        switch role {
        case .backdrop, .sheet, .dismiss:
            0
        case .anchor, .popover:
            PersonalSpace.s20
        default:
            PersonalSpace.s24
        }
    }

    private var border: Color {
        switch role {
        case .goal:
            palette.widgetGoalBorder
        case .decision:
            palette.widgetDecisionBorder
        case .change:
            palette.widgetChangeBorder
        case .cash:
            palette.widgetCashBorder
        case .weight:
            palette.widgetWeightBorder
        case .impact, .mission:
            palette.widgetImpactBorder
        case .popover:
            palette.popoverBorder
        case .sheet:
            palette.sheetBorder
        case .backdrop, .anchor, .dismiss:
            Color.clear
        }
    }

    @ViewBuilder
    private var background: some View {
        switch role {
        case .goal:
            LinearGradient(colors: [palette.widgetGoalStart, palette.widgetGoalMid, palette.widgetGoalEnd], startPoint: .leading, endPoint: .trailing)
        case .cash:
            LinearGradient(colors: [palette.widgetCashStart, palette.widgetCashEnd], startPoint: .topLeading, endPoint: .bottomTrailing)
        case .impact:
            LinearGradient(colors: [palette.widgetImpactStart, palette.widgetImpactEnd], startPoint: .topLeading, endPoint: .bottomTrailing)
        case .decision:
            palette.widgetDecision
        case .change:
            palette.widgetChange
        case .weight:
            palette.widgetWeight
        case .popover:
            palette.popover
        case .sheet:
            palette.sheet
        case .backdrop:
            palette.backdrop
        case .anchor:
            palette.anchor
        case .mission:
            palette.mission
        case .dismiss:
            palette.dismiss
        }
    }

    private var shadow: PersonalElevation {
        switch role {
        case .popover, .sheet:
            PersonalTokens.elevation.sheet
        case .backdrop, .anchor, .mission, .dismiss:
            PersonalElevation(y: 0, blur: 0, color: .clear)
        default:
            PersonalTokens.elevation.card
        }
    }
}

extension View {
    func personalTheme() -> some View {
        modifier(PersonalThemeAdapter())
    }

    func personalCanvas() -> some View {
        modifier(PersonalCanvasModifier())
    }

    func personalText(_ role: PersonalTextRole, size: CGFloat, weight: PersonalTextWeight = .regular) -> some View {
        modifier(PersonalTextModifier(role: role, size: size, weight: weight))
    }

    func personalAction(_ state: PersonalActionState) -> some View {
        modifier(PersonalActionModifier(state: state))
    }

    func personalStatus(_ tone: PersonalStatusTone) -> some View {
        modifier(PersonalStatusModifier(tone: tone))
    }

    func personalSurface(_ role: PersonalSurfaceRole) -> some View {
        modifier(PersonalSurfaceModifier(role: role))
    }

    func personalDivider() -> some View {
        modifier(PersonalDividerModifier())
    }
}

private struct PersonalDividerModifier: ViewModifier {
    @Environment(\.personalTheme) private var theme

    func body(content: Content) -> some View {
        content
            .frame(height: 1)
            .background(theme.palette.divider)
    }
}
