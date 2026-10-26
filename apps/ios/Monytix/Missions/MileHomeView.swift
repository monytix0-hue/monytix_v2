import SwiftUI

enum MileStep: Equatable {
    case outcomes
    case outcome
    case trace
    case report
    case lifetime
}

private struct MileFamily {
    let name: String
    let line: String
}

private let mileFamilies = [
    MileFamily(name: "Safety", line: "Protection & resilience"),
    MileFamily(name: "Debt", line: "Commitments reduced"),
    MileFamily(name: "Savings", line: "Cash retained"),
    MileFamily(name: "Wealth", line: "Future assets built"),
    MileFamily(name: "Opportunity", line: "New capacity opened"),
    MileFamily(name: "Freedom", line: "More financial flexibility"),
]

private let homeMix = ["Safety", "Debt", "Savings", "Wealth"]

private struct MileStat {
    var label: String
    var value: String?
}

private struct MileOutcome {
    var id: String
    var title: String?
    var line: String?
    var amount: String?
    var miles: String?
    var share: String?
    var drivers: String?
    var recent: String?
    var actions: String?
}

private struct MileMonth {
    var label: String
    var value: String?
}

private struct MileSummary {
    var period: String?
    var distance: String?
    var distanceLine: String?
    var months: [MileMonth] = []
    var impact: String?
    var impactLine: String?
    var outcomes: [MileOutcome] = []
    var movement: String?
    var reportYear: String?
    var reportDistance: String?
    var reportImpact: String?
    var reportLine: String?
    var lifetimeDistance: String?
    var lifetimeImpact: String?
    var lifetimeLine: String?
    var reportNumbers: [MileStat] = []
    var reportEvolution: String?
    var lifetimeYears: [MileStat] = []
    var lifetimeBuilt: [MileStat] = []

    static let empty = MileSummary()

    func outcome(named name: String) -> MileOutcome? {
        outcomes.first { $0.title?.caseInsensitiveCompare(name) == .orderedSame }
    }

    static func parse(_ data: Data?) -> MileSummary {
        guard let data, let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return .empty
        }
        let distance = field(root, "distance")
        let impact = field(root, "impact")
        let movement = field(root, "movement")
        let report = field(root, "report")
        let lifetime = field(root, "lifetime")
        return MileSummary(
            period: text(field(root, "period"), "label"),
            distance: text(distance, "value"),
            distanceLine: text(distance, "line"),
            months: monthRows(root),
            impact: text(impact, "amount"),
            impactLine: text(impact, "line"),
            outcomes: outcomeRows(root),
            movement: text(movement, "line"),
            reportYear: text(report, "year"),
            reportDistance: text(report, "distance"),
            reportImpact: text(report, "impact"),
            reportLine: text(report, "line"),
            lifetimeDistance: text(lifetime, "distance"),
            lifetimeImpact: text(lifetime, "impact"),
            lifetimeLine: text(lifetime, "line"),
            reportNumbers: stats(report, "numbers"),
            reportEvolution: text(report, "evolution"),
            lifetimeYears: stats(lifetime, "years"),
            lifetimeBuilt: stats(lifetime, "built")
        )
    }
}

private struct MileEvent {
    var id: String
    var title: String?
    var line: String?
    var miles: String?
}

private struct MileTrace {
    var title: String?
    var line: String?
    var miles: String?
    var whenLabel: String?
    var changed: String?
    var decisionId: String?
    var decision: String?
}

private func field(_ root: [String: Any], _ key: String) -> [String: Any]? {
    guard let value = root[key] as? [String: Any], value["available"] as? Bool == true else { return nil }
    return value
}

private func text(_ obj: [String: Any]?, _ key: String) -> String? {
    guard let value = obj?[key] as? String, !value.isEmpty else { return nil }
    return value
}

private func monthRows(_ root: [String: Any]) -> [MileMonth] {
    guard let rows = root["months"] as? [[String: Any]] else { return [] }
    return rows.compactMap { row in
        guard let label = row["label"] as? String, !label.isEmpty else { return nil }
        return MileMonth(label: label, value: text(row, "value"))
    }
}

private func outcomeRows(_ root: [String: Any]) -> [MileOutcome] {
    guard let rows = root["outcomes"] as? [[String: Any]] else { return [] }
    return rows.compactMap { row in
        guard let id = row["id"] as? String, !id.isEmpty else { return nil }
        return MileOutcome(
            id: id,
            title: text(row, "title"),
            line: text(row, "line"),
            amount: text(row, "amount"),
            miles: text(row, "miles"),
            share: text(row, "share"),
            drivers: text(row, "drivers"),
            recent: text(row, "recent"),
            actions: text(row, "actions")
        )
    }
}

private func stats(_ obj: [String: Any]?, _ key: String) -> [MileStat] {
    ((obj?[key] as? [Any]) ?? []).compactMap { item in
        guard let row = item as? [String: Any], let label = row["label"] as? String, !label.isEmpty else { return nil }
        return MileStat(label: label, value: text(row, "value"))
    }
}

private func events(_ data: Data?) -> [MileEvent] {
    guard let data, let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let rows = root["events"] as? [[String: Any]] else {
        return []
    }
    return rows.compactMap { row in
        guard let id = row["id"] as? String, !id.isEmpty else { return nil }
        return MileEvent(id: id, title: text(row, "title"), line: text(row, "line"), miles: text(row, "miles"))
    }
}

private func trace(_ data: Data?) -> MileTrace? {
    guard let data, let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let event = root["event"] as? [String: Any], let id = event["id"] as? String, !id.isEmpty else {
        return nil
    }
    return MileTrace(
        title: text(event, "title"),
        line: text(event, "line"),
        miles: text(event, "miles"),
        whenLabel: text(event, "when"),
        changed: text(event, "changed"),
        decisionId: text(event, "decision_id"),
        decision: text(event, "decision")
    )
}

struct MileHomeView: View {
    var store: UiSessionStore
    var onOutcomes: () -> Void
    var onTrace: (String) -> Void
    var onReport: () -> Void
    var onLifetime: () -> Void
    @Environment(\.colorScheme) private var colorScheme

    private var summary: MileSummary {
        MileSummary.parse(store.mileSummaryData)
    }

    private var recent: [MileEvent] {
        events(store.mileEventsData)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: PersonalSpace.s20) {
                VStack(alignment: .leading, spacing: PersonalSpace.s8) {
                    HStack {
                        Text("M.I.L.E.").personalText(.primary, size: 22, weight: .extraBold)
                        Spacer()
                        if let period = summary.period { pill(period) }
                    }
                    Text("Money Impact & Life Evolution").personalText(.secondary, size: 14)
                }
                if summary.distance == nil && summary.impact == nil && recent.isEmpty {
                    Text("Nothing has been recorded yet.").personalText(.secondary, size: 15)
                    link("View lifetime journey", action: onLifetime)
                } else {
                    if summary.distance != nil || !summary.months.isEmpty {
                        card {
                            eyebrow("YOUR RECENT FINANCIAL DISTANCE")
                            if let distance = summary.distance {
                                HStack(alignment: .firstTextBaseline, spacing: PersonalSpace.s8) {
                                    Text(distance).personalText(.primary, size: 16, weight: .bold)
                                    Text("MILES").personalText(.secondary, size: 13, weight: .bold)
                                }
                            }
                            if let line = summary.distanceLine {
                                Text(line).personalText(.secondary, size: 14)
                            }
                            ForEach(Array(summary.months.enumerated()), id: \.offset) { _, month in
                                Text("\(month.label) · \(month.value ?? "0")").personalText(.secondary, size: 13)
                            }
                            link("View lifetime journey", action: onLifetime)
                        }
                    }
                    card {
                        eyebrow("POSITIVE FINANCIAL IMPACT")
                        if let impact = summary.impact {
                            Text(impact).personalText(.primary, size: 16, weight: .bold)
                        }
                        Text(summary.impactLine ?? "Positive financial impact").personalText(.secondary, size: 14)
                        HStack(alignment: .top, spacing: PersonalSpace.s8) {
                            ForEach(homeMix, id: \.self) { name in
                                VStack(alignment: .leading, spacing: 4) {
                                    if let amount = summary.outcome(named: name)?.amount {
                                        Text(amount).personalText(.primary, size: 13, weight: .bold)
                                    }
                                    Text(name).personalText(.secondary, size: 12)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                            }
                        }
                        gold("See where your impact came from  →", action: onOutcomes)
                    }
                    if let movement = summary.movement {
                        card {
                            eyebrow("HOW YOUR FINANCIAL LIFE IS MOVING")
                            Text(movement).personalText(.primary, size: 16, weight: .bold)
                        }
                    }
                    card {
                        eyebrow("RECENT MILES")
                        Text("What actually moved you forward").personalText(.secondary, size: 14)
                        if recent.isEmpty {
                            Text("No miles recorded yet.").personalText(.secondary, size: 14)
                        } else {
                            ForEach(Array(recent.enumerated()), id: \.element.id) { index, event in
                                eventRow(mileIcon(index), event.title, event.line, event.miles) { onTrace(event.id) }
                            }
                        }
                        link("See every MILE", action: onOutcomes)
                    }
                }
                Button(action: onReport) {
                    card {
                        eyebrow(summary.reportYear.map { "YOUR \($0) M.I.L.E. REPORT" } ?? "YOUR M.I.L.E. REPORT")
                        Text("See the year your money changed.").personalText(.primary, size: 16, weight: .bold)
                        Text("Decisions · Missions · Impact · Evolution").personalText(.secondary, size: 13)
                    }
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, PersonalSpace.s28)
            .padding(.top, PersonalSpace.s20)
            .padding(.bottom, 128)
        }
    }

    private func mileIcon(_ index: Int) -> String {
        ["FigShieldCheck", "FigCreditCard", "FigUtensils"][index % 3]
    }

    private func eventRow(_ icon: String, _ title: String?, _ line: String?, _ miles: String?, _ action: (() -> Void)?) -> some View {
        Button(action: action ?? {}) {
            HStack(spacing: PersonalSpace.s12) {
                FigIcon(name: icon, size: 28)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title ?? "Verified impact").personalText(.primary, size: 15, weight: .bold)
                    if let line { Text(line).personalText(.secondary, size: 13) }
                }
                Spacer()
                if let miles { Text(miles).personalText(.secondary, size: 13, weight: .bold) }
            }
        }
        .buttonStyle(.plain)
        .disabled(action == nil)
    }

    private func eyebrow(_ label: String) -> some View {
        Text(label)
            .font(.custom("Inter-ExtraBold", size: 13))
            .foregroundStyle(colorScheme == .dark ? palette.popoverBorder : palette.textPrimary)
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

    private func link(_ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text("\(label)  →").personalText(.primary, size: 14, weight: .bold)
        }
        .buttonStyle(.plain)
    }

    private var palette: PersonalPalette { colorScheme == .dark ? PersonalTokens.dark : PersonalTokens.light }
}

struct MileSheetsView: View {
    @Binding var stack: [MileStep]
    var store: UiSessionStore
    var outcomeId: String
    var eventId: String
    var onOutcome: (String) -> Void
    var onOpenDecision: (String) -> Void
    @Environment(\.colorScheme) private var colorScheme
    @State private var summary = MileSummary.empty
    @State private var detail: MileTrace?

    var body: some View {
        if let step = stack.last {
            ZStack(alignment: .bottom) {
                Color.black.opacity(0.55)
                    .ignoresSafeArea()
                    .onTapGesture { pop() }
                ScrollView {
                    VStack(alignment: .leading, spacing: PersonalSpace.s16) {
                        HStack {
                            Text(title(step)).personalText(.primary, size: 22, weight: .bold)
                            Spacer()
                            Button(action: pop) {
                                Image(systemName: "xmark")
                                    .foregroundStyle(palette.textPrimary)
                                    .frame(width: 40, height: 40)
                                    .background(palette.surface, in: Circle())
                                    .overlay(Circle().stroke(palette.border, lineWidth: 1))
                            }
                            .buttonStyle(.plain)
                        }
                        switch step {
                        case .outcomes:
                            outcomesBody
                        case .outcome:
                            outcomeBody
                        case .trace:
                            traceBody
                        case .report:
                            reportBody
                        case .lifetime:
                            lifetimeBody
                        }
                    }
                    .padding(PersonalSpace.s20)
                    .padding(.bottom, PersonalSpace.s32)
                }
                .frame(maxHeight: UIScreen.main.bounds.height * 0.92)
                .background(palette.sheet, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
            }
            .task(id: eventId) {
                summary = MileSummary.parse(store.mileSummaryData)
                detail = eventId.isEmpty ? nil : trace(store.mileTrace(eventId))
            }
            .onChange(of: store.mileSummaryData) {
                summary = MileSummary.parse(store.mileSummaryData)
                detail = eventId.isEmpty ? nil : trace(store.mileTrace(eventId))
            }
        }
    }

    private var outcome: MileOutcome? { summary.outcomes.first { $0.id == outcomeId } }

    private func title(_ step: MileStep) -> String {
        switch step {
        case .outcomes: "M.I.L.E. outcomes"
        case .outcome: outcome?.title ?? "Outcome"
        case .trace: "M.I.L.E. event trace"
        case .report: "M.I.L.E. report"
        case .lifetime: "Lifetime M.I.L.E."
        }
    }

    private var outcomesBody: some View {
        VStack(alignment: .leading, spacing: PersonalSpace.s16) {
            if let period = summary.period { Text(period).personalText(.secondary, size: 14) }
            section("IMPACT FROM YOUR ACTIONS")
            if let impact = summary.impact { Text(impact).personalText(.primary, size: 16, weight: .bold) }
            Text(summary.impactLine ?? "Positive financial impact").personalText(.secondary, size: 14)
            section("THIS IMPACT EARNED YOU")
            if let distance = summary.distance { Text(distance).personalText(.primary, size: 16, weight: .bold) }
            section("IMPACT BREAKDOWN")
            ForEach(mileFamilies, id: \.name) { family in
                let match = summary.outcome(named: family.name)
                Button {
                    if let id = match?.id { onOutcome(id) }
                } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(family.name).personalText(.primary, size: 15, weight: .bold)
                            Text(family.line).personalText(.secondary, size: 13)
                        }
                        Spacer()
                        if let amount = match?.amount {
                            Text(amount).personalText(.primary, size: 14, weight: .bold)
                        }
                    }
                }
                .buttonStyle(.plain)
                .disabled(match?.id == nil)
            }
        }
    }

    private var outcomeBody: some View {
        VStack(alignment: .leading, spacing: PersonalSpace.s16) {
            if let line = outcome?.line { Text(line).personalText(.secondary, size: 14) }
            if let amount = outcome?.amount { Text(amount).personalText(.primary, size: 16, weight: .bold) }
            if let share = outcome?.share { Text(share).personalText(.secondary, size: 14) }
            section("THIS IMPACT EARNED YOU")
            if let miles = outcome?.miles { Text(miles).personalText(.primary, size: 16, weight: .bold) }
            section("HOW THIS IMPACT WAS CREATED")
            HStack(spacing: PersonalSpace.s8) {
                stat(outcome?.amount, "Impact")
                stat(outcome?.miles, "MILES")
                stat(outcome?.actions, "Actions")
            }
            section("KEY DRIVERS")
            if let drivers = outcome?.drivers { Text(drivers).personalText(.secondary, size: 14) }
            section("RECENT ACTIONS")
            if let recent = outcome?.recent { Text(recent).personalText(.secondary, size: 14) }
        }
    }

    private var traceBody: some View {
        VStack(alignment: .leading, spacing: PersonalSpace.s16) {
            if let miles = detail?.miles { Text(miles).personalText(.primary, size: 16, weight: .bold) }
            Text(detail?.title ?? "Verified impact").personalText(.primary, size: 16, weight: .bold)
            if let line = detail?.line { Text(line).personalText(.secondary, size: 14) }
            if let whenLabel = detail?.whenLabel { Text(whenLabel).personalText(.secondary, size: 13) }
            section("WHAT CHANGED")
            if let changed = detail?.changed { Text(changed).personalText(.secondary, size: 14) }
            section("WHY THESE MILES EXIST")
            if let decision = detail?.decision { Text(decision).personalText(.secondary, size: 14) }
            if let decisionId = detail?.decisionId {
                gold("View decision details") { onOpenDecision(decisionId) }
            }
        }
    }

    private var reportBody: some View {
        VStack(alignment: .leading, spacing: PersonalSpace.s12) {
            if let year = summary.reportYear { Text(year).personalText(.secondary, size: 14) }
            Text("Your M.I.L.E.").personalText(.primary, size: 16, weight: .bold)
            if let line = summary.reportLine { Text(line).personalText(.secondary, size: 14) }
            if let distance = summary.reportDistance { Text(distance).personalText(.primary, size: 16, weight: .bold) }
            Text("MILES travelled this year").personalText(.secondary, size: 13)
            if let impact = summary.reportImpact { Text(impact).personalText(.secondary, size: 14) }
            section("YOUR YEAR IN NUMBERS")
            ForEach(Array(summary.reportNumbers.enumerated()), id: \.offset) { _, row in
                HStack {
                    Text(row.label).personalText(.secondary, size: 14)
                    Spacer()
                    Text(row.value ?? "0").personalText(.primary, size: 14, weight: .bold)
                }
            }
            section("BIGGEST EVOLUTION")
            if let evolution = summary.reportEvolution { Text(evolution).personalText(.secondary, size: 14) }
        }
    }

    private var lifetimeBody: some View {
        VStack(alignment: .leading, spacing: PersonalSpace.s12) {
            Text("Your Financial Journey").personalText(.primary, size: 16, weight: .bold)
            Text(summary.lifetimeLine ?? "Your financial evolution doesn't reset each year. It keeps building.").personalText(.secondary, size: 14)
            if let distance = summary.lifetimeDistance { Text(distance).personalText(.primary, size: 16, weight: .bold) }
            Text("Lifetime MILES").personalText(.secondary, size: 13)
            if let impact = summary.lifetimeImpact { Text(impact).personalText(.secondary, size: 14) }
            section("DISTANCE BY YEAR")
            ForEach(Array(summary.lifetimeYears.enumerated()), id: \.offset) { _, row in
                HStack {
                    Text(row.label).personalText(.secondary, size: 14)
                    Spacer()
                    Text(row.value ?? "0").personalText(.primary, size: 14, weight: .bold)
                }
            }
            section("WHAT BUILT YOUR DISTANCE")
            ForEach(Array(summary.lifetimeBuilt.enumerated()), id: \.offset) { _, row in
                HStack {
                    Text(row.label).personalText(.secondary, size: 14)
                    Spacer()
                    Text(row.value ?? "0").personalText(.primary, size: 14, weight: .bold)
                }
            }
        }
    }

    private func stat(_ value: String?, _ label: String) -> some View {
        VStack(alignment: .leading, spacing: PersonalSpace.s8) {
            if let value { Text(value).personalText(.primary, size: 14, weight: .bold) }
            Text(label).personalText(.secondary, size: 12)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(PersonalSpace.s16)
        .background(palette.surface, in: RoundedRectangle(cornerRadius: PersonalRadius.card, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: PersonalRadius.card, style: .continuous).stroke(palette.border, lineWidth: 1))
    }

    private func section(_ label: String) -> some View {
        Text(label)
            .font(.custom("Inter-ExtraBold", size: 13))
            .foregroundStyle(colorScheme == .dark ? palette.popoverBorder : palette.textPrimary)
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

    private func pop() { stack.removeLast() }

    private var palette: PersonalPalette { colorScheme == .dark ? PersonalTokens.dark : PersonalTokens.light }
}
