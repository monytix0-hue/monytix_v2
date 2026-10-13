import SwiftUI

struct ThemeKitView: View {
    @Environment(\.personalTheme) private var theme

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: PersonalSpace.s32) {
                header
                section(
                    title: "01 / Everyday widgets",
                    body: "One pattern per role. Reuse the card surface, hierarchy and action slot across the app."
                ) {
                    goalCard
                    decisionCard
                    changeCard
                    cashCard
                    weightCard
                    impactCard
                }
                section(
                    title: "02 / Status with a little lift",
                    body: "Gold, mint, coral, and lavender name a meaning. They are not decoration."
                ) {
                    FlowRow(horizontalSpacing: PersonalSpace.s8, verticalSpacing: PersonalSpace.s8) {
                        statusPill("Gold", .gold)
                        statusPill("Mint", .mint)
                        statusPill("Coral", .coral)
                        statusPill("Lavender", .lavender)
                    }
                }
                section(
                    title: "03 / One action. Four appearances.",
                    body: "Gold is the primary next step. Keep the copy, dimensions and corner shape unchanged across states."
                ) {
                    actionButton("See the transactions  →", .default)
                    actionButton("See the transactions  →", .hover)
                    actionButton("See the transactions  →", .pressed)
                    actionButton("See the transactions  →", .disabled)
                }
                section(
                    title: "04 / Context first. Details when needed.",
                    body: "Use a popover for a short explanation. Use a sheet when the action needs more context."
                ) {
                    popoverExample
                    sheetExample
                }
                brandAssets
            }
            .padding(PersonalSpace.s20)
        }
        .personalCanvas()
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: PersonalSpace.s12) {
            HStack {
                Text(theme.isDark ? "MONYTIX / DARK" : "MONYTIX / LIGHT")
                    .personalText(.accent, size: PersonalTypeScale.bodyLarge, weight: .extraBold)
                Spacer()
                Text(theme.isDark ? "DARK MODE" : "LIGHT MODE")
                    .personalText(.secondary, size: PersonalTypeScale.footnote)
            }
            Text("Familiar everywhere. Clear at every step.")
                .personalText(.primary, size: PersonalTypeScale.hero, weight: .extraBold)
            Text("Reusable patterns for your money, right now. Soft role colors, elevated status pills and a warm gold action hierarchy.")
                .personalText(.secondary, size: PersonalTypeScale.bodyLarge)
        }
    }

    private var goalCard: some View {
        VStack(alignment: .leading, spacing: PersonalSpace.s16) {
            HStack {
                eyebrow("MISSIONS")
                Spacer()
                statusPill("2 ACTIVE", .lavender)
            }
            ZStack {
                Circle()
                    .stroke(theme.palette.border, lineWidth: 10)
                Circle()
                    .trim(from: 0, to: 0.37)
                    .stroke(theme.palette.accent, style: StrokeStyle(lineWidth: 10, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                Text("37%")
                    .personalText(.primary, size: PersonalTypeScale.hero, weight: .extraBold)
            }
            .frame(width: 140, height: 140)
            .frame(maxWidth: .infinity)
            Text("Home Fund")
                .personalText(.primary, size: PersonalTypeScale.title, weight: .bold)
            Text("₹1.84L / ₹5L")
                .personalText(.primary, size: PersonalTypeScale.bodyLarge, weight: .bold)
            Text("₹12K this month")
                .personalText(.secondary, size: PersonalTypeScale.footnote)
            actionButton("View Missions  →", .default)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .personalSurface(.goal)
    }

    private var decisionCard: some View {
        VStack(alignment: .leading, spacing: PersonalSpace.s16) {
            HStack {
                eyebrow("DECISIONS")
                Spacer()
                statusPill("2 NEED YOU", .coral)
            }
            Text("Strengthen your emergency cushion")
                .personalText(.primary, size: PersonalTypeScale.headline, weight: .bold)
            Text("Your buffer has reduced.")
                .personalText(.secondary, size: PersonalTypeScale.body)
            actionButton("View Decisions  →", .default)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .personalSurface(.decision)
    }

    private var changeCard: some View {
        VStack(alignment: .leading, spacing: PersonalSpace.s16) {
            eyebrow("FOR YOU")
            Text("Two things are worth a look")
                .personalText(.primary, size: PersonalTypeScale.headline, weight: .bold)
            Text("Spending pace increased this week")
                .personalText(.primary, size: PersonalTypeScale.bodyLarge, weight: .bold)
            Text("Lifestyle spending is ₹4,800 above your usual pace.")
                .personalText(.secondary, size: PersonalTypeScale.body)
            Color.clear.frame(height: 1).personalDivider()
            Text("Emergency Buffer is slightly behind")
                .personalText(.primary, size: PersonalTypeScale.bodyLarge, weight: .bold)
            Text("Progress is ₹6,200 below this month’s expected pace.")
                .personalText(.secondary, size: PersonalTypeScale.body)
            actionButton("See what changed  →", .default)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .personalSurface(.change)
    }

    private var cashCard: some View {
        VStack(alignment: .leading, spacing: PersonalSpace.s16) {
            HStack {
                eyebrow("CASH FLOW")
                Spacer()
                statusPill("14 DAYS", .mint)
            }
            HStack(alignment: .lastTextBaseline, spacing: PersonalSpace.s12) {
                Text("₹41,400")
                    .personalText(.primary, size: PersonalTypeScale.hero, weight: .extraBold)
                Text("flexible")
                    .personalText(.primary, size: PersonalTypeScale.bodyLarge, weight: .bold)
            }
            GeometryReader { proxy in
                HStack(spacing: 0) {
                    theme.palette.cashFlexible.frame(width: proxy.size.width * 0.7)
                    theme.palette.cashCommitted.frame(width: proxy.size.width * 0.3)
                }
            }
            .frame(height: PersonalSpace.s12)
            .clipShape(Capsule())
            HStack {
                Text("₹72,600 available")
                    .personalText(.primary, size: PersonalTypeScale.footnote, weight: .bold)
                Spacer()
                Text("₹31,200 committed")
                    .personalText(.primary, size: PersonalTypeScale.footnote, weight: .bold)
            }
            statusPill("COMFORTABLE", .mint)
            Text("Salary expected in 11 days")
                .personalText(.primary, size: PersonalTypeScale.body)
            actionButton("See what’s ahead  →", .default)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .personalSurface(.cash)
    }

    private var weightCard: some View {
        VStack(alignment: .leading, spacing: PersonalSpace.s16) {
            HStack {
                eyebrow("FINANCIAL WEIGHT")
                Spacer()
                statusPill("Resilience ↓", .lavender)
            }
            Text("Resilience ↓")
                .personalText(.primary, size: PersonalTypeScale.display, weight: .bold)
            Text("Your cushion reduced slightly")
                .personalText(.secondary, size: PersonalTypeScale.body)
            actionButton("Explore your 10 Weights  →", .default)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .personalSurface(.weight)
    }

    private var impactCard: some View {
        VStack(alignment: .leading, spacing: PersonalSpace.s16) {
            eyebrow("M.I.L.E.")
            Text("Money Impact & Life Evolution")
                .personalText(.secondary, size: PersonalTypeScale.footnote)
            Text("₹38,400")
                .personalText(.primary, size: PersonalTypeScale.amount, weight: .bold)
            Text("positive financial impact")
                .personalText(.secondary, size: PersonalTypeScale.bodySmall)
            FlowRow(horizontalSpacing: PersonalSpace.s8, verticalSpacing: PersonalSpace.s8) {
                statusPill("+₹6,200 this month", .gold)
                statusPill("Resilience ↑", .mint)
            }
            actionButton("See your M.I.L.E.  →", .default)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .personalSurface(.impact)
    }

    private var popoverExample: some View {
        VStack(alignment: .leading, spacing: PersonalSpace.s8) {
            Text("Contextual popover")
                .personalText(.primary, size: PersonalTypeScale.body, weight: .bold)
            Text("Button context · Explain a change before opening details")
                .personalText(.secondary, size: PersonalTypeScale.footnote)
            VStack(alignment: .leading, spacing: PersonalSpace.s16) {
                actionButton("See what changed  →", .default)
                VStack(alignment: .leading, spacing: PersonalSpace.s12) {
                    HStack {
                        statusPill("Comfort ↑", .gold)
                        Spacer()
                        closeButton
                    }
                    Text("Spending pace increased")
                        .personalText(.primary, size: PersonalTypeScale.display, weight: .bold)
                    Text("Lifestyle spending is ₹4,800 above your usual weekly pace.")
                        .personalText(.secondary, size: PersonalTypeScale.body)
                    actionButton("See the transactions  →", .default)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .personalSurface(.popover)
            }
            .personalSurface(.anchor)
        }
    }

    private var sheetExample: some View {
        VStack(alignment: .leading, spacing: PersonalSpace.s8) {
            Text("Action-detail bottom sheet")
                .personalText(.primary, size: PersonalTypeScale.body, weight: .bold)
            Text("Mission context · Review before opening a financial action")
                .personalText(.secondary, size: PersonalTypeScale.footnote)
            VStack(alignment: .leading, spacing: PersonalSpace.s16) {
                Capsule()
                    .fill(theme.palette.dragHandle)
                    .frame(width: 40, height: PersonalSpace.s4)
                    .frame(maxWidth: .infinity)
                    .padding(.top, PersonalSpace.s4)
                HStack {
                    statusPill("Resilience ↓", .lavender)
                    Spacer()
                    closeButton
                }
                Text("Emergency Buffer is behind")
                    .personalText(.primary, size: PersonalTypeScale.display, weight: .bold)
                Text("You are ₹6,200 below this month’s expected Mission pace.")
                    .personalText(.secondary, size: PersonalTypeScale.body)
                VStack(alignment: .leading, spacing: PersonalSpace.s12) {
                    Text("Emergency Buffer")
                        .personalText(.primary, size: PersonalTypeScale.bodyLarge, weight: .bold)
                    HStack {
                        Text("₹82K / ₹1.5L")
                            .personalText(.primary, size: PersonalTypeScale.title, weight: .bold)
                        Spacer()
                        Text("55%")
                            .personalText(.primary, size: PersonalTypeScale.title, weight: .extraBold)
                    }
                    GeometryReader { proxy in
                        ZStack(alignment: .leading) {
                            theme.palette.progressTrack
                            theme.palette.progressFill.frame(width: proxy.size.width * 0.55)
                        }
                    }
                    .frame(height: PersonalSpace.s8)
                    .clipShape(Capsule())
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .personalSurface(.mission)
                actionButton("Open Emergency Buffer  →", .default)
                Text("Dismiss")
                    .personalText(.primary, size: PersonalTypeScale.bodySmall, weight: .bold)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .personalSurface(.dismiss)
            }
            .padding(.horizontal, PersonalSpace.s24)
            .padding(.top, PersonalSpace.s12)
            .padding(.bottom, PersonalSpace.s24)
            .frame(maxWidth: .infinity, alignment: .leading)
            .personalSurface(.sheet)
            .padding(.top, PersonalSpace.s32)
            .personalSurface(.backdrop)
        }
    }

    private var brandAssets: some View {
        VStack(alignment: .leading, spacing: PersonalSpace.s16) {
            Color.clear.frame(height: 1).personalDivider()
            Text("Logo and icon")
                .personalText(.primary, size: PersonalTypeScale.headline, weight: .extraBold)
            Image("MonytixLogo")
                .resizable()
                .scaledToFit()
                .frame(width: 220, height: 48, alignment: .leading)
                .accessibilityLabel("Monytix logo")
            Image("MonytixMark")
                .resizable()
                .scaledToFit()
                .frame(width: 72, height: 72)
                .accessibilityLabel("Monytix icon")
        }
    }

    private func section<Content: View>(title: String, body: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: PersonalSpace.s16) {
            Color.clear.frame(height: 1).personalDivider()
            Text(title)
                .personalText(.primary, size: PersonalTypeScale.headline, weight: .extraBold)
            Text(body)
                .personalText(.secondary, size: PersonalTypeScale.bodySmall)
            content()
        }
    }

    private func actionButton(_ label: String, _ state: PersonalActionState) -> some View {
        Text(label)
            .personalAction(state)
    }

    private func statusPill(_ label: String, _ tone: PersonalStatusTone) -> some View {
        Text(label)
            .personalStatus(tone)
    }

    private func eyebrow(_ text: String) -> some View {
        Text(text)
            .personalText(.primary, size: PersonalTypeScale.caption, weight: .extraBold)
    }

    private var closeButton: some View {
        Text("×")
            .personalText(.primary, size: PersonalTypeScale.titleSmall, weight: .bold)
            .frame(width: 36, height: 36)
            .background(theme.palette.closeFill, in: Circle())
            .overlay(Circle().stroke(theme.palette.border, lineWidth: 1))
    }
}
