import SwiftUI

enum DecisionPage: Equatable {
    case home
    case weigh
    case confirm
    case solutions
}

private struct PublishedDecision: Identifiable {
    let id: String
    let title: String?
    let amount: String?
    let timing: String?
    let state: String?
}

private struct DecisionRead {
    var heaviest: PublishedDecision?
    var decisions: [PublishedDecision] = []

    static func parse(_ data: Data?) -> DecisionRead {
        guard let data, let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return DecisionRead()
        }
        let rows = (root["decisions"] as? [[String: Any]] ?? []).compactMap(publishedDecision)
        let heaviestObject = root["heaviest"] as? [String: Any]
        let heaviest = (heaviestObject?["available"] as? Bool) == true ? publishedDecision(heaviestObject ?? [:]) : nil
        return DecisionRead(heaviest: heaviest, decisions: rows)
    }
}

private struct ChoiceLine: Identifiable {
    let id: String
    let name: String?
    let amount: String?
}

private struct WeightLine: Identifiable {
    let id: String
    let name: String?
    let priority: String?
}

private struct SolutionLine: Identifiable {
    let id: String
    let title: String?
    let detail: String?
}

private struct DecisionWeights {
    var question: String?
    var choices: [ChoiceLine] = []
    var weights: [WeightLine] = []
    var solutions: [SolutionLine] = []

    static func parse(_ data: Data?) -> DecisionWeights {
        guard let data, let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return DecisionWeights()
        }
        let decision = root["decision"] as? [String: Any]
        return DecisionWeights(
            question: jsonText(decision, "question"),
            choices: (root["choices"] as? [[String: Any]] ?? []).enumerated().map { index, row in
                ChoiceLine(id: "choice-\(index)", name: jsonText(row, "name"), amount: jsonText(row, "amount"))
            },
            weights: (root["weights"] as? [[String: Any]] ?? []).enumerated().map { index, row in
                WeightLine(id: "weight-\(index)", name: jsonText(row, "name"), priority: jsonText(row, "priority"))
            },
            solutions: (root["solutions"] as? [[String: Any]] ?? []).enumerated().map { index, row in
                SolutionLine(id: "solution-\(index)", title: jsonText(row, "title"), detail: jsonText(row, "detail"))
            }
        )
    }
}

private let decisionFilters = [("Need you", "need_you"), ("Upcoming", "upcoming"), ("Made", "made")]
private let structuralWeights = ["Resilience", "Risk", "Comfort", "Opportunity"]
private let decisionNames = [
    "D01": "Emergency Fund Allocation",
    "D02": "Cash Buffer Top-Up",
    "D03": "Credit Card Payment",
    "D04": "Loan EMI Protection",
    "D05": "Insurance Renewal",
    "D06": "Insurance Coverage Gap",
    "D07": "Idle Cash Deployment",
    "D08": "Income Surplus Allocation",
    "D09": "Recurring Review",
    "D10": "Expense Spike Review",
    "D11": "Large Expense Warning",
    "D12": "Cash Crunch Forecast",
    "D13": "Savings Rate Lift",
    "D14": "Goal Contribution Catch-Up",
    "D15": "Salary Day Allocation",
    "D16": "Bonus Allocation",
    "D17": "Emergency Fund Milestone Push",
    "D18": "SIP Continuity",
    "D19": "Idle Cash to SIP",
    "D20": "Asset Drift Rebalance",
    "D21": "Retirement Funding Gap",
    "D22": "Goal-Linked Investing",
    "D23": "Dining Optimization",
    "D24": "Shopping Control",
    "D25": "Entertainment Cap",
    "D26": "Travel Spend Review",
    "D27": "Discretionary Squeeze",
    "D28": "Mission Acceleration",
    "D29": "Confidence Growth Opportunity",
    "D30": "Milestone Unlock",
]

private func publishedDecision(_ object: [String: Any]) -> PublishedDecision? {
    guard let id = object["id"] as? String, !id.isEmpty else { return nil }
    let type = object["type"] as? String
    let titled = jsonText(object, "title") ?? type.flatMap { decisionNames[$0] }
    return PublishedDecision(
        id: id,
        title: titled,
        amount: jsonText(object, "amount"),
        timing: jsonText(object, "timing"),
        state: jsonText(object, "state")
    )
}

private func jsonText(_ object: [String: Any]?, _ key: String) -> String? {
    guard let value = object?[key] as? String, !value.isEmpty else { return nil }
    return value
}

struct DecisionHomeView: View {
    var api: MonytixApi
    var token: (Bool) async -> String?
    var onOpen: (String) -> Void
    @Environment(\.colorScheme) private var colorScheme
    @State private var read = DecisionRead()
    @State private var filter = decisionFilters[0].1

    var body: some View {
        let listed = read.decisions.filter { $0.state == filter }
        ScrollView {
            VStack(alignment: .leading, spacing: PersonalSpace.s20) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Decisions").personalText(.primary, size: 22, weight: .bold)
                    Text("See the choices that deserve your attention.").personalText(.secondary, size: 15)
                }
                HStack(spacing: PersonalSpace.s8) {
                    ForEach(decisionFilters, id: \.1) { label, value in
                        filterChip(label, on: filter == value) { filter = value }
                    }
                }
                Button {
                    if let id = read.heaviest?.id { onOpen(id) }
                } label: {
                    decisionCard(read.heaviest)
                }
                .buttonStyle(.plain)
                .disabled(read.heaviest?.id == nil)
                Text("A decision is a choice — not a recommendation.").personalText(.secondary, size: 15)
                Text("Other choices ahead").personalText(.primary, size: 16, weight: .bold)
                if listed.isEmpty {
                    decisionCard(nil)
                } else {
                    ForEach(listed) { row in
                        Button { onOpen(row.id) } label: { decisionCard(row) }
                            .buttonStyle(.plain)
                    }
                }
            }
            .padding(.horizontal, PersonalSpace.s20)
            .padding(.top, PersonalSpace.s20)
            .padding(.bottom, 128)
        }
        .task {
            read = DecisionRead.parse(await api.getJSON(path: "/v1/ui/decisions", token: token))
        }
    }

    private func filterChip(_ label: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(.custom("Inter-SemiBold", size: 14))
                .foregroundStyle(on ? PersonalTokens.action.label : palette.textSecondary)
                .padding(.horizontal, PersonalSpace.s16)
                .padding(.vertical, PersonalSpace.s12)
                .background(on ? PersonalTokens.action.default : palette.surface, in: Capsule())
                .overlay(Capsule().stroke(on ? PersonalTokens.action.default : palette.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    private func decisionCard(_ row: PublishedDecision?) -> some View {
        card {
            Text(row?.title ?? "Unavailable").personalText(.primary, size: 16, weight: .bold)
            Text(row?.amount ?? "Unavailable").personalText(.secondary, size: 15)
            Text(row?.timing ?? "Unavailable").personalText(.secondary, size: 13)
        }
    }

    private func card<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: PersonalSpace.s8, content: content)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(PersonalSpace.s16)
            .background(palette.surface, in: RoundedRectangle(cornerRadius: PersonalRadius.card, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: PersonalRadius.card, style: .continuous).stroke(palette.border, lineWidth: 1))
    }

    private var palette: PersonalPalette { colorScheme == .dark ? PersonalTokens.dark : PersonalTokens.light }
}

struct DecisionFlowView: View {
    var page: DecisionPage
    var decisionId: String
    var api: MonytixApi
    var token: (Bool) async -> String?
    var onBack: () -> Void
    var onContinue: () -> Void
    var onConfirm: () -> Void
    var onSave: () -> Void
    @Environment(\.colorScheme) private var colorScheme
    @State private var weights = DecisionWeights()
    @State private var selected: Int?
    @State private var reason = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: PersonalSpace.s16) {
                HStack(spacing: PersonalSpace.s12) {
                    Button(action: onBack) {
                        Image(systemName: "chevron.left")
                            .foregroundStyle(palette.textPrimary)
                            .frame(width: 48, height: 48)
                            .background(palette.surface, in: Circle())
                            .overlay(Circle().stroke(palette.border, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Back")
                    Text(title).personalText(.primary, size: 22, weight: .bold)
                }
                switch page {
                case .weigh:
                    weighBody
                case .confirm:
                    confirmBody
                case .solutions:
                    solutionsBody
                case .home:
                    EmptyView()
                }
            }
            .padding(.horizontal, PersonalSpace.s20)
            .padding(.top, PersonalSpace.s16)
            .padding(.bottom, PersonalSpace.s32)
        }
        .personalCanvas()
        .task(id: decisionId) {
            weights = DecisionWeights.parse(await api.getJSON(path: "/v1/ui/decisions/\(decisionId)/weights", token: token))
            selected = nil
        }
    }

    private var title: String {
        switch page {
        case .weigh: "Weigh your options"
        case .confirm: "Mark your decision"
        default: "Next step"
        }
    }

    private var weighBody: some View {
        let choices = weights.choices.isEmpty ? [ChoiceLine(id: "choice-empty", name: nil, amount: nil)] : weights.choices
        let lines = weights.weights.isEmpty
            ? structuralWeights.map { WeightLine(id: $0, name: $0, priority: nil) }
            : weights.weights
        return VStack(alignment: .leading, spacing: PersonalSpace.s16) {
            Text(weights.question ?? "Unavailable").personalText(.primary, size: 16, weight: .bold)
            card {
                HStack {
                    Text("Flexibility").personalText(.secondary, size: 13)
                    Spacer()
                    Text("Safety").personalText(.secondary, size: 13)
                }
                Capsule().fill(palette.border).frame(height: 8)
                Text("Unavailable").personalText(.secondary, size: 15)
            }
            ForEach(Array(choices.enumerated()), id: \.element.id) { index, choice in
                let on = selected == index && !weights.choices.isEmpty
                Button {
                    if !weights.choices.isEmpty { selected = index }
                } label: {
                    card {
                        Text(choice.name ?? "Unavailable").personalText(.primary, size: 16, weight: .bold)
                        Text(choice.amount ?? "Unavailable").personalText(.secondary, size: 15)
                        Capsule().fill(palette.border).frame(height: 8)
                    }
                    .overlay(
                        RoundedRectangle(cornerRadius: PersonalRadius.card, style: .continuous)
                            .stroke(on ? PersonalTokens.action.default : palette.border, lineWidth: 1)
                    )
                }
                .buttonStyle(.plain)
                .disabled(weights.choices.isEmpty)
            }
            ForEach(lines) { line in
                card {
                    Text(line.name ?? "Unavailable").personalText(.primary, size: 16, weight: .bold)
                    Text(line.priority ?? "Unavailable").personalText(.secondary, size: 15)
                    Capsule().fill(palette.border).frame(height: 8)
                }
            }
            gold("Continue with selected choice", action: onContinue)
        }
    }

    private var confirmBody: some View {
        VStack(alignment: .leading, spacing: PersonalSpace.s16) {
            card {
                Text(selectedChoice ?? "Unavailable").personalText(.primary, size: 16, weight: .bold)
                Text("What mattered").personalText(.secondary, size: 13)
                Text("Unavailable").personalText(.secondary, size: 15)
                Text("Expected outcomes").personalText(.secondary, size: 13)
                Text("Unavailable").personalText(.secondary, size: 15)
            }
            Text("Optional reason").personalText(.secondary, size: 13)
            TextField("Unavailable", text: $reason, axis: .vertical)
                .font(.custom("Inter-Regular", size: 15))
                .foregroundStyle(palette.textPrimary)
                .padding(PersonalSpace.s16)
                .background(palette.surface, in: RoundedRectangle(cornerRadius: PersonalRadius.action, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: PersonalRadius.action, style: .continuous).stroke(palette.border, lineWidth: 1))
            gold("Confirm decision", action: onConfirm)
            gold("Save for later", action: onSave)
        }
    }

    private var solutionsBody: some View {
        let ways = weights.solutions.isEmpty
            ? (0..<3).map { SolutionLine(id: "solution-empty-\($0)", title: nil, detail: nil) }
            : weights.solutions
        return VStack(alignment: .leading, spacing: PersonalSpace.s16) {
            card {
                Text(weights.question ?? "Unavailable").personalText(.primary, size: 16, weight: .bold)
                Text("Unavailable").personalText(.secondary, size: 15)
            }
            Text("Ways to fulfill it").personalText(.primary, size: 16, weight: .bold)
            ForEach(ways) { way in
                card {
                    Text(way.title ?? "Unavailable").personalText(.primary, size: 16, weight: .bold)
                    Text(way.detail ?? "Unavailable").personalText(.secondary, size: 15)
                    Text("Explore").personalText(.secondary, size: 15, weight: .bold)
                }
            }
            card {
                Text("Transparency").personalText(.primary, size: 16, weight: .bold)
                Text("Unavailable").personalText(.secondary, size: 15)
            }
            card {
                Text("Choosing a product is optional").personalText(.primary, size: 16, weight: .bold)
                Text("Unavailable").personalText(.secondary, size: 15)
            }
        }
    }

    private var selectedChoice: String? {
        guard let selected, weights.choices.indices.contains(selected) else { return nil }
        return weights.choices[selected].name
    }

    private func card<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: PersonalSpace.s8, content: content)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(PersonalSpace.s16)
            .background(palette.surface, in: RoundedRectangle(cornerRadius: PersonalRadius.card, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: PersonalRadius.card, style: .continuous).stroke(palette.border, lineWidth: 1))
    }

    private func gold(_ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(.custom("Inter-Bold", size: 15))
                .foregroundStyle(PersonalTokens.action.label)
                .frame(maxWidth: .infinity, minHeight: 48)
                .background(PersonalTokens.action.default, in: RoundedRectangle(cornerRadius: PersonalRadius.action, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private var palette: PersonalPalette { colorScheme == .dark ? PersonalTokens.dark : PersonalTokens.light }
}
