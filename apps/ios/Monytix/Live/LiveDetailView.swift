import SwiftUI

enum LivePage: Equatable {
    case home
    case forYou
    case pulse
    case cashFlow
    case transactions
    case moly
}

private let liveWeights = [
    "Obligations", "Opportunity", "Resilience", "Comfort", "Risk",
    "Time", "Relationships", "Identity", "Attention", "Legacy",
]

private let liveQuestions = [
    "Why did my Obligations increase?",
    "Why is this considered flexible?",
    "What changed since my last visit?",
    "Which transactions affected my Comfort Weight?",
    "What should I understand about my Emergency Buffer?",
]

private let liveFilters = ["All", "Spending", "Income", "Transfers"]

struct LiveDetailView: View {
    var page: LivePage
    var api: MonytixApi
    var token: (Bool) async -> String?
    var onBack: () -> Void
    var onAskMoly: () -> Void
    @Environment(\.colorScheme) private var colorScheme
    @State private var snapshot = LiveSnapshot.unavailable
    @State private var filter = liveFilters[0]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: PersonalSpace.s20) {
                backBar
                switch page {
                case .forYou:
                    forYou
                case .pulse:
                    pulse
                case .cashFlow:
                    cash
                case .transactions:
                    transactions
                default:
                    moly
                }
            }
            .padding(.horizontal, PersonalSpace.s20)
            .padding(.top, PersonalSpace.s16)
            .padding(.bottom, PersonalSpace.s32)
        }
        .personalCanvas()
        .task {
            guard let data = await api.getJSON(path: "/v1/ui/live", token: token) else {
                snapshot = .unavailable
                return
            }
            snapshot = LiveSnapshot.parse(data)
        }
    }

    private var copy: (String, String) {
        switch page {
        case .forYou: ("For you", "What changed")
        case .pulse: ("Financial Pulse", "Where you stand")
        case .cashFlow: ("Cash flow", "What’s ahead")
        case .transactions: ("Transactions", "Recorded activity")
        default: ("Moly", "Ask about your money")
        }
    }

    private var backBar: some View {
        HStack(spacing: PersonalSpace.s12) {
            Button(action: onBack) {
                Image(systemName: "chevron.left")
                    .foregroundStyle(palette.textPrimary)
                    .frame(width: 40, height: 40)
                    .background(palette.surface, in: Circle())
                    .overlay(Circle().stroke(palette.border, lineWidth: 1))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Back")
            VStack(alignment: .leading, spacing: 2) {
                Text(copy.0).personalText(.primary, size: 22, weight: .bold)
                Text(copy.1).personalText(.secondary, size: 15)
            }
        }
    }

    @ViewBuilder
    private var forYou: some View {
        summary("This period", "Unavailable")
        ForEach(0..<2, id: \.self) { _ in
            card {
                HStack {
                    Text("Unavailable").personalText(.primary, size: 16, weight: .bold)
                    Spacer()
                    pill("Unavailable")
                }
                Text("Unavailable").personalText(.secondary, size: 15)
                detailButton("Unavailable") {}
            }
        }
        card {
            Text("Holding steady").personalText(.primary, size: 16, weight: .bold)
            Text("Unavailable").personalText(.secondary, size: 15)
            Text("Unavailable").personalText(.secondary, size: 15)
        }
    }

    @ViewBuilder
    private var pulse: some View {
        gradientCard([palette.widgetWeight, palette.surface], palette.widgetWeightBorder) {
            HStack(spacing: PersonalSpace.s16) {
                FigIcon(name: "FigActivity", size: 36)
                    .frame(width: 56, height: 56)
                    .background(palette.surface, in: Circle())
                    .overlay(Circle().stroke(palette.border, lineWidth: 1))
                VStack(alignment: .leading, spacing: 4) {
                    Text("Unavailable").personalText(.primary, size: 16, weight: .bold)
                    Text("Unavailable").personalText(.secondary, size: 15)
                }
            }
            HStack(spacing: PersonalSpace.s8) {
                pill("Unavailable")
                pill("Unavailable")
                pill("Unavailable")
            }
        }
        Text("The 10 weights").personalText(.primary, size: 16, weight: .bold)
        ForEach(Array(stride(from: 0, to: liveWeights.count, by: 2)), id: \.self) { index in
            HStack(alignment: .top, spacing: PersonalSpace.s12) {
                weight(liveWeights[index])
                weight(liveWeights[index + 1])
            }
        }
        card {
            Text("About these weights").personalText(.primary, size: 16, weight: .bold)
            Text("Unavailable").personalText(.secondary, size: 15)
        }
        detailButton("Ask Moly", action: onAskMoly)
    }

    @ViewBuilder
    private var cash: some View {
        gradientCard([palette.widgetCashStart, palette.widgetCashEnd], palette.widgetCashBorder) {
            Text("Unavailable").personalText(.primary, size: 16, weight: .bold)
            Text("flexible").personalText(.secondary, size: 15)
            Capsule().fill(palette.progressTrack).frame(height: 8)
            HStack {
                Text("Available  Unavailable").personalText(.secondary, size: 13)
                Spacer()
                Text("Committed  Unavailable").personalText(.secondary, size: 13)
            }
            if let availableBalance = snapshot.availableBalance {
                Text("Available balance  \(availableBalance)").personalText(.secondary, size: 13)
            }
            if snapshot.recordedFlowAvailable {
                ForEach(snapshot.currencies, id: \.currency) { row in
                    Text("Recorded inflow  \(row.inflow) \(row.currency)").personalText(.secondary, size: 13)
                    Text("Recorded outflow  \(row.outflow) \(row.currency)").personalText(.secondary, size: 13)
                }
            }
        }
        Text("What’s coming").personalText(.primary, size: 16, weight: .bold)
        let cashIcons = ["FigCashWallet", "FigCashLandmark", "FigCashReceipt", "FigCashArrow", "FigCashFlag"]
        ForEach(Array(cashIcons.enumerated()), id: \.offset) { _, icon in
            card {
                HStack(spacing: PersonalSpace.s12) {
                    FigIcon(name: icon, size: 28)
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Unavailable").personalText(.primary, size: 15, weight: .bold)
                        Text("Unavailable").personalText(.secondary, size: 14)
                    }
                }
            }
        }
        card {
            HStack(spacing: PersonalSpace.s12) {
                FigIcon(name: "FigCashCheck", size: 24)
                Text("Unavailable").personalText(.primary, size: 16, weight: .bold)
            }
            Text("Unavailable").personalText(.secondary, size: 15)
        }
        detailButton("Ask Moly", action: onAskMoly)
    }

    @ViewBuilder
    private var transactions: some View {
        let summaryText: String = {
            if !snapshot.transactionsKnown { return "Unavailable" }
            return snapshot.hasRecordedTransactions ? "Recorded" : "No recorded transactions"
        }()
        summary("Recorded activity", summaryText)
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: PersonalSpace.s8) {
                ForEach(liveFilters, id: \.self) { name in
                    let on = name == filter
                    Button {
                        filter = name
                    } label: {
                        Text(name)
                            .font(.custom("Inter-SemiBold", size: 14))
                            .foregroundStyle(on ? PersonalTokens.action.label : palette.textSecondary)
                            .padding(.horizontal, PersonalSpace.s16)
                            .padding(.vertical, PersonalSpace.s12)
                            .background(on ? PersonalTokens.action.default : palette.surface, in: Capsule())
                            .overlay(Capsule().stroke(on ? PersonalTokens.action.default : palette.border, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        let shown: [RecordedPreview] = {
            switch filter {
            case "Income": return snapshot.previews.filter { $0.direction == "IN" }
            case "Spending": return snapshot.previews.filter { $0.direction == "OUT" }
            case "Transfers": return []
            default: return snapshot.previews
            }
        }()
        if snapshot.previewsKnown, !shown.isEmpty {
            ForEach(shown) { row in
                let money = (row.amount?.isEmpty == false && row.currency?.isEmpty == false) ? "\(row.currency ?? "") \(row.amount ?? "")" : "Unavailable"
                card {
                    HStack(spacing: PersonalSpace.s12) {
                        FigIcon(name: row.direction == "IN" ? "FigCashArrow" : (row.direction == "OUT" ? "FigUtensils" : "FigTxUser"), size: 28)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(row.description ?? "Unavailable").personalText(.primary, size: 16, weight: .bold)
                            Text(money).personalText(.secondary, size: 15)
                            Text(row.transactionDate ?? "Unavailable").personalText(.secondary, size: 13)
                        }
                    }
                }
            }
        } else {
            card {
                Text("Unavailable").personalText(.primary, size: 16, weight: .bold)
                Text("Unavailable").personalText(.secondary, size: 15)
            }
        }
    }

    @ViewBuilder
    private var moly: some View {
        summary("Right now", "Unavailable")
        Text("You could ask").personalText(.primary, size: 16, weight: .bold)
        ForEach(liveQuestions, id: \.self) { question in
            card {
                Text(question).personalText(.primary, size: 15)
            }
        }
        Text("Ask Moly")
            .personalText(.secondary, size: 15)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(PersonalSpace.s16)
            .background(palette.surface, in: RoundedRectangle(cornerRadius: PersonalRadius.action, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: PersonalRadius.action, style: .continuous)
                    .stroke(palette.border, lineWidth: 1)
            )
    }

    private func summary(_ label: String, _ value: String) -> some View {
        card {
            Text(label).personalText(.secondary, size: 13)
            Text(value).personalText(.primary, size: 16, weight: .bold)
        }
    }

    private func weight(_ name: String) -> some View {
        card {
            Text(name).personalText(.primary, size: 14, weight: .bold)
            Text("Unavailable").personalText(.secondary, size: 13)
        }
    }

    private func detailButton(_ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(.custom("Inter-Bold", size: 15))
                .foregroundStyle(PersonalTokens.action.label)
                .frame(maxWidth: .infinity, minHeight: 48)
                .background(PersonalTokens.action.default, in: RoundedRectangle(cornerRadius: PersonalRadius.action, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private func pill(_ label: String) -> some View {
        Text(label)
            .font(.custom("Inter-Bold", size: 12))
            .foregroundStyle(colorScheme == .dark ? palette.popoverBorder : palette.textPrimary)
            .padding(.horizontal, PersonalSpace.s12)
            .padding(.vertical, PersonalSpace.s8)
            .background(colorScheme == .dark ? palette.surfaceRaised : PersonalTokens.status.lavender, in: Capsule())
    }

    private func card<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: PersonalSpace.s12, content: content)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(PersonalSpace.s16)
            .background(palette.surface, in: RoundedRectangle(cornerRadius: PersonalRadius.card, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: PersonalRadius.card, style: .continuous)
                    .stroke(palette.border, lineWidth: 1)
            )
    }

    private func gradientCard<Content: View>(_ colors: [Color], _ border: Color, @ViewBuilder content: () -> Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: PersonalRadius.card, style: .continuous)
        return VStack(alignment: .leading, spacing: PersonalSpace.s12, content: content)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(PersonalSpace.s16)
            .background(LinearGradient(colors: colors, startPoint: .top, endPoint: .bottom), in: shape)
            .overlay(shape.stroke(border, lineWidth: 1))
    }

    private var palette: PersonalPalette { colorScheme == .dark ? PersonalTokens.dark : PersonalTokens.light }
}
