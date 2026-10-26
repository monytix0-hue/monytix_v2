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

struct LiveDetailView: View {
    var page: LivePage
    var store: UiSessionStore
    var api: MonytixApi
    var token: (Bool) async -> String?
    var onBack: () -> Void
    var onAskMoly: () -> Void
    @Environment(\.colorScheme) private var colorScheme

    private var snapshot: LiveSnapshot {
        guard let data = store.liveData else { return .unavailable }
        return LiveSnapshot.parse(data)
    }

    var body: some View {
        Group {
            if page == .transactions {
                TransactionLedger(api: api, token: token, onBack: onBack)
            } else {
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
                            EmptyView()
                        default:
                            moly
                        }
                    }
                    .padding(.horizontal, PersonalSpace.s20)
                    .padding(.top, PersonalSpace.s16)
                    .padding(.bottom, PersonalSpace.s32)
                }
            }
        }
        .personalCanvas()
        .task {
            await store.refreshLive()
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
        if snapshot.previews.isEmpty {
            Text("Nothing has been recorded yet.").personalText(.secondary, size: 15)
        } else {
            ForEach(snapshot.previews) { row in
                card {
                    Text(row.description ?? "Recorded movement").personalText(.primary, size: 16, weight: .bold)
                    Text(movementLine(row)).personalText(.secondary, size: 15)
                    if let account = row.accountName, !account.isEmpty {
                        Text(account).personalText(.secondary, size: 13)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var pulse: some View {
        Text("The 10 weights").personalText(.primary, size: 16, weight: .bold)
        ForEach(Array(stride(from: 0, to: liveWeights.count, by: 2)), id: \.self) { index in
            HStack(alignment: .top, spacing: PersonalSpace.s12) {
                weight(liveWeights[index])
                weight(liveWeights[index + 1])
            }
        }
        detailButton("Ask Moly", action: onAskMoly)
    }

    @ViewBuilder
    private var cash: some View {
        gradientCard([palette.widgetCashStart, palette.widgetCashEnd], palette.widgetCashBorder) {
            if let row = snapshot.currencies.first, snapshot.recordedFlowAvailable {
                Text("\(row.currency) in \(row.inflow) · out \(row.outflow)").personalText(.primary, size: 16, weight: .bold)
                Text("Recorded inflow \(row.currency) \(row.inflow)").personalText(.secondary, size: 13)
                Text("Recorded outflow \(row.currency) \(row.outflow)").personalText(.secondary, size: 13)
            } else if snapshot.availableBalance == nil {
                Text("Nothing has been recorded this month.").personalText(.secondary, size: 15)
            }
            if let availableBalance = snapshot.availableBalance {
                Text("Available balance  \(availableBalance)").personalText(.secondary, size: 13)
            }
        }
        Text("Recorded").personalText(.primary, size: 16, weight: .bold)
        if snapshot.previews.isEmpty {
            Text("Nothing has been recorded yet.").personalText(.secondary, size: 15)
        } else {
            ForEach(snapshot.previews) { row in
                card {
                    Text(row.description ?? "Recorded movement").personalText(.primary, size: 15, weight: .bold)
                    Text(movementLine(row)).personalText(.secondary, size: 14)
                }
            }
        }
        Text("Nothing further is scheduled.").personalText(.secondary, size: 15)
        detailButton("Ask Moly", action: onAskMoly)
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

    private func movementLine(_ row: RecordedPreview) -> String {
        let money = (row.amount?.isEmpty == false && row.currency?.isEmpty == false)
            ? "\(row.currency ?? "") \(row.amount ?? "")"
            : "Recorded"
        let weight = row.weightName?.isEmpty == false ? " · \(row.weightName ?? "")" : ""
        return "\(money) · \(row.transactionDate ?? "Recorded")\(weight)"
    }

    private func weight(_ name: String) -> some View {
        let amount = snapshot.weights.first { $0.name == name }?.amount
        card {
            Text(name).personalText(.primary, size: 14, weight: .bold)
            Text(amount ?? "No movements this month.").personalText(.secondary, size: 13)
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
