import SwiftUI

struct RecordedCurrency: Equatable {
    let currency: String
    let inflow: String
    let outflow: String
}

struct RecordedPreview: Equatable, Identifiable {
    let id: String
    let amount: String?
    let currency: String?
    let direction: String?
    let transactionDate: String?
    let description: String?
    let accountName: String?
    let weightName: String?
}

struct ActiveMission: Equatable {
    var title: String?
    var line: String?
    var progress: String?
}

struct LiveMile: Equatable {
    var impact: String?
    var line: String?
    var pills: [String] = []
}

struct LiveDecision: Equatable {
    var title: String
    var question: String?
}

struct LiveWeight: Equatable {
    var name: String
    var amount: String
}

struct LiveSnapshot: Equatable {
    var recordedFlowAvailable = false
    var currencies: [RecordedCurrency] = []
    var transactionsKnown = false
    var hasRecordedTransactions = false
    var availableBalance: String?
    var previewsKnown = false
    var previews: [RecordedPreview] = []
    var activeMission: ActiveMission?
    var activeMissions: [ActiveMission] = []
    var decisions: [LiveDecision] = []
    var weights: [LiveWeight] = []
    var mile: LiveMile? = nil

    static let unavailable = LiveSnapshot()

    static func parse(_ data: Data) -> LiveSnapshot {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return .unavailable
        }
        let flow = root["recordedFlow"] as? [String: Any]
        let rows = flow?["currencies"] as? [[String: Any]] ?? []
        let currencies = rows.compactMap { row -> RecordedCurrency? in
            guard let currency = row["currency"] as? String,
                  let inflow = row["inflow"] as? String,
                  let outflow = row["outflow"] as? String else {
                return nil
            }
            return RecordedCurrency(currency: currency, inflow: inflow, outflow: outflow)
        }
        let transactions = root["transactions"] as? [String: Any]
        let balance = (root["summary"] as? [String: Any])?["available_balance"] as? [String: Any]
        let amount = balance?["amount"] as? String
        let currency = balance?["currency"] as? String
        let previewRows = root["transactions_preview"] as? [[String: Any]]
        let previews = (previewRows ?? []).compactMap { row -> RecordedPreview? in
            guard let id = row["id"] as? String, !id.isEmpty else { return nil }
            return RecordedPreview(
                id: id,
                amount: row["amount"] as? String,
                currency: row["currency"] as? String,
                direction: row["direction"] as? String,
                transactionDate: row["transactionDate"] as? String,
                description: row["description"] as? String,
                accountName: row["accountName"] as? String,
                weightName: row["weightName"] as? String
            )
        }
        let balanceText: String? = (balance?["available"] as? Bool) == true && !(amount ?? "").isEmpty && !(currency ?? "").isEmpty
            ? "\(currency ?? "") \(amount ?? "")"
            : nil
        let missionRows = root["active_missions"] as? [Any] ?? []
        var activeMissions: [ActiveMission] = missionRows.compactMap { item in
            guard let row = item as? [String: Any] else { return nil }
            return ActiveMission(
                title: row["title"] as? String,
                line: row["line"] as? String,
                progress: row["progress"] as? String
            )
        }
        let mission = root["active_mission"] as? [String: Any]
        let activeMission: ActiveMission? = (mission?["available"] as? Bool) == true
            ? ActiveMission(
                title: mission?["title"] as? String,
                line: mission?["line"] as? String,
                progress: mission?["progress"] as? String
            )
            : nil
        if activeMissions.isEmpty, let activeMission {
            activeMissions = [activeMission]
        }
        let decisionObject = root["decision_cards"] as? [String: Any]
        let decisions: [LiveDecision] = (decisionObject?["available"] as? Bool) == true
            ? (decisionObject?["cards"] as? [Any] ?? []).compactMap { item in
                guard let row = item as? [String: Any], let title = row["title"] as? String, !title.isEmpty else { return nil }
                return LiveDecision(title: title, question: row["question"] as? String)
            }
            : []
        let weightObject = root["weight_summary"] as? [String: Any]
        let weights: [LiveWeight] = (weightObject?["available"] as? Bool) == true
            ? (weightObject?["weights"] as? [Any] ?? []).compactMap { item in
                guard let row = item as? [String: Any], let name = row["name"] as? String, !name.isEmpty else { return nil }
                return LiveWeight(name: name, amount: (row["amount"] as? String) ?? "")
            }
            : []
        let mileObject = root["mile"] as? [String: Any]
        let mile: LiveMile? = (mileObject?["available"] as? Bool) == true
            ? LiveMile(
                impact: mileObject?["impact"] as? String,
                line: mileObject?["line"] as? String,
                pills: (mileObject?["pills"] as? [Any] ?? []).compactMap { $0 as? String }
            )
            : nil
        return LiveSnapshot(
            recordedFlowAvailable: (flow?["available"] as? Bool) == true && !currencies.isEmpty,
            currencies: currencies,
            transactionsKnown: (transactions?["available"] as? Bool) == true,
            hasRecordedTransactions: (transactions?["hasRecorded"] as? Bool) == true,
            availableBalance: balanceText,
            previewsKnown: previewRows != nil,
            previews: previews,
            activeMission: activeMission,
            activeMissions: activeMissions,
            decisions: decisions,
            weights: weights,
            mile: mile
        )
    }
}

struct LiveHomeView: View {
    var store: UiSessionStore
    var onOpen: (LivePage) -> Void
    var onViewMissions: () -> Void
    var onViewDecisions: () -> Void
    var onViewMile: () -> Void
    @Environment(\.colorScheme) private var colorScheme

    private var snapshot: LiveSnapshot {
        guard let data = store.liveData else { return .unavailable }
        return LiveSnapshot.parse(data)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: PersonalSpace.s20) {
                welcome.enter(0)
                missions.enter(0.064)
                decisions.enter(0.128)
                attention.enter(0.195)
                cash.enter(0.260)
                pulse.enter(0.325)
                mile.enter(0.390)
            }
            .padding(.horizontal, PersonalSpace.s28)
            .padding(.top, PersonalSpace.s20)
            .padding(.bottom, 128)
        }
        .personalCanvas()
        .personalTheme()
    }

    private var welcome: some View {
        VStack(alignment: .leading, spacing: PersonalSpace.s20) {
            Text("Your money, right now")
                .personalText(.primary, size: 26, weight: .extraBold)
            Button {
                onOpen(.transactions)
            } label: {
                HStack(spacing: PersonalSpace.s12) {
                    FigIcon(name: "FigReceipt", size: 24)
                    Text("Transactions")
                        .font(.custom("Inter-SemiBold", size: 16))
                        .foregroundStyle(palette.textPrimary)
                    Spacer()
                    statusPill(transactionFact)
                    FigIcon(name: "FigChevron", size: 20)
                }
                .padding(.horizontal, 18)
                .padding(.vertical, 14)
                .background(transactionFill, in: RoundedRectangle(cornerRadius: PersonalRadius.action, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: PersonalRadius.action, style: .continuous)
                        .stroke(transactionBorder, lineWidth: 1)
                )
            }
            .buttonStyle(.plain)
            if !snapshot.previews.isEmpty {
                ForEach(snapshot.previews.prefix(8)) { row in
                    let money = (row.amount?.isEmpty == false && row.currency?.isEmpty == false)
                        ? "\(row.currency ?? "") \(row.amount ?? "")"
                        : "Unavailable"
                    HStack(spacing: PersonalSpace.s12) {
                        FigIcon(name: row.direction == "IN" ? "FigCashArrow" : "FigUtensils", size: 24)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(row.description ?? "Unavailable")
                                .personalText(.primary, size: 15, weight: .bold)
                                .lineLimit(2)
                            Text("\(money) · \(row.transactionDate ?? "Unavailable")")
                                .personalText(.secondary, size: 13)
                            if let account = row.accountName, !account.isEmpty {
                                Text(account).personalText(.secondary, size: 13)
                            }
                            if let weight = row.weightName, !weight.isEmpty {
                                Text(weight).personalText(.secondary, size: 13)
                            }
                        }
                    }
                }
            }
        }
    }

    private var missions: some View {
        gradientCard(goalColors, goalBorder) {
            cardHeading("MISSIONS", pill: false)
            if snapshot.activeMissions.isEmpty {
                Text("Nothing is active yet.").personalText(.secondary, size: 15)
            } else {
                if let mission = snapshot.activeMissions.first {
                    VStack(spacing: PersonalSpace.s8) {
                        progressRing(mission.progress ?? "Started")
                        if let line = mission.line {
                            Text(line).personalText(.secondary, size: 14)
                        }
                    }
                    .frame(maxWidth: .infinity)
                }
                ForEach(Array(snapshot.activeMissions.enumerated()), id: \.offset) { _, mission in
                    HStack(spacing: PersonalSpace.s12) {
                        FigIcon(name: "FigOrbitHaloSm", size: 36)
                        VStack(alignment: .leading, spacing: PersonalSpace.s8) {
                            Text(mission.title ?? "Mission").personalText(.primary, size: 14, weight: .bold)
                            if let line = mission.line {
                                Text(line).personalText(.secondary, size: 13)
                            }
                            if let progress = mission.progress {
                                Text(progress).personalText(.secondary, size: 13)
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(PersonalSpace.s16)
                    .background(palette.mission, in: RoundedRectangle(cornerRadius: PersonalRadius.inset, style: .continuous))
                }
            }
            goldButton("View Missions  →") { onViewMissions() }
        }
    }

    private var decisions: some View {
        plainCard(palette.widgetDecision, palette.widgetDecisionBorder) {
            cardHeading("DECISIONS", pill: false)
            if snapshot.decisions.isEmpty {
                Text("Nothing needs a choice yet.").personalText(.secondary, size: 15)
            } else {
                HStack(alignment: .top, spacing: PersonalSpace.s12) {
                    ForEach(Array(snapshot.decisions.enumerated()), id: \.offset) { index, card in
                        decisionTile(index == 0 ? "FigBizShield" : "FigBizShield2", card.title, card.question ?? "Needs a choice")
                    }
                }
            }
            goldButton("View Decisions  →") { onViewDecisions() }
        }
    }

    private var attention: some View {
        plainCard(palette.widgetChange, palette.widgetChangeBorder) {
            cardHeading("FOR YOU", pill: false)
            if snapshot.previews.isEmpty {
                Text("Nothing has been recorded yet.").personalText(.secondary, size: 15)
            } else {
                ForEach(snapshot.previews.prefix(2)) { row in
                    insight("FigTrendingUp", row.description ?? "Recorded movement", movementLine(row))
                }
            }
            goldButton("See what changed  →") { onOpen(.forYou) }
        }
    }

    private var cash: some View {
        gradientCard([palette.widgetCashStart, palette.widgetCashEnd], palette.widgetCashBorder) {
            cardHeading("CASH FLOW", pill: false)
            if let row = snapshot.currencies.first, snapshot.recordedFlowAvailable {
                Text("\(row.currency) in \(row.inflow) · out \(row.outflow)").personalText(.primary, size: 16, weight: .bold)
                Capsule().fill(palette.progressTrack).frame(height: 12)
                HStack {
                    Text("Recorded inflow \(row.currency) \(row.inflow)").personalText(.primary, size: 13, weight: .bold)
                    Spacer()
                    Text("Recorded outflow \(row.currency) \(row.outflow)").personalText(.primary, size: 13, weight: .bold)
                }
            } else if snapshot.availableBalance == nil {
                Text("Nothing has been recorded this month.").personalText(.secondary, size: 15)
            }
            if let availableBalance = snapshot.availableBalance {
                Text("Available balance").personalText(.secondary, size: 13)
                Text(availableBalance).personalText(.primary, size: 22, weight: .bold)
            }
            goldButton("See what’s ahead  →") { onOpen(.cashFlow) }
        }
    }

    private var pulse: some View {
        plainCard(palette.widgetWeight, palette.widgetWeightBorder) {
            cardHeading("FINANCIAL PULSE", pill: false)
            if snapshot.weights.isEmpty {
                Text("No movements this month.").personalText(.secondary, size: 15)
            } else {
                ForEach(Array(snapshot.weights.enumerated()), id: \.offset) { _, weight in
                    HStack {
                        Text(weight.name).personalText(.primary, size: 14, weight: .bold)
                        Spacer()
                        Text(weight.amount).personalText(.secondary, size: 14)
                    }
                }
            }
            goldButton("Explore your 10 Weights  →") { onOpen(.pulse) }
        }
    }

    private var mile: some View {
        gradientCard([palette.widgetImpactStart, palette.widgetImpactEnd], palette.widgetImpactBorder) {
            Text("M.I.L.E.")
                .font(.custom("Inter-ExtraBold", size: 13))
                .foregroundStyle(eyebrow)
            Text("Money Impact & Life Evolution").personalText(.secondary, size: 13)
            if let mile = snapshot.mile {
                if let impact = mile.impact {
                    Text(impact).personalText(.primary, size: 16, weight: .bold)
                }
                if let line = mile.line {
                    Text(line).personalText(.secondary, size: 15)
                }
                if !mile.pills.isEmpty {
                    HStack(spacing: PersonalSpace.s8) {
                        ForEach(mile.pills, id: \.self) { statusPill($0) }
                    }
                }
            } else {
                Text("Nothing has been recorded yet.").personalText(.secondary, size: 15)
            }
            goldButton("See your M.I.L.E.  →") { onViewMile() }
        }
    }

    private func cardHeading(_ title: String, pill: Bool = true) -> some View {
        HStack {
            Text(title)
                .font(.custom("Inter-ExtraBold", size: 13))
                .foregroundStyle(eyebrow)
            Spacer()
            if pill { statusPill("Unavailable") }
        }
    }

    private func statusPill(_ label: String) -> some View {
        Text(label)
            .font(.custom("Inter-Bold", size: 12))
            .foregroundStyle(colorScheme == .dark ? palette.popoverBorder : palette.textPrimary)
            .padding(.horizontal, PersonalSpace.s12)
            .padding(.vertical, PersonalSpace.s8)
            .background(pillFill, in: Capsule())
    }

    private func plainCard<Content: View>(_ fill: Color, _ border: Color, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: PersonalSpace.s12, content: content)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(PersonalSpace.s16)
            .background(fill, in: RoundedRectangle(cornerRadius: PersonalRadius.card, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: PersonalRadius.card, style: .continuous)
                    .stroke(border, lineWidth: 1)
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

    private func progressRing(_ label: String) -> some View {
        ZStack {
            FigIcon(name: "FigOrbitHalo", size: 96)
            FigIcon(name: "FigOrbitTrack", size: 84)
            FigIcon(name: "FigGoalFill", size: 72)
            FigIcon(name: "FigProgressOrigin", size: 10).offset(y: 36)
            FigIcon(name: "FigProgressMarker", size: 14).offset(x: 24, y: -22)
            Text(label)
                .personalText(.primary, size: 16, weight: .bold)
                .multilineTextAlignment(.center)
        }
        .frame(width: 96, height: 96)
    }

    private func movementLine(_ row: RecordedPreview) -> String {
        let money = (row.amount?.isEmpty == false && row.currency?.isEmpty == false)
            ? "\(row.currency ?? "") \(row.amount ?? "")"
            : "Recorded"
        let weight = row.weightName?.isEmpty == false ? " · \(row.weightName ?? "")" : ""
        return "\(money) · \(row.transactionDate ?? "Recorded")\(weight)"
    }

    private func decisionTile(_ icon: String, _ title: String, _ line: String) -> some View {
        VStack(alignment: .leading, spacing: PersonalSpace.s8) {
            FigIcon(name: icon, size: 28)
            Text(title).personalText(.primary, size: 14, weight: .bold)
            Text(line).personalText(.secondary, size: 13)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(PersonalSpace.s16)
        .background(palette.surfaceRaised, in: RoundedRectangle(cornerRadius: PersonalRadius.inset, style: .continuous))
    }

    private func insight(_ symbol: String, _ title: String, _ line: String) -> some View {
        HStack(alignment: .center, spacing: PersonalSpace.s12) {
            FigIcon(name: symbol, size: 28)
            VStack(alignment: .leading, spacing: PersonalSpace.s4) {
                Text(title).personalText(.primary, size: 14, weight: .bold)
                Text(line).personalText(.secondary, size: 13)
            }
        }
    }

    private func weightTile(_ symbol: String, _ title: String) -> some View {
        VStack(alignment: .leading, spacing: PersonalSpace.s8) {
            FigIcon(name: symbol, size: 22)
            Text(title).personalText(.primary, size: 11, weight: .bold)
            Text("Unavailable").personalText(.secondary, size: 12)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(PersonalSpace.s12)
        .background(palette.surfaceRaised, in: RoundedRectangle(cornerRadius: PersonalRadius.inset, style: .continuous))
    }

    private func goldButton(_ label: String, action: (() -> Void)? = nil) -> some View {
        let face = Text(label)
            .font(.custom("Inter-Bold", size: 15))
            .foregroundStyle(PersonalTokens.action.label)
            .frame(maxWidth: .infinity, minHeight: 48)
            .background(PersonalTokens.action.default, in: RoundedRectangle(cornerRadius: PersonalRadius.action, style: .continuous))
            .modifier(ButtonNudge())
        return Group {
            if let action {
                Button(action: action) { face }
                    .buttonStyle(.plain)
            } else {
                face
            }
        }
    }

    private var transactionFact: String {
        if !snapshot.transactionsKnown { return "Unavailable" }
        return snapshot.hasRecordedTransactions ? "Recorded" : "No recorded transactions"
    }
}

private struct FlowLayout: Layout {
    var spacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? 0
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
        return CGSize(width: width, height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var rowHeight: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > bounds.minX, x + size.width > bounds.maxX {
                x = bounds.minX
                y += rowHeight + spacing
                rowHeight = 0
            }
            view.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}

private struct ButtonNudge: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var lifted = false

    func body(content: Content) -> some View {
        content
            .offset(y: lifted ? -2 : 0)
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.easeInOut(duration: 0.15).delay(0.75)) { lifted = true }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) {
                    withAnimation(.easeInOut(duration: 0.15)) { lifted = false }
                }
            }
    }
}

private struct EnterModifier: ViewModifier {
    let delay: Double
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown = false

    func body(content: Content) -> some View {
        content
            .opacity(shown || reduceMotion ? 1 : 0)
            .offset(y: shown || reduceMotion ? 0 : 8)
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.easeOut(duration: 0.42).delay(delay)) { shown = true }
            }
    }
}

private extension View {
    func enter(_ delay: Double) -> some View {
        modifier(EnterModifier(delay: delay))
    }
}

private extension LiveHomeView {
    var palette: PersonalPalette { colorScheme == .dark ? PersonalTokens.dark : PersonalTokens.light }
    var eyebrow: Color { colorScheme == .dark ? palette.popoverBorder : palette.textPrimary }
    var transactionFill: Color { colorScheme == .dark ? palette.surface : PersonalTokens.status.lavender }
    var transactionBorder: Color { colorScheme == .dark ? palette.border : PersonalTokens.status.lavenderBorder }
    var goalColors: [Color] { [palette.widgetGoalStart, palette.widgetGoalMid, palette.widgetGoalEnd] }
    var goalBorder: Color { palette.widgetGoalBorder }
    var pillFill: Color { colorScheme == .dark ? palette.surfaceRaised : PersonalTokens.status.lavender }
}
