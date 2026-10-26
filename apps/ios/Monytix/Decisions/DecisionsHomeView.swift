import SwiftUI

enum DecisionPage: Equatable {
    case home
    case weigh
    case confirm
    case solutions
}

private struct MeterLine: Identifiable {
    let id: String
    let label: String
    let fraction: Double
}

private struct ChoiceLine: Identifiable {
    let id: String
    let name: String?
    let approach: String?
    let amount: String?
    let meters: [MeterLine]
    let outcomes: [String]
    let hint: String?
}

private struct PublishedDecision: Identifiable {
    let id: String
    let title: String?
    let amount: String?
    let timing: String?
    let state: String?
    let question: String?
    let context: String?
    let badge: String?
    let summary: String?
    let weightCount: Int
    let choices: [ChoiceLine]
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

private struct WeightLine: Identifiable {
    let id: String
    let name: String?
    let priority: String?
    let meaning: String?
    let importance: Double
}

private struct SolutionLine: Identifiable {
    let id: String
    let title: String?
    let tag: String?
    let detail: String?
}

private struct DecisionWeights {
    var title: String?
    var question: String?
    var context: String?
    var mattered: String?
    var expected: [String] = []
    var choices: [ChoiceLine] = []
    var weights: [WeightLine] = []
    var solutions: [SolutionLine] = []
    var tradeoffTitle: String?
    var tradeoffDescription: String?
    var transparency: String?
    var optionalNote: String?

    static func parse(_ data: Data?) -> DecisionWeights {
        guard let data, let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return DecisionWeights()
        }
        let decision = root["decision"] as? [String: Any]
        let tradeoff = root["tradeoff"] as? [String: Any]
        return DecisionWeights(
            title: jsonText(decision, "title"),
            question: jsonText(decision, "question"),
            context: jsonText(decision, "context"),
            mattered: jsonText(decision, "mattered"),
            expected: stringList(decision?["expected"]),
            choices: (root["choices"] as? [[String: Any]] ?? []).enumerated().map { index, row in
                choiceLine(row, fallback: "choice-\(index)")
            },
            weights: (root["weights"] as? [[String: Any]] ?? []).enumerated().map { index, row in
                WeightLine(
                    id: "weight-\(index)",
                    name: jsonText(row, "name"),
                    priority: jsonText(row, "priority"),
                    meaning: jsonText(row, "meaning"),
                    importance: jsonFraction(row["importance"])
                )
            },
            solutions: (root["solutions"] as? [[String: Any]] ?? []).enumerated().map { index, row in
                SolutionLine(id: "solution-\(index)", title: jsonText(row, "title"), tag: jsonText(row, "tag"), detail: jsonText(row, "detail"))
            },
            tradeoffTitle: jsonText(tradeoff, "title"),
            tradeoffDescription: jsonText(tradeoff, "description"),
            transparency: jsonText(root, "transparency"),
            optionalNote: jsonText(root, "optional_note")
        )
    }
}

private let decisionFilters = [("Need you", "need_you"), ("Upcoming", "upcoming"), ("Made", "made")]
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
    let choices = (object["choices"] as? [[String: Any]] ?? []).enumerated().map { index, row in
        choiceLine(row, fallback: "\(id)-\(index)")
    }
    return PublishedDecision(
        id: id,
        title: jsonText(object, "title") ?? type.flatMap { decisionNames[$0] },
        amount: money(jsonText(object, "amount")),
        timing: jsonText(object, "timing"),
        state: jsonText(object, "state"),
        question: jsonText(object, "question"),
        context: jsonText(object, "context"),
        badge: jsonText(object, "badge"),
        summary: jsonText(object, "summary"),
        weightCount: Int(jsonText(object, "weight_count") ?? "") ?? choices.count,
        choices: choices
    )
}

private func choiceLine(_ row: [String: Any], fallback: String) -> ChoiceLine {
    let meters = (row["meters"] as? [[String: Any]] ?? []).enumerated().map { index, meter in
        MeterLine(id: "\(fallback)-meter-\(index)", label: jsonText(meter, "label") ?? "Balance", fraction: jsonFraction(meter["fraction"]))
    }
    return ChoiceLine(
        id: jsonText(row, "id") ?? fallback,
        name: jsonText(row, "name"),
        approach: jsonText(row, "approach"),
        amount: jsonText(row, "amount"),
        meters: meters,
        outcomes: stringList(row["outcomes"]),
        hint: jsonText(row, "hint")
    )
}

private func jsonText(_ object: [String: Any]?, _ key: String) -> String? {
    guard let value = object?[key] else { return nil }
    if let text = value as? String, !text.isEmpty { return text }
    if let number = value as? NSNumber { return number.stringValue }
    return nil
}

private func jsonFraction(_ value: Any?) -> Double {
    let number = (value as? NSNumber)?.doubleValue ?? 0
    return min(max(number, 0), 1)
}

private func stringList(_ value: Any?) -> [String] {
    (value as? [Any] ?? []).compactMap { item in
        if let text = item as? String, !text.isEmpty { return text }
        return nil
    }
}

private func money(_ raw: String?) -> String? {
    guard let raw, !raw.isEmpty else { return nil }
    if raw.contains("₹") { return raw }
    let cleaned = raw.replacingOccurrences(of: ",", with: "")
    guard let amount = Double(cleaned) else { return raw }
    let format = NumberFormatter()
    format.numberStyle = .currency
    format.currencyCode = "INR"
    format.locale = Locale(identifier: "en_IN")
    format.maximumFractionDigits = 0
    return format.string(from: NSNumber(value: amount)) ?? raw
}

struct DecisionHomeView: View {
    var store: UiSessionStore
    var onOpen: (String) -> Void
    @Environment(\.colorScheme) private var colorScheme
    @State private var filter = decisionFilters[0].1

    private var read: DecisionRead {
        DecisionRead.parse(store.decisionsData)
    }

    var body: some View {
        let listed = read.decisions.filter { $0.state == filter }
        let boardEmpty = read.heaviest == nil && read.decisions.isEmpty
        ScrollView {
            VStack(alignment: .leading, spacing: PersonalSpace.s20) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Decisions").personalText(.primary, size: 22, weight: .bold)
                    Text("See the choices that deserve your attention").personalText(.secondary, size: 15)
                }
                HStack(spacing: PersonalSpace.s8) {
                    ForEach(decisionFilters, id: \.1) { label, value in
                        filterChip(label, on: filter == value) { filter = value }
                    }
                }
                if boardEmpty {
                    quietState("No choices need you right now.")
                } else if filter == "need_you", let featured = read.heaviest {
                    Button { onOpen(featured.id) } label: { featuredCard(featured) }
                        .buttonStyle(.plain)
                    if listed.isEmpty {
                        quietState("No other choices are waiting.")
                    } else {
                        Text("Other choices ahead").personalText(.primary, size: 16, weight: .bold)
                        ForEach(Array(listed.enumerated()), id: \.element.id) { index, row in
                            Button { onOpen(row.id) } label: { listCard(row, icon: index.isMultiple(of: 2) ? "FigBizShield2" : "FigBizShield") }
                                .buttonStyle(.plain)
                        }
                    }
                } else if listed.isEmpty {
                    quietState(emptyFilter)
                } else {
                    ForEach(Array(listed.enumerated()), id: \.element.id) { index, row in
                        Button { onOpen(row.id) } label: { listCard(row, icon: index.isMultiple(of: 2) ? "FigBizShield2" : "FigBizShield") }
                            .buttonStyle(.plain)
                    }
                }
                Text("A Decision is a choice — not a recommendation.").personalText(.secondary, size: 15)
                Text("Monytix shows the trade-offs. You decide which weights matter most, choose an option, and mark the decision.").personalText(.secondary, size: 15)
            }
            .padding(.horizontal, PersonalSpace.s20)
            .padding(.top, PersonalSpace.s20)
            .padding(.bottom, 128)
        }
    }

    private var emptyFilter: String {
        switch filter {
        case "upcoming": "Nothing is saved for later."
        case "made": "No decisions are marked yet."
        default: "No choices need you right now."
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

    private func featuredCard(_ row: PublishedDecision) -> some View {
        card {
            HStack {
                Text(row.badge ?? "NEEDS A CHOICE").personalText(.secondary, size: 12, weight: .bold)
                Spacer()
                if row.weightCount > 0 {
                    Text("\(row.weightCount) WEIGHTS").personalText(.secondary, size: 12, weight: .bold)
                }
            }
            Text(row.title ?? "Decision").personalText(.primary, size: 18, weight: .bold)
            if let question = row.question {
                Text(question).personalText(.primary, size: 16, weight: .bold)
            }
            if let context = row.context {
                Text(context).personalText(.secondary, size: 15)
            }
            if !row.choices.isEmpty {
                HStack(spacing: PersonalSpace.s8) {
                    ForEach(row.choices.prefix(3)) { choice in
                        Text(choice.amount ?? choice.name ?? "Choice")
                            .personalText(.secondary, size: 13)
                    }
                }
            } else if let amount = row.amount {
                Text(amount).personalText(.secondary, size: 15)
            }
            Text("Weigh your options →").personalText(.primary, size: 15, weight: .bold)
        }
    }

    private func listCard(_ row: PublishedDecision, icon: String) -> some View {
        card {
            FigIcon(name: icon, size: 32)
            Text(row.timing ?? "Needs a choice").personalText(.secondary, size: 13)
            Text(row.title ?? "Decision").personalText(.primary, size: 16, weight: .bold)
            if let summary = row.summary {
                Text(summary).personalText(.secondary, size: 15)
            }
            if let amount = row.amount {
                Text(amount).personalText(.secondary, size: 15)
            }
            Text("Compare choices →").personalText(.primary, size: 15, weight: .bold)
        }
    }

    private func quietState(_ message: String) -> some View {
        Text(message).personalText(.secondary, size: 15)
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
    var store: UiSessionStore
    var api: MonytixApi
    var token: (Bool) async -> String?
    var onBack: () -> Void
    var onContinue: () -> Void
    var onConfirm: () -> Void
    var onSave: () -> Void
    @Environment(\.colorScheme) private var colorScheme
    @State private var selected: Int?
    @State private var reason = ""
    @State private var posting = false

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
                    VStack(alignment: .leading, spacing: 2) {
                        Text(title).personalText(.primary, size: 22, weight: .bold)
                        if let subtitle = weights.title {
                            Text(subtitle).personalText(.secondary, size: 15)
                        }
                    }
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
        .onChange(of: decisionId) { selected = nil }
    }

    private var weights: DecisionWeights {
        DecisionWeights.parse(store.decisionScreen(decisionId))
    }

    private var title: String {
        switch page {
        case .weigh: "Weigh your options"
        case .confirm: "Mark your decision"
        default: "Next step"
        }
    }

    private var weighBody: some View {
        VStack(alignment: .leading, spacing: PersonalSpace.s16) {
            if weights.choices.isEmpty {
                Text("This choice is not available yet.").personalText(.secondary, size: 15)
            } else {
                if let question = weights.question {
                    Text(question).personalText(.primary, size: 16, weight: .bold)
                }
                if let context = weights.context {
                    Text(context).personalText(.secondary, size: 15)
                }
                card {
                    Text("THE TRADE-OFF").personalText(.secondary, size: 12, weight: .bold)
                    Text(weights.tradeoffTitle ?? "What are you balancing?").personalText(.primary, size: 16, weight: .bold)
                    Text(weights.tradeoffDescription ?? "Every option moves the balance between money you can use now and protection you build for later.").personalText(.secondary, size: 15)
                    HStack {
                        Text("FLEXIBILITY NOW").personalText(.secondary, size: 12, weight: .bold)
                        Spacer()
                        Text("SAFETY LATER").personalText(.secondary, size: 12, weight: .bold)
                    }
                    meter(0.5)
                }
                Text("1. See what each choice changes").personalText(.primary, size: 16, weight: .bold)
                ForEach(Array(weights.choices.enumerated()), id: \.element.id) { index, choice in
                    choiceCard(choice, on: selected == index) { selected = index }
                }
                Text("2. Tell Monytix what matters to you").personalText(.primary, size: 16, weight: .bold)
                ForEach(weights.weights) { line in
                    card {
                        HStack {
                            Text(line.name ?? "Weight").personalText(.primary, size: 16, weight: .bold)
                            Spacer()
                            Text(line.priority ?? "MEDIUM").personalText(.secondary, size: 13, weight: .bold)
                        }
                        if let meaning = line.meaning {
                            Text(meaning).personalText(.secondary, size: 15)
                        }
                        meter(line.importance)
                    }
                }
                if let choice = selectedChoice {
                    card {
                        Text("Selected choice").personalText(.secondary, size: 13)
                        Text(choice.name ?? "Choice").personalText(.primary, size: 16, weight: .bold)
                        ForEach(choice.outcomes, id: \.self) { outcome in
                            Text(outcome).personalText(.secondary, size: 15)
                        }
                    }
                }
                gold("Continue with selected choice", enabled: selectedChoice != nil, action: onContinue)
            }
        }
    }

    private var confirmBody: some View {
        VStack(alignment: .leading, spacing: PersonalSpace.s16) {
            Text("Confirm the choice you want to carry forward").personalText(.secondary, size: 15)
            card {
                Text("YOUR CHOICE").personalText(.secondary, size: 12, weight: .bold)
                Text(selectedChoice?.name ?? "Choose an option first").personalText(.primary, size: 16, weight: .bold)
                if let approach = selectedChoice?.approach {
                    Text(approach).personalText(.secondary, size: 15)
                }
                ForEach(selectedChoice?.outcomes ?? [], id: \.self) { outcome in
                    Text(outcome).personalText(.secondary, size: 15)
                }
            }
            card {
                Text("What you weighted most").personalText(.secondary, size: 13)
                Text(weights.mattered ?? "The weights you marked highest are the ones this choice carries forward.").personalText(.secondary, size: 15)
                Text("Expected outcomes").personalText(.secondary, size: 13)
                ForEach(weights.expected, id: \.self) { line in
                    Text(line).personalText(.secondary, size: 15)
                }
            }
            Text("Add your reason · optional").personalText(.secondary, size: 13)
            TextField("I chose this because…", text: $reason, axis: .vertical)
                .font(.custom("Inter-Regular", size: 15))
                .foregroundStyle(palette.textPrimary)
                .padding(PersonalSpace.s16)
                .background(palette.surface, in: RoundedRectangle(cornerRadius: PersonalRadius.action, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: PersonalRadius.action, style: .continuous).stroke(palette.border, lineWidth: 1))
            Text("Confirm this decision").personalText(.primary, size: 16, weight: .bold)
            gold("Confirm decision →", enabled: selectedChoice != nil && !posting) {
                Task {
                    if await post("ACCEPT") {
                        await store.prefetch()
                        onConfirm()
                    }
                }
            }
            Text("Mark it for later").personalText(.primary, size: 16, weight: .bold)
            gold("Save for later", enabled: !posting) {
                Task {
                    if await post("SNOOZE") {
                        await store.prefetch()
                        onSave()
                    }
                }
            }
        }
    }

    private var solutionsBody: some View {
        VStack(alignment: .leading, spacing: PersonalSpace.s16) {
            Text("Your decision created a financial need").personalText(.secondary, size: 15)
            card {
                Text("DECISION MARKED").personalText(.secondary, size: 12, weight: .bold)
                Text(selectedChoice?.name ?? weights.question ?? "Decision marked").personalText(.primary, size: 16, weight: .bold)
                Text("Decision → Need → Solution options").personalText(.secondary, size: 15)
                if let context = weights.context {
                    Text(context).personalText(.secondary, size: 15)
                }
            }
            Text("Ways to fulfil this decision").personalText(.primary, size: 16, weight: .bold)
            if weights.solutions.isEmpty {
                Text("This choice is not available yet.").personalText(.secondary, size: 15)
            } else {
                ForEach(weights.solutions) { way in
                    card {
                        Text(way.title ?? "Way to fulfil it").personalText(.primary, size: 16, weight: .bold)
                        if let tag = way.tag {
                            Text(tag).personalText(.secondary, size: 13, weight: .bold)
                        }
                        if let detail = way.detail {
                            Text(detail).personalText(.secondary, size: 15)
                        }
                    }
                }
            }
            card {
                Text("Why you are seeing these").personalText(.primary, size: 16, weight: .bold)
                Text(weights.transparency ?? "These options follow from the decision you already made. Monytix does not create a Decision because a product is available.").personalText(.secondary, size: 15)
            }
            card {
                Text("Choosing a product is optional").personalText(.primary, size: 16, weight: .bold)
                Text(weights.optionalNote ?? "Your Decision is still complete. You can return to these options later.").personalText(.secondary, size: 15)
            }
        }
    }

    private var selectedChoice: ChoiceLine? {
        guard let selected, weights.choices.indices.contains(selected) else { return nil }
        return weights.choices[selected]
    }

    private func choiceCard(_ choice: ChoiceLine, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            card {
                if let approach = choice.approach {
                    Text(approach.uppercased()).personalText(.secondary, size: 12, weight: .bold)
                }
                Text(choice.name ?? "Choice").personalText(.primary, size: 16, weight: .bold)
                if let amount = choice.amount, amount != choice.name {
                    Text(amount).personalText(.secondary, size: 15)
                }
                ForEach(choice.meters) { line in
                    Text(line.label).personalText(.secondary, size: 13)
                    meter(line.fraction)
                }
                ForEach(choice.outcomes, id: \.self) { outcome in
                    Text(outcome).personalText(.secondary, size: 15)
                }
                if let hint = choice.hint {
                    Text(hint).personalText(.secondary, size: 13)
                }
            }
            .overlay(
                RoundedRectangle(cornerRadius: PersonalRadius.card, style: .continuous)
                    .stroke(on ? PersonalTokens.action.default : palette.border, lineWidth: on ? 2 : 1)
            )
        }
        .buttonStyle(.plain)
    }

    private func meter(_ fraction: Double) -> some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(palette.border)
                Capsule().fill(PersonalTokens.action.default).frame(width: max(8, geo.size.width * fraction))
            }
        }
        .frame(height: 8)
    }

    private func post(_ action: String) async -> Bool {
        posting = true
        defer { posting = false }
        var body: [String: Any] = ["action": action]
        if action == "ACCEPT", let id = selectedChoice?.id {
            body["selected_option_id"] = id
        }
        guard let data = try? JSONSerialization.data(withJSONObject: body) else { return false }
        let result = await api.submit(
            method: "POST",
            path: "/v1/decisions/\(decisionId)/actions",
            body: data,
            idempotencyKey: "decision-\(action.lowercased())-\(decisionId)-\(selectedChoice?.id ?? "later")",
            token: token
        )
        return (200..<300).contains(result.status)
    }

    private func card<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: PersonalSpace.s8, content: content)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(PersonalSpace.s16)
            .background(palette.surface, in: RoundedRectangle(cornerRadius: PersonalRadius.card, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: PersonalRadius.card, style: .continuous).stroke(palette.border, lineWidth: 1))
    }

    private func gold(_ label: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(.custom("Inter-Bold", size: 15))
                .foregroundStyle(PersonalTokens.action.label)
                .frame(maxWidth: .infinity, minHeight: 48)
                .background(PersonalTokens.action.default.opacity(enabled ? 1 : 0.4), in: RoundedRectangle(cornerRadius: PersonalRadius.action, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
    }

    private var palette: PersonalPalette { colorScheme == .dark ? PersonalTokens.dark : PersonalTokens.light }
}
