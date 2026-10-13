import SwiftUI

struct BusinessKitView: View {
    @Environment(\.businessTheme) private var theme
    var onSignOut: (() -> Void)? = nil

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: BusinessSpace.s28) {
                header
                section("Widgets / Operational business overview")
                attentionCard
                pulseCard
                cashCard
                decisionsCard
                missionsCard
                impactCard
                Color.clear.frame(height: 1).businessDivider()
                section("Pills / Semantic roles")
                statusExamples
                section("Buttons / Static appearance states")
                action("View Decisions  →", .default)
                action("View Decisions  →", .hover)
                action("View Decisions  →", .pressed)
                action("View Decisions  →", .disabled)
            }
            .padding(BusinessSpace.s20)
        }
        .businessCanvas()
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: BusinessSpace.s12) {
            HStack {
                Text("Monytix / Business")
                    .businessText(.primary, size: BusinessTypeScale.titleSmall, weight: .extraBold)
                Spacer()
                VStack(alignment: .trailing, spacing: BusinessSpace.s4) {
                    Text(theme.isDark ? "DARK" : "LIGHT")
                        .businessText(.secondary, size: BusinessTypeScale.bodySmall, weight: .semiBold)
                    if onSignOut != nil {
                        Button("Sign out", action: { onSignOut?() })
                            .businessText(.accent, size: BusinessTypeScale.bodySmall, weight: .semiBold)
                    }
                }
            }
            Text("Business widgets & controls")
                .businessText(.primary, size: BusinessTypeScale.hero, weight: .extraBold)
            Text("Six complete widgets. Editable text. Matching semantic roles across themes.")
                .businessText(.secondary, size: BusinessTypeScale.bodyLarge)
        }
    }

    private var attentionCard: some View {
        VStack(alignment: .leading, spacing: BusinessSpace.s16) {
            HStack {
                eyebrow("FOR YOU")
                Spacer()
                pill("2 CHANGES", .neutral)
            }
            Text("Two business shifts are worth a look")
                .businessText(.primary, size: BusinessTypeScale.headline, weight: .bold)
            signal("BusinessTrending", "Operating costs increased this week", "Operating spend is ₹48,000 above its recent pace.")
            Color.clear.frame(height: 1).businessDivider()
            signal("BusinessShieldAlert", "Reserve coverage is below target", "Current coverage is 53 days against a 90-day target.")
            action("See what changed  →", .default)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .businessSurface(.surface)
    }

    private var pulseCard: some View {
        VStack(alignment: .leading, spacing: BusinessSpace.s16) {
            HStack {
                eyebrow("BUSINESS PULSE")
                Spacer()
                pill("UPDATED TODAY", .neutral)
            }
            HStack(spacing: BusinessSpace.s16) {
                symbol("BusinessPulse", 60)
                Text("Stable")
                    .businessText(.primary, size: BusinessTypeScale.status, weight: .extraBold)
            }
            Text("Cash stability is holding, while obligations and customer dependency need attention.")
                .businessText(.secondary, size: BusinessTypeScale.bodyLarge)
            FlowRow(horizontalSpacing: BusinessSpace.s8, verticalSpacing: BusinessSpace.s8) {
                pill("2 improving", .positive)
                pill("4 stable", .neutral)
                pill("2 watch", .attention)
            }
            Color.clear.frame(height: 1).businessDivider()
            dimension("BusinessDimension1", "Obligation Pressure ↑", "Supplier and payroll commitments increased", theme.palette.attentionLabel)
            dimension("BusinessDimension2", "Protection Adequacy ↑", "Reserve coverage improved", theme.palette.positiveLabel)
            dimension("BusinessDimension3", "Dependency Pressure ↑", "Top customer concentration remains high", theme.palette.neutralLabel)
            action("Explore Business Pulse  →", .default)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .businessSurface(.surface)
    }

    private var cashCard: some View {
        VStack(alignment: .leading, spacing: BusinessSpace.s16) {
            HStack {
                eyebrow("CASH FLOW")
                Spacer()
                pill("14 DAYS", .positive)
            }
            HStack(alignment: .lastTextBaseline, spacing: BusinessSpace.s12) {
                Text("₹1,50,000")
                    .businessText(.primary, size: BusinessTypeScale.hero, weight: .extraBold)
                Text("net positive")
                    .businessText(.primary, size: BusinessTypeScale.body, weight: .semiBold)
            }
            HStack {
                Text("₹8.40L inflow")
                    .businessText(.primary, size: BusinessTypeScale.bodySmall, weight: .semiBold)
                Spacer()
                Text("₹6.90L outflow")
                    .businessText(.primary, size: BusinessTypeScale.bodySmall, weight: .semiBold)
            }
            pill("COMFORTABLE", .positive)
            Text("Major receivable expected in 8 days")
                .businessText(.primary, size: BusinessTypeScale.body)
            action("See what’s ahead  →", .default)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .businessSurface(.raised)
    }

    private var decisionsCard: some View {
        VStack(alignment: .leading, spacing: BusinessSpace.s16) {
            HStack {
                eyebrow("DECISIONS")
                Spacer()
                pill("2 NEED YOU", .attention)
            }
            HStack(alignment: .top, spacing: BusinessSpace.s16) {
                decisionPreview("BusinessShieldPlus", "Increase reserve coverage", "Reserve coverage is below the 90-day target.", .surface)
                decisionPreview("BusinessShieldPlusAlt", "Review customer concentration", "Top customer contributes 42% of recent receipts.", .alt)
            }
            action("View Decisions  →", .default)
        }
    }

    private var missionsCard: some View {
        VStack(alignment: .leading, spacing: BusinessSpace.s16) {
            HStack {
                eyebrow("MISSIONS")
                Spacer()
                pill("2 ACTIVE", .goal)
            }
            ZStack {
                symbol("BusinessRing", 176)
                symbol("BusinessRingTrack", 158)
                symbol("BusinessRingProgress", 158)
                VStack(spacing: BusinessSpace.s4) {
                    symbol("BusinessTarget", 20)
                    Text("59%")
                        .businessText(.primary, size: BusinessTypeScale.progress, weight: .extraBold)
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 176)
            VStack(alignment: .leading, spacing: BusinessSpace.s8) {
                Text("Strengthen Financial Protection")
                    .businessText(.primary, size: BusinessTypeScale.titleSmall, weight: .bold)
                Text("53 / 90 days · 59% · On track")
                    .businessText(.positive, size: BusinessTypeScale.bodySmall)
                Color.clear.frame(height: 1).businessDivider()
                Text("Reduce Business Dependency")
                    .businessText(.primary, size: BusinessTypeScale.titleSmall, weight: .bold)
                Text("Customer concentration · 42% → target ≤35%")
                    .businessText(.secondary, size: BusinessTypeScale.bodySmall)
                GeometryReader { proxy in
                    ZStack(alignment: .leading) {
                        Capsule().fill(theme.palette.divider)
                        Capsule().fill(theme.palette.attentionLabel).frame(width: proxy.size.width * 0.42)
                        RoundedRectangle(cornerRadius: 1)
                            .fill(theme.palette.accent)
                            .frame(width: 3, height: 18)
                            .offset(x: proxy.size.width * 0.35)
                    }
                }
                .frame(height: BusinessSpace.s18)
            }
            .padding(BusinessSpace.s12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(theme.palette.surface, in: RoundedRectangle(cornerRadius: BusinessRadius.inset, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: BusinessRadius.inset, style: .continuous).stroke(theme.palette.border, lineWidth: 1))
            action("View Missions  →", .default)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .businessSurface(.raised)
    }

    private var impactCard: some View {
        VStack(alignment: .leading, spacing: BusinessSpace.s16) {
            eyebrow("M.I.L.E.")
            Text("Money Impact & Business Evolution")
                .businessText(.secondary, size: BusinessTypeScale.bodySmall)
            HStack(spacing: BusinessSpace.s16) {
                symbol("BusinessSprout", 30)
                    .frame(width: 72, height: 72)
                    .businessSurface(.impactSymbol)
                VStack(alignment: .leading, spacing: BusinessSpace.s6) {
                    Text("₹84,000")
                        .businessText(.primary, size: BusinessTypeScale.hero, weight: .extraBold)
                    Text("verified business financial impact")
                        .businessText(.secondary, size: BusinessTypeScale.bodySmall)
                }
            }
            FlowRow(horizontalSpacing: BusinessSpace.s8, verticalSpacing: BusinessSpace.s8) {
                pill("+₹18,000 this month", .positive)
                pill("Protection ↑", .positive)
            }
            action("See Business M.I.L.E.  →", .default)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .businessSurface(.raised)
    }

    private var statusExamples: some View {
        VStack(alignment: .leading, spacing: BusinessSpace.s12) {
            pillExample("Neutral", "4 stable", .neutral, "Stable / neutral count")
            pillExample("Positive", "2 improving", .positive, "Improving / positive direction")
            pillExample("Attention", "2 watch", .attention, "Watch / attention required")
            pillExample("Goal", "2 ACTIVE", .goal, "Active / info, not goal reached")
        }
    }

    private func section(_ title: String) -> some View {
        Text(title)
            .businessText(.primary, size: BusinessTypeScale.title, weight: .bold)
    }

    private func eyebrow(_ text: String) -> some View {
        Text(text)
            .businessText(.primary, size: BusinessTypeScale.caption, weight: .extraBold)
    }

    private func action(_ label: String, _ state: BusinessActionState) -> some View {
        Text(label)
            .businessAction(state)
    }

    private func pill(_ label: String, _ tone: BusinessStatusTone) -> some View {
        Text(label)
            .businessStatus(tone)
    }

    private func pillExample(_ title: String, _ label: String, _ tone: BusinessStatusTone, _ note: String) -> some View {
        VStack(alignment: .leading, spacing: BusinessSpace.s6) {
            Text(title)
                .businessText(.primary, size: BusinessTypeScale.bodySmall, weight: .bold)
            pill(label, tone)
            Text(note)
                .businessText(.secondary, size: BusinessTypeScale.footnote)
        }
    }

    private func signal(_ image: String, _ title: String, _ body: String) -> some View {
        HStack(alignment: .top, spacing: BusinessSpace.s14) {
            symbol(image, 28)
                .frame(width: 44, height: 44)
                .businessSurface(.attentionSymbol)
            VStack(alignment: .leading, spacing: BusinessSpace.s6) {
                Text(title)
                    .businessText(.primary, size: BusinessTypeScale.bodyLarge, weight: .bold)
                Text(body)
                    .businessText(.secondary, size: BusinessTypeScale.bodySmall)
            }
        }
    }

    private func dimension(_ image: String, _ title: String, _ body: String, _ mark: Color) -> some View {
        HStack(spacing: BusinessSpace.s12) {
            symbol(image, 40)
            VStack(alignment: .leading, spacing: BusinessSpace.s4) {
                Text(title)
                    .businessText(.primary, size: BusinessTypeScale.bodyLarge, weight: .bold)
                Text(body)
                    .businessText(.secondary, size: BusinessTypeScale.footnote)
            }
            Spacer()
            Text("›")
                .font(.custom("Inter-Regular", size: BusinessTypeScale.display))
                .foregroundStyle(mark)
        }
    }

    private func decisionPreview(_ image: String, _ title: String, _ body: String, _ role: BusinessSurfaceRole) -> some View {
        VStack(alignment: .leading, spacing: BusinessSpace.s14) {
            symbol(image, 24)
                .frame(width: 44, height: 44)
                .businessSurface(.attentionSymbol)
            Text(title)
                .businessText(.primary, size: BusinessTypeScale.title, weight: .bold)
            Text(body)
                .businessText(.secondary, size: BusinessTypeScale.bodySmall)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .businessSurface(role)
    }

    private func symbol(_ name: String, _ size: CGFloat) -> some View {
        Image(name)
            .resizable()
            .scaledToFit()
            .frame(width: size, height: size)
    }
}
