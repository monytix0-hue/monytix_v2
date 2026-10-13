import SwiftUI

struct BusinessTheme: Sendable {
    let isDark: Bool
    let palette: BusinessPalette

    static let light = BusinessTheme(isDark: false, palette: BusinessTokens.light)
    static let dark = BusinessTheme(isDark: true, palette: BusinessTokens.dark)
}

extension EnvironmentValues {
    @Entry var businessTheme: BusinessTheme = .light
}

enum BusinessTextRole {
    case primary
    case secondary
    case accent
    case neutral
    case positive
    case attention
    case goal
    case actionLabel
    case disabledLabel
}

enum BusinessTextWeight {
    case regular
    case semiBold
    case bold
    case extraBold
}

enum BusinessActionState {
    case `default`
    case hover
    case pressed
    case disabled
}

enum BusinessStatusTone {
    case neutral
    case positive
    case attention
    case goal
}

enum BusinessSurfaceRole {
    case surface
    case raised
    case alt
    case attentionSymbol
    case impactSymbol
}

private struct BusinessThemeAdapter: ViewModifier {
    @Environment(\.colorScheme) private var colorScheme

    func body(content: Content) -> some View {
        content.environment(\.businessTheme, colorScheme == .dark ? .dark : .light)
    }
}

private struct BusinessCanvasModifier: ViewModifier {
    @Environment(\.businessTheme) private var theme

    func body(content: Content) -> some View {
        content.background(theme.palette.canvas)
    }
}

private struct BusinessTextModifier: ViewModifier {
    @Environment(\.businessTheme) private var theme
    let role: BusinessTextRole
    let size: CGFloat
    let weight: BusinessTextWeight

    func body(content: Content) -> some View {
        content
            .font(font)
            .foregroundStyle(color)
            .lineSpacing(size * (BusinessTypeScale.bodyLineHeight - 1))
    }

    private var font: Font {
        switch weight {
        case .regular:
            .custom("Inter-Regular", size: size)
        case .semiBold:
            .custom("Inter-SemiBold", size: size)
        case .bold:
            .custom("Inter-Bold", size: size)
        case .extraBold:
            .custom("Inter-ExtraBold", size: size)
        }
    }

    private var color: Color {
        switch role {
        case .primary, .actionLabel:
            role == .actionLabel ? BusinessTokens.action.label : theme.palette.textPrimary
        case .secondary:
            theme.palette.textSecondary
        case .accent, .positive:
            theme.palette.positiveLabel
        case .neutral:
            theme.palette.neutralLabel
        case .attention:
            theme.palette.attentionLabel
        case .goal:
            theme.palette.goalLabel
        case .disabledLabel:
            theme.palette.disabledLabel
        }
    }
}

private struct BusinessActionModifier: ViewModifier {
    @Environment(\.businessTheme) private var theme
    let state: BusinessActionState

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: BusinessRadius.action, style: .continuous)
        content
            .font(.custom("Inter-Bold", size: BusinessTypeScale.body))
            .foregroundStyle(state == .disabled ? theme.palette.disabledLabel : BusinessTokens.action.label)
            .frame(maxWidth: .infinity, minHeight: 48)
            .background(fill, in: shape)
            .overlay(shape.stroke(border, lineWidth: 1))
    }

    private var fill: Color {
        switch state {
        case .default:
            BusinessTokens.action.default
        case .hover:
            BusinessTokens.action.hover
        case .pressed:
            BusinessTokens.action.pressed
        case .disabled:
            theme.palette.disabledFill
        }
    }

    private var border: Color {
        state == .disabled ? theme.palette.disabledBorder : BusinessTokens.action.border
    }
}

private struct BusinessStatusModifier: ViewModifier {
    @Environment(\.businessTheme) private var theme
    let tone: BusinessStatusTone

    func body(content: Content) -> some View {
        let shape = Capsule()
        content
            .font(.custom("Inter-SemiBold", size: BusinessTypeScale.caption))
            .foregroundStyle(label)
            .padding(.horizontal, BusinessSpace.s12)
            .padding(.vertical, BusinessSpace.s6)
            .background(fill, in: shape)
            .overlay(shape.stroke(border, lineWidth: 1))
    }

    private var fill: Color {
        switch tone {
        case .neutral:
            theme.palette.neutralFill
        case .positive:
            theme.palette.positiveFill
        case .attention:
            theme.palette.attentionFill
        case .goal:
            theme.palette.goalFill
        }
    }

    private var border: Color {
        switch tone {
        case .neutral:
            theme.palette.neutralBorder
        case .positive:
            theme.palette.positiveBorder
        case .attention:
            theme.palette.attentionBorder
        case .goal:
            theme.palette.goalBorder
        }
    }

    private var label: Color {
        switch tone {
        case .neutral:
            theme.palette.neutralLabel
        case .positive:
            theme.palette.positiveLabel
        case .attention:
            theme.palette.attentionLabel
        case .goal:
            theme.palette.goalLabel
        }
    }
}

private struct BusinessSurfaceModifier: ViewModifier {
    @Environment(\.businessTheme) private var theme
    let role: BusinessSurfaceRole

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        content
            .padding(padding)
            .background(fill, in: shape)
            .overlay(shape.stroke(border, lineWidth: border == .clear ? 0 : 1))
    }

    private var radius: CGFloat {
        switch role {
        case .attentionSymbol, .impactSymbol:
            BusinessRadius.symbol
        default:
            BusinessRadius.card
        }
    }

    private var padding: CGFloat {
        switch role {
        case .attentionSymbol, .impactSymbol:
            0
        default:
            BusinessSpace.s24
        }
    }

    private var fill: Color {
        switch role {
        case .surface:
            theme.palette.surface
        case .raised:
            theme.palette.surfaceRaised
        case .alt:
            theme.palette.surfaceAlt
        case .attentionSymbol:
            theme.palette.symbolAttention
        case .impactSymbol:
            theme.palette.symbolImpact
        }
    }

    private var border: Color {
        switch role {
        case .attentionSymbol, .impactSymbol:
            Color.clear
        default:
            theme.palette.border
        }
    }
}

private struct BusinessDividerModifier: ViewModifier {
    @Environment(\.businessTheme) private var theme

    func body(content: Content) -> some View {
        content
            .frame(height: 1)
            .background(theme.palette.divider)
    }
}

extension View {
    func businessTheme() -> some View {
        modifier(BusinessThemeAdapter())
    }

    func businessCanvas() -> some View {
        modifier(BusinessCanvasModifier())
    }

    func businessText(_ role: BusinessTextRole, size: CGFloat, weight: BusinessTextWeight = .regular) -> some View {
        modifier(BusinessTextModifier(role: role, size: size, weight: weight))
    }

    func businessAction(_ state: BusinessActionState) -> some View {
        modifier(BusinessActionModifier(state: state))
    }

    func businessStatus(_ tone: BusinessStatusTone) -> some View {
        modifier(BusinessStatusModifier(tone: tone))
    }

    func businessSurface(_ role: BusinessSurfaceRole) -> some View {
        modifier(BusinessSurfaceModifier(role: role))
    }

    func businessDivider() -> some View {
        modifier(BusinessDividerModifier())
    }
}
