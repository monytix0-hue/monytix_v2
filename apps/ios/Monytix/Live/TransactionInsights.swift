import Charts
import SwiftUI

// MARK: - Model

struct InsightSlice: Identifiable, Equatable {
    let id: String
    let name: String
    let amount: Double
}

struct InsightCategory: Identifiable, Equatable {
    var id: String { code }
    let code: String
    let name: String
    let total: Double
    let subcategories: [InsightSlice]

    var isRecorded: Bool { code != "none" }
}

struct InsightMonth: Identifiable, Equatable {
    var id: String { month }
    let month: String
    let credit: Double
    let debit: Double
    let opening: Double
    let closing: Double
}

struct InsightTotals: Equatable {
    var credit: Double = 0
    var debit: Double = 0
    var categorisedOutflow: Double = 0
    var uncategorisedOutflow: Double = 0
}

struct LedgerInsights: Equatable {
    let uncategorised: Int
    let currency: String?
    let totals: InsightTotals
    let months: [InsightMonth]
    let categories: [InsightCategory]

    static let empty = LedgerInsights(
        uncategorised: 0,
        currency: nil,
        totals: InsightTotals(),
        months: [],
        categories: []
    )

    var hasSummary: Bool { !months.isEmpty }
    var hasSpending: Bool { categories.contains { $0.total > 0 } }
    var spendingTotal: Double { categories.reduce(0) { $0 + $1.total } }
    var categorisedTotal: Double { categories.filter(\.isRecorded).reduce(0) { $0 + $1.total } }

    /// True when categorised plus uncategorised outflow reconciles with the recorded outflow.
    var reconciles: Bool {
        guard totals.debit > 0 else { return true }
        return abs(spendingTotal - totals.debit) < 0.01
    }

    static func parse(_ data: Data) -> LedgerInsights? {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return parse(root)
    }

    static func parse(_ root: [String: Any]) -> LedgerInsights {
        let uncategorised = (root["uncategorised"] as? NSNumber)?.intValue ?? 0
        let rawCurrency = (root["currency"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
        let currency = (rawCurrency?.isEmpty ?? true) ? nil : rawCurrency
        let totalsRow = root["totals"] as? [String: Any] ?? [:]
        let totals = InsightTotals(
            credit: number(totalsRow["credit"]),
            debit: number(totalsRow["debit"]),
            categorisedOutflow: number(totalsRow["categorisedOutflow"]),
            uncategorisedOutflow: number(totalsRow["uncategorisedOutflow"])
        )

        let monthRows = root["monthlySummary"] as? [[String: Any]] ?? []
        let months = monthRows.compactMap { row -> InsightMonth? in
            guard let month = row["month"] as? String, !month.isEmpty else { return nil }
            return InsightMonth(
                month: month,
                credit: number(row["credit"]),
                debit: number(row["debit"]),
                opening: number(row["openingBalance"]),
                closing: number(row["closingBalance"])
            )
        }

        let analysis = root["spendingAnalysis"] as? [String: Any]
        let categoryMap = analysis?["categories"] as? [String: Any] ?? [:]

        let categories = categoryMap.compactMap { entry -> InsightCategory? in
            guard let body = entry.value as? [String: Any] else { return nil }
            let code = entry.key
            let name = (body["name"] as? String) ?? (code == "none" ? "Not recorded" : code)
            let total = number(body["totalAmount"])
            let names = body["subcategoryNames"] as? [String: Any] ?? [:]
            let subs = body["subcategories"] as? [String: Any] ?? [:]
            let slices = subs.compactMap { sub -> InsightSlice? in
                let amount = number(sub.value)
                guard amount > 0 else { return nil }
                let subName = (names[sub.key] as? String) ?? sub.key
                return InsightSlice(id: "\(code)|\(sub.key)", name: subName, amount: amount)
            }
            .sorted { $0.amount > $1.amount }
            return InsightCategory(code: code, name: name, total: total, subcategories: slices)
        }
        .filter { $0.total > 0 }
        .sorted { $0.total > $1.total }

        return LedgerInsights(uncategorised: uncategorised, currency: currency, totals: totals, months: months, categories: categories)
    }

    private static func number(_ value: Any?) -> Double {
        guard let value else { return 0 }
        if let text = value as? String {
            return Double(text.replacingOccurrences(of: ",", with: "")) ?? 0
        }
        if let number = value as? NSNumber {
            return number.doubleValue
        }
        return 0
    }
}

// MARK: - Palette

enum InsightPalette {
    static func color(_ index: Int, theme: PersonalTheme) -> Color {
        let dark = theme.isDark
        let base: [Color] = dark
            ? [
                Color(insightHex: 0x57F1DB), Color(insightHex: 0xF7C663), Color(insightHex: 0xA98BF5),
                Color(insightHex: 0xFF9F86), Color(insightHex: 0x7FB2FF), Color(insightHex: 0x8BD7C0),
                Color(insightHex: 0xE5AA38), Color(insightHex: 0xCDB9F3),
            ]
            : [
                Color(insightHex: 0x003731), Color(insightHex: 0xE5AA38), Color(insightHex: 0x7C5CD6),
                Color(insightHex: 0xE2765B), Color(insightHex: 0x2F6FD0), Color(insightHex: 0x4FAF95),
                Color(insightHex: 0xB8860B), Color(insightHex: 0x9B86C4),
            ]
        return base[index % base.count]
    }
}

private extension Color {
    init(insightHex: UInt32, alpha: Double = 1) {
        self.init(
            red: Double((insightHex >> 16) & 0xFF) / 255,
            green: Double((insightHex >> 8) & 0xFF) / 255,
            blue: Double(insightHex & 0xFF) / 255,
            opacity: alpha
        )
    }
}

// MARK: - Formatting

enum InsightFormat {
    static func month(_ value: String) -> String {
        guard let date = monthParser.date(from: value) else { return value }
        return monthFormatter.string(from: date)
    }

    static func money(_ value: Double, currency: String?) -> String {
        let number = NumberFormatter()
        number.numberStyle = .decimal
        number.minimumFractionDigits = 2
        number.maximumFractionDigits = 2
        number.locale = .current
        let text = number.string(from: NSNumber(value: abs(value))) ?? String(format: "%.2f", abs(value))
        guard let currency, !currency.isEmpty else { return text }
        return "\(currency) \(text)"
    }

    static func compact(_ value: Double, currency: String?) -> String {
        let number = NumberFormatter()
        number.numberStyle = .decimal
        number.maximumFractionDigits = 1
        number.locale = .current
        let symbol: String
        let scaled: Double
        switch abs(value) {
        case 10_000_000...:
            symbol = "Cr"
            scaled = value / 10_000_000
        case 100_000...:
            symbol = "L"
            scaled = value / 100_000
        case 1_000...:
            symbol = "k"
            scaled = value / 1_000
        default:
            return money(value, currency: currency)
        }
        let text = number.string(from: NSNumber(value: scaled)) ?? String(format: "%.1f", scaled)
        return currency.map { "\($0) \(text)\(symbol)" } ?? "\(text)\(symbol)"
    }

    static func percent(_ value: Double, of total: Double) -> String {
        guard total > 0 else { return "0%" }
        return String(format: "%.0f%%", (value / total) * 100)
    }

    private static let monthParser: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM"
        return formatter
    }()

    private static let monthFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = .current
        formatter.setLocalizedDateFormatFromTemplate("MMMM yyyy")
        return formatter
    }()
}

// MARK: - Month wise summary

struct MonthSummaryCarousel: View {
    var months: [InsightMonth]
    var currency: String?
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.personalTheme) private var theme

    private var palette: PersonalPalette { colorScheme == .dark ? PersonalTokens.dark : PersonalTokens.light }

    var body: some View {
        VStack(alignment: .leading, spacing: PersonalSpace.s8) {
            Text("Month wise")
                .personalText(.secondary, size: 13)
                .padding(.horizontal, PersonalSpace.s4)
            if months.isEmpty {
                emptyCard
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: PersonalSpace.s12) {
                        ForEach(months) { month in
                            card(month)
                                .frame(width: 236)
                        }
                    }
                    .scrollTargetLayout()
                    .padding(.horizontal, PersonalSpace.s4)
                }
                .scrollTargetBehavior(.viewAligned)
            }
        }
    }

    private var emptyCard: some View {
        VStack(alignment: .leading, spacing: PersonalSpace.s8) {
            Text("No recorded months yet")
                .personalText(.primary, size: 16, weight: .bold)
            Text("Once transactions are recorded, monthly credit, debit and balances appear here.")
                .personalText(.secondary, size: 13)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(PersonalSpace.s16)
        .background(palette.surface, in: RoundedRectangle(cornerRadius: PersonalRadius.card, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: PersonalRadius.card, style: .continuous)
                .stroke(palette.border, lineWidth: 1)
        )
        .padding(.horizontal, PersonalSpace.s4)
    }

    private func card(_ month: InsightMonth) -> some View {
        VStack(alignment: .leading, spacing: PersonalSpace.s12) {
            HStack(alignment: .firstTextBaseline) {
                Text(InsightFormat.month(month.month))
                    .personalText(.primary, size: 16, weight: .bold)
                Spacer(minLength: PersonalSpace.s8)
                Text(month.closing >= month.opening ? "Up" : "Down")
                    .personalText(.secondary, size: 12)
            }
            HStack(spacing: PersonalSpace.s16) {
                amount("Credit", month.credit, tone: .mint)
                amount("Debit", month.debit, tone: .coral)
            }
            HStack(spacing: PersonalSpace.s16) {
                amount("Opening", month.opening, tone: nil)
                amount("Closing", month.closing, tone: nil)
            }
            Divider().overlay(palette.divider)
            HStack(spacing: PersonalSpace.s6) {
                Circle()
                    .fill(closingTint(month))
                    .frame(width: 8, height: 8)
                Text(balanceLabel(month))
                    .personalText(.secondary, size: 12)
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(PersonalSpace.s16)
        .background(palette.surface, in: RoundedRectangle(cornerRadius: PersonalRadius.card, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: PersonalRadius.card, style: .continuous)
                .stroke(palette.border, lineWidth: 1)
        )
    }

    private func amount(_ label: String, _ value: Double, tone: PersonalStatusTone?) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .personalText(.secondary, size: 12)
            Text(InsightFormat.compact(value, currency: currency))
                .font(.custom("Inter-SemiBold", size: 15))
                .foregroundStyle(toneColor(tone))
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func toneColor(_ tone: PersonalStatusTone?) -> Color {
        guard let tone else { return palette.textPrimary }
        switch tone {
        case .mint:
            return theme.isDark ? PersonalTokens.status.mint : palette.accent
        case .coral:
            return palette.textPrimary
        case .gold:
            return palette.textPrimary
        case .lavender:
            return palette.textPrimary
        }
    }

    private func closingTint(_ month: InsightMonth) -> Color {
        month.closing >= month.opening ? (theme.isDark ? PersonalTokens.status.mint : palette.accent) : PersonalTokens.status.coralBorder
    }

    private func balanceLabel(_ month: InsightMonth) -> String {
        let delta = month.closing - month.opening
        let sign = delta < 0 ? "−" : "+"
        return "Net \(sign)\(InsightFormat.money(delta, currency: currency))"
    }
}

// MARK: - Spending chart

struct SpendingChartCard: View {
    var insights: LedgerInsights
    var onReviewUncategorised: () -> Void

    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.personalTheme) private var theme
    @State private var drillCode: String?
    @State private var reveal: Double = 0
    @State private var selectedAngle: Double?

    private var palette: PersonalPalette { colorScheme == .dark ? PersonalTokens.dark : PersonalTokens.light }

    private var drilled: InsightCategory? {
        guard let drillCode else { return nil }
        return insights.categories.first { $0.code == drillCode }
    }

    private var slices: [InsightSlice] {
        if let drilled, !drilled.subcategories.isEmpty {
            return drilled.subcategories
        }
        return insights.categories.map {
            InsightSlice(id: $0.code, name: $0.name, amount: $0.total)
        }
    }

    private var total: Double {
        if let drilled, !drilled.subcategories.isEmpty {
            return drilled.total
        }
        return insights.spendingTotal
    }

    private var heading: String {
        drilled.map { "\($0.name) subcategories" } ?? "Spending by category"
    }

    /// Cross-checks the slices against the recorded outflow so a category that failed to resolve
    /// is visible instead of silently shrinking the chart.
    @ViewBuilder
    private var reconciliationNote: some View {
        if insights.totals.debit > 0, drilled == nil {
            Text(
                insights.reconciles
                    ? "Slices match the \(InsightFormat.money(insights.totals.debit, currency: insights.currency)) recorded outflow."
                    : "Slices cover \(InsightFormat.money(insights.spendingTotal, currency: insights.currency)) of \(InsightFormat.money(insights.totals.debit, currency: insights.currency)) recorded outflow."
            )
            .personalText(.secondary, size: 12)
            .fixedSize(horizontal: false, vertical: true)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: PersonalSpace.s16) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(heading)
                        .personalText(.primary, size: 16, weight: .bold)
                    Text("Outflow in the selected dates")
                        .personalText(.secondary, size: 12)
                }
                Spacer(minLength: PersonalSpace.s8)
                if drilled != nil {
                    Button {
                        withAnimation(.easeOut(duration: 0.28)) { drillCode = nil }
                        resetReveal()
                    } label: {
                        Text("All")
                            .font(.custom("Inter-SemiBold", size: 13))
                            .foregroundStyle(palette.accent)
                            .padding(.horizontal, PersonalSpace.s12)
                            .padding(.vertical, PersonalSpace.s6)
                            .background(palette.surfaceRaised, in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Back to all categories")
                }
            }

            if !insights.hasSpending || slices.isEmpty {
                Text("No categorised outflow in this view.")
                    .personalText(.secondary, size: 13)
            } else {
                chart
                legend
                if drilled == nil, insights.totals.uncategorisedOutflow > 0 {
                    Text("\(InsightFormat.percent(insights.totals.uncategorisedOutflow, of: insights.totals.debit)) of recorded outflow has no category yet.")
                        .personalText(.secondary, size: 12)
                        .fixedSize(horizontal: false, vertical: true)
                }
                reconciliationNote
            }

            if insights.uncategorised > 0 {
                Button(action: onReviewUncategorised) {
                    HStack(spacing: PersonalSpace.s8) {
                        Image(systemName: "exclamationmark.circle")
                            .foregroundStyle(palette.textPrimary)
                        Text("\(insights.uncategorised) transaction\(insights.uncategorised == 1 ? "" : "s") need a category — review this")
                            .personalText(.primary, size: 13, weight: .bold)
                            .multilineTextAlignment(.leading)
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 0)
                    }
                    .padding(PersonalSpace.s12)
                    .background(palette.surfaceRaised, in: RoundedRectangle(cornerRadius: PersonalRadius.action, style: .continuous))
                }
                .buttonStyle(.plain)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(PersonalSpace.s16)
        .background(palette.surface, in: RoundedRectangle(cornerRadius: PersonalRadius.card, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: PersonalRadius.card, style: .continuous)
                .stroke(palette.border, lineWidth: 1)
        )
        .onAppear { resetReveal() }
        .onChange(of: drillCode) { _, _ in resetReveal() }
    }

    private var chart: some View {
        Chart {
            ForEach(Array(slices.enumerated()), id: \.element.id) { pair in
                SectorMark(
                    angle: .value("Outflow", max(pair.element.amount, 0) * reveal),
                    innerRadius: .ratio(0.6),
                    angularInset: 2
                )
                .cornerRadius(4)
                .foregroundStyle(InsightPalette.color(pair.offset, theme: theme))
            }
        }
        .chartLegend(.hidden)
        .chartAngleSelection(value: $selectedAngle)
        .frame(height: 200)
        .overlay {
            VStack(spacing: 2) {
                Text(InsightFormat.compact(total, currency: insights.currency))
                    .font(.custom("Inter-Bold", size: 20))
                    .foregroundStyle(palette.textPrimary)
                Text(drilled.map { $0.name } ?? "Total outflow")
                    .personalText(.secondary, size: 12)
                    .lineLimit(1)
            }
            .allowsHitTesting(false)
        }
        .onChange(of: selectedAngle) { _, value in
            guard let value, let tapped = slice(atAngle: value) else { return }
            selectedAngle = nil
            let code = tapped.id.split(separator: "|").first.map(String.init) ?? tapped.id
            guard let category = insights.categories.first(where: { $0.code == code }),
                  !category.subcategories.isEmpty,
                  category.code != drillCode else { return }
            withAnimation(.easeOut(duration: 0.28)) { drillCode = category.code }
        }
        .accessibilityLabel("Spending pie chart")
    }

    private var legend: some View {
        VStack(spacing: PersonalSpace.s8) {
            ForEach(Array(slices.enumerated()), id: \.element.id) { pair in
                Button {
                    drill(into: pair.element)
                } label: {
                    HStack(spacing: PersonalSpace.s8) {
                        Circle()
                            .fill(InsightPalette.color(pair.offset, theme: theme))
                            .frame(width: 10, height: 10)
                        Text(pair.element.name)
                            .personalText(.primary, size: 14)
                            .lineLimit(1)
                        Spacer(minLength: PersonalSpace.s8)
                        Text(InsightFormat.money(pair.element.amount, currency: insights.currency))
                            .font(.custom("Inter-SemiBold", size: 13))
                            .foregroundStyle(palette.textPrimary)
                        Text(percentText(pair.element.amount))
                            .font(.custom("Inter-Regular", size: 12))
                            .foregroundStyle(palette.textSecondary)
                            .frame(width: 44, alignment: .trailing)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(drilled != nil || !canDrill(pair.element))
            }
        }
    }

    private func canDrill(_ slice: InsightSlice) -> Bool {
        guard let category = insights.categories.first(where: { $0.code == slice.id }) else { return false }
        return !category.subcategories.isEmpty
    }

    private func drill(into slice: InsightSlice) {
        guard drilled == nil else { return }
        guard let category = insights.categories.first(where: { $0.code == slice.id }), !category.subcategories.isEmpty else { return }
        withAnimation(.easeOut(duration: 0.28)) { drillCode = category.code }
    }

    private func slice(atAngle angle: Double) -> InsightSlice? {
        guard total > 0 else { return nil }
        var running: Double = 0
        for candidate in slices {
            running += candidate.amount
            if angle <= running { return candidate }
        }
        return slices.last
    }

    private func percentText(_ amount: Double) -> String {
        guard total > 0 else { return "0%" }
        return String(format: "%.0f%%", (amount / total) * 100)
    }

    private func resetReveal() {
        reveal = 0
        withAnimation(.easeOut(duration: 0.7)) { reveal = 1 }
    }
}
