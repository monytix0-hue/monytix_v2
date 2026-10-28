import SwiftUI

struct LedgerTransaction: Identifiable, Equatable {
    let id: String
    let versionId: String?
    let amount: String?
    let currency: String?
    let direction: String?
    let transactionDate: String?
    let description: String?
    let categoryCode: String?
    let categoryName: String?
    let subcategoryCode: String?
    let subcategoryName: String?
    let accountName: String?
    let weightCode: String?
    let weightName: String?
    let reference: String?
    /// The *as stated* pair when the alert named a foreign amount before the issuer
    /// converted it. `nil` means "same as booked", not "unknown".
    let statedAmount: String?
    let statedCurrency: String?
    /// How the parser decided the booked currency, and how sure it was.
    let currencyBasis: String?
    let currencyConfidence: Double?
    /// True when the ledger should offer the "Currency uncertain — review" row
    /// instead of presenting a guessed code as booked truth.
    let currencyUncertain: Bool
}

/// Only the fields the user actually changed travel to the API.
struct TransactionCorrection: Equatable {
    var versionId: String?
    var amount: String?
    var direction: String?
    var occurredAt: String?
    var description: String?
    var categoryCode: String?
    var subcategoryCode: String?
    var weightCode: String?

    var isEmpty: Bool {
        amount == nil && direction == nil && occurredAt == nil && description == nil &&
            categoryCode == nil && subcategoryCode == nil && weightCode == nil
    }

    var payload: [String: Any] {
        var body: [String: Any] = [:]
        if let versionId { body["expected_version_id"] = versionId }
        if let amount { body["amount"] = amount }
        if let direction { body["direction"] = direction }
        if let occurredAt { body["occurred_at"] = occurredAt }
        if let description { body["description"] = description }
        if let categoryCode { body["category_id"] = categoryCode }
        if let subcategoryCode { body["subcategory_id"] = subcategoryCode }
        if let weightCode { body["weight_code"] = weightCode }
        return body
    }
}

/// The editable copy of a row while the user is on the detail screen.
struct TransactionDraft: Equatable {
    var amount: String
    var direction: String
    var date: String
    var description: String
    var categoryCode: String?
    var categoryName: String?
    var subcategoryCode: String?
    var subcategoryName: String?
    var weightCode: String?
    var weightName: String?

    init(row: LedgerTransaction) {
        amount = row.amount?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        direction = row.direction ?? ""
        date = row.transactionDate ?? ""
        description = row.description ?? ""
        categoryCode = row.categoryCode
        categoryName = row.categoryName
        subcategoryCode = row.subcategoryCode
        subcategoryName = row.subcategoryName
        weightCode = row.weightCode
        weightName = row.weightName
    }

    /// Mirrors the ledger's own amount grammar so the server never has to reject it.
    var error: String? {
        let value = amount.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.isEmpty { return "Enter an amount." }
        let pattern = "^(?:0|[1-9]\\d*)(?:\\.\\d{1,4})?$"
        if value.range(of: pattern, options: .regularExpression) == nil {
            return "Amount can have at most four decimals."
        }
        if (Double(value) ?? 0) <= 0 { return "Amount must be more than zero." }
        if direction != "IN" && direction != "OUT" { return "Choose debit or credit." }
        // A missing date is left alone rather than forced, so an old row without
        // one can still have its amount fixed.
        if !date.isEmpty, date.range(of: "^\\d{4}-\\d{2}-\\d{2}$", options: .regularExpression) == nil {
            return "Choose a date."
        }
        if description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return "Enter a description." }
        return nil
    }

    private func changed(_ next: String?, _ current: String?) -> String? {
        let trimmed = next?.trimmingCharacters(in: .whitespacesAndNewlines)
        let before = current?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard let trimmed, !trimmed.isEmpty, trimmed != before else { return nil }
        return trimmed
    }

    func corrections(against row: LedgerTransaction) -> TransactionCorrection {
        let nextSubcategory = changed(subcategoryCode, row.subcategoryCode)
        let nextCategory = changed(categoryCode, row.categoryCode)
        return TransactionCorrection(
            versionId: row.versionId,
            amount: changed(amount, row.amount),
            direction: changed(direction, row.direction),
            occurredAt: date == (row.transactionDate ?? "") ? nil : "\(date)T00:00:00Z",
            description: changed(description, row.description),
            // The API refuses a subcategory without its category, so a subcategory
            // move always carries the category even when that part is unchanged.
            categoryCode: nextSubcategory != nil ? categoryCode : nextCategory,
            subcategoryCode: nextSubcategory,
            weightCode: changed(weightCode, row.weightCode)
        )
    }
}

struct TransactionChoice: Identifiable, Equatable {
    var id: String { code }
    let code: String
    let name: String
}

struct TransactionCategory: Identifiable, Equatable {
    var id: String { code }
    let code: String
    let name: String
    let subcategories: [TransactionChoice]
}

struct TransactionLedger: View {
    var api: MonytixApi
    var token: (Bool) async -> String?
    var onBack: () -> Void
    var store: UiSessionStore? = nil

    @Environment(\.personalTheme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @State private var items: [LedgerTransaction] = []
    @State private var nextCursor: String?
    @State private var categories: [TransactionCategory] = []
    @State private var weights: [TransactionChoice] = []
    @State private var direction: String?
    @State private var category: String?
    @State private var subcategory: String?
    @State private var from: String?
    @State private var to: String?
    @State private var dateLabel = "All dates"
    @State private var categoriesOpen = false
    @State private var showDates = false
    @State private var customFrom = Date()
    @State private var customTo = Date()
    @State private var selected: LedgerTransaction?
    @State private var known = false
    @State private var loading = false
    @State private var loadingMore = false
    @State private var insights: LedgerInsights = .empty
    @State private var insightsLoading = false
    @State private var insightsKnown = false
    @State private var showSummary = true

    private var palette: PersonalPalette { colorScheme == .dark ? PersonalTokens.dark : PersonalTokens.light }
    private var creditColor: Color { theme.isDark ? PersonalTokens.status.mint : palette.accent }
    private var filtered: Bool { direction != nil || category != nil || from != nil || to != nil }
    private var filterKey: String { [direction ?? "", from ?? "", to ?? "", category ?? "", subcategory ?? ""].joined(separator: "|") }
    private var insightsKey: String { [from ?? "", to ?? ""].joined(separator: "|") }

    var body: some View {
        ZStack {
            VStack(alignment: .leading, spacing: PersonalSpace.s20) {
                backBar
                summary
                filters
                ScrollView {
                    VStack(alignment: .leading, spacing: PersonalSpace.s16) {
                        if showSummary && insightsKnown {
                            MonthSummaryCarousel(
                                months: insights.months,
                                currency: insights.currency,
                                locale: store?.preferences?.moneyLocale ?? .current,
                                minorUnits: store?.minorUnits(for: insights.currency)
                            )
                        }
                        if showSummary && insightsKnown {
                            SpendingChartCard(
                                insights: insights,
                                locale: store?.preferences?.moneyLocale ?? .current,
                                minorUnits: store?.minorUnits(for: insights.currency)
                            ) {
                                showSummary = true
                                direction = nil
                                category = "none"
                                subcategory = nil
                            }
                        }
                        if loading && items.isEmpty {
                            ProgressView().frame(maxWidth: .infinity)
                        } else if items.isEmpty {
                            empty
                        } else {
                            list
                        }
                        if nextCursor != nil {
                            showMore
                        }
                    }
                    .padding(.bottom, PersonalSpace.s32)
                }
            }
            .padding(.horizontal, PersonalSpace.s20)
            .padding(.top, PersonalSpace.s16)
            if let selected {
                TransactionDetail(
                    row: selected,
                    categories: categories,
                    weights: weights,
                    creditColor: creditColor,
                    store: store,
                    onBack: { self.selected = nil },
                    onSave: { correction in
                        await saveTransaction(id: selected.id, correction: correction)
                    },
                    onDelete: {
                        await deleteTransaction(id: selected.id)
                    }
                )
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .task { await loadFilters() }
        .task(id: filterKey) { await reload() }
        .task(id: insightsKey) { await loadInsights() }
        .sheet(isPresented: $showDates) { dateSheet }
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
                Text("Transactions").personalText(.primary, size: 22, weight: .bold)
                Text("Recorded activity").personalText(.secondary, size: 15)
            }
        }
    }

    private var summary: some View {
        card {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Recorded activity").personalText(.secondary, size: 13)
                    Text(summaryText).personalText(.primary, size: 16, weight: .bold)
                }
                Spacer(minLength: PersonalSpace.s8)
                Button {
                    withAnimation(.easeOut(duration: 0.25)) { showSummary.toggle() }
                } label: {
                    Text(showSummary ? "Hide insights" : "Show insights")
                        .font(.custom("Inter-SemiBold", size: 13))
                        .foregroundStyle(palette.accent)
                        .padding(.horizontal, PersonalSpace.s12)
                        .padding(.vertical, PersonalSpace.s6)
                        .background(palette.surfaceRaised, in: Capsule())
                }
                .buttonStyle(.plain)
            }
            if insightsKnown && insights.uncategorised > 0 {
                Button {
                    reviewUncategorised()
                } label: {
                    HStack(spacing: PersonalSpace.s8) {
                        Image(systemName: "exclamationmark.circle")
                            .foregroundStyle(palette.textPrimary)
                        Text("\(insights.uncategorised) not categorised — review this")
                            .personalText(.primary, size: 13, weight: .bold)
                            .multilineTextAlignment(.leading)
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 0)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            if insightsLoading && !insightsKnown {
                ProgressView().frame(maxWidth: .infinity)
            }
        }
    }

    private func reviewUncategorised() {
        direction = nil
        category = "none"
        subcategory = nil
        showSummary = true
    }

    private var summaryText: String {
        if !known { return "Unavailable" }
        if items.isEmpty { return filtered ? "No transactions in this view" : "No recorded transactions" }
        return "Recorded"
    }

    private var filters: some View {
        VStack(alignment: .leading, spacing: PersonalSpace.s12) {
            rail {
                chip(dateLabel, on: from != nil) { showDates = true }
                chip("Credit", on: direction == "IN") { toggleDirection("IN") }
                chip("Debit", on: direction == "OUT") { toggleDirection("OUT") }
                chip("Uncategorised", on: category == "none") { chooseCategory("none") }
                chip(categoryTitle, on: (category != nil && category != "none") || categoriesOpen) { categoriesOpen.toggle() }
            }
            if categoriesOpen {
                rail {
                    ForEach(categories.filter { $0.code != "none" }) { row in
                        chip(row.name, on: category == row.code) { chooseCategory(row.code) }
                    }
                }
            }
            if let category, category != "none", let chosen = categories.first(where: { $0.code == category }), !chosen.subcategories.isEmpty {
                rail {
                    ForEach(chosen.subcategories) { row in
                        chip(row.name, on: subcategory == row.code) { chooseSubcategory(row.code) }
                    }
                }
            }
        }
    }

    private var categoryTitle: String {
        if category == "none" { return "Category" }
        return categories.first { $0.code == category }?.name ?? "Category"
    }

    private var list: some View {
        let groups = Dictionary(grouping: items, by: { $0.transactionDate ?? "" })
        let dates = groups.keys.sorted(by: >)
        return ForEach(dates, id: \.self) { date in
            VStack(alignment: .leading, spacing: PersonalSpace.s8) {
                Text(heading(date)).personalText(.secondary, size: 13)
                ForEach(groups[date] ?? []) { row in
                    Button { selected = row } label: { rowCard(row) }
                        .buttonStyle(.plain)
                }
            }
        }
    }

    private var empty: some View {
        card {
            Text(known ? (filtered ? "No transactions in this view." : "No recorded transactions") : "Unavailable")
                .personalText(.primary, size: 16, weight: .bold)
        }
    }

    private var showMore: some View {
        Button {
            Task { await loadMore() }
        } label: {
            Text(loadingMore ? "Loading" : "Show more")
                .font(.custom("Inter-SemiBold", size: 15))
                .foregroundStyle(palette.accent)
                .frame(maxWidth: .infinity, minHeight: 44)
        }
        .buttonStyle(.plain)
        .disabled(loadingMore)
    }

    private var dateSheet: some View {
        NavigationStack {
            List {
                Button("All dates") { applyDates(nil, nil, "All dates") }
                Button("This month") { applyPreset(months: 0, label: "This month") }
                Button("Last 30 days") { applyPreset(days: 29, label: "Last 30 days") }
                Button("Last 3 months") { applyPreset(months: 3, label: "Last 3 months") }
                DatePicker("From", selection: $customFrom, displayedComponents: .date)
                DatePicker("To", selection: $customTo, displayedComponents: .date)
                Button("Apply dates") {
                    var start = customFrom
                    var end = customTo
                    if start > end { swap(&start, &end) }
                    let label = "\(medium(start)) – \(medium(end))"
                    applyDates(iso(start), iso(end), label)
                }
            }
            .navigationTitle("Date")
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium, .large])
    }

    private func rowCard(_ row: LedgerTransaction) -> some View {
        card {
            HStack(alignment: .top, spacing: PersonalSpace.s12) {
                FigIcon(name: icon(row.direction), size: 28)
                VStack(alignment: .leading, spacing: 4) {
                    Text(row.description ?? "Transaction")
                        .personalText(.primary, size: 16, weight: .bold)
                        .fixedSize(horizontal: false, vertical: true)
                    if let category = row.categoryName, !category.isEmpty {
                        Text(category).personalText(.secondary, size: 13).fixedSize(horizontal: false, vertical: true)
                    } else {
                        HStack(spacing: 4) {
                            Image(systemName: "exclamationmark.circle")
                                .font(.system(size: 11, weight: .semibold))
                            Text("Needs a category — review")
                                .font(.custom("Inter-SemiBold", size: 13))
                        }
                        .foregroundStyle(palette.accent)
                    }
                    if let account = row.accountName, !account.isEmpty {
                        Text(account).personalText(.secondary, size: 13).fixedSize(horizontal: false, vertical: true)
                    }
                    if let weight = row.weightName, !weight.isEmpty {
                        Text(weight).personalText(.secondary, size: 13).fixedSize(horizontal: false, vertical: true)
                    }
                    // A second, independent prompt: the category row above answers
                    // "how is this grouped", this one answers "is the figure right".
                    // Both can be true at once, so this is additive, not either/or.
                    if row.currencyUncertain {
                        currencyUncertainRow(row)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                VStack(alignment: .trailing, spacing: 2) {
                    Text(money(row))
                        .font(.custom("Inter-SemiBold", size: 15))
                        .foregroundStyle(row.direction == "IN" ? creditColor : palette.textPrimary)
                        .multilineTextAlignment(.trailing)
                        .fixedSize(horizontal: true, vertical: false)
                    // The stated side only appears when it differs from the booked side,
                    // so an ordinary domestic alert stays one line.
                    if let stated = statedMoney(row) {
                        Text(stated)
                            .personalText(.secondary, size: 12)
                            .multilineTextAlignment(.trailing)
                            .fixedSize(horizontal: true, vertical: false)
                    }
                }
            }
        }
    }

    /// "Currency uncertain — review", reusing the "Needs a category — review" phrasing
    /// so the two review prompts read as one family rather than two systems.
    ///
    /// The row says what it knows: the detected code and the evidence class that
    /// produced it. "Review" opens the transaction, where the amount is editable.
    private func currencyUncertainRow(_ row: LedgerTransaction) -> some View {
        HStack(spacing: 4) {
            Image(systemName: "exclamationmark.circle")
                .font(.system(size: 11, weight: .semibold))
            Text(currencyReviewLabel(row))
                .font(.custom("Inter-SemiBold", size: 13))
                .fixedSize(horizontal: false, vertical: true)
        }
        .foregroundStyle(palette.accent)
    }

    /// The detected code plus how it was decided, when the API recorded a basis.
    private func currencyReviewLabel(_ row: LedgerTransaction) -> String {
        let code = (row.currency ?? "").trimmingCharacters(in: .whitespaces)
        guard !code.isEmpty else { return "Currency uncertain — review" }
        return "Currency uncertain (\(code)) — review"
    }

    private func rail<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: PersonalSpace.s8, content: content)
        }
    }

    private func chip(_ title: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.custom("Inter-SemiBold", size: 14))
                .foregroundStyle(on ? PersonalTokens.action.label : palette.textSecondary)
                .lineLimit(1)
                .padding(.horizontal, PersonalSpace.s16)
                .padding(.vertical, PersonalSpace.s12)
                .background(on ? PersonalTokens.action.default : palette.surface, in: Capsule())
                .overlay(Capsule().stroke(on ? PersonalTokens.action.default : palette.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
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

    private func toggleDirection(_ value: String) {
        direction = direction == value ? nil : value
    }

    private func chooseCategory(_ code: String) {
        if category == code {
            category = nil
            subcategory = nil
        } else {
            category = code
            subcategory = nil
        }
    }

    private func chooseSubcategory(_ code: String) {
        subcategory = subcategory == code ? nil : code
    }

    private func applyPreset(days: Int? = nil, months: Int? = nil, label: String) {
        let calendar = Calendar.current
        let end = Date()
        let start: Date
        if let months {
            if months == 0 {
                start = calendar.date(from: calendar.dateComponents([.year, .month], from: end)) ?? end
            } else {
                start = calendar.date(byAdding: .month, value: -months, to: end) ?? end
            }
        } else {
            start = calendar.date(byAdding: .day, value: -(days ?? 0), to: end) ?? end
        }
        applyDates(iso(start), iso(end), label)
    }

    private func applyDates(_ start: String?, _ end: String?, _ label: String) {
        from = start
        to = end
        dateLabel = label
        showDates = false
    }

    private func saveTransaction(id: String, correction: TransactionCorrection) async -> Bool {
        guard !correction.isEmpty,
              let body = try? JSONSerialization.data(withJSONObject: correction.payload) else { return false }
        let result = await api.submit(
            method: "PATCH",
            path: "/v1/transactions/\(id)",
            body: body,
            idempotencyKey: UUID().uuidString,
            token: token
        )
        guard (200..<300).contains(result.status) else { return false }
        await refreshAfterWrite()
        return true
    }

    private func deleteTransaction(id: String) async -> Bool {
        let result = await api.submit(
            method: "DELETE",
            path: "/v1/transactions/\(id)",
            body: nil,
            idempotencyKey: UUID().uuidString,
            token: token
        )
        guard (200..<300).contains(result.status) else { return false }
        await refreshAfterWrite()
        return true
    }

    /// A correction or a delete changes this page and the analytics behind the
    /// insight cards, so both are reread from the server rather than patched locally.
    private func refreshAfterWrite() async {
        await loadFilters()
        if let data = await api.getJSON(path: path(cursor: nil), token: token),
           let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            items = parseItems(root)
            nextCursor = root["nextCursor"] as? String
            known = true
        }
        if let store {
            await MainActor.run { store.invalidateInsights() }
        }
        await loadInsights()
    }

    private func reload() async {
        loading = true
        items = []
        nextCursor = nil
        defer { loading = false }
        guard let data = await api.getJSON(path: path(cursor: nil), token: token),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            items = []
            nextCursor = nil
            known = false
            return
        }
        items = parseItems(root)
        nextCursor = root["nextCursor"] as? String
        known = true
    }

    private func loadMore() async {
        guard let cursor = nextCursor, !loadingMore else { return }
        loadingMore = true
        defer { loadingMore = false }
        guard let data = await api.getJSON(path: path(cursor: cursor), token: token),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return
        }
        let page = parseItems(root)
        let seen = Set(items.map(\.id))
        items.append(contentsOf: page.filter { !seen.contains($0.id) })
        nextCursor = root["nextCursor"] as? String
    }

    private func loadFilters() async {
        guard let data = await api.getJSON(path: "/v1/transaction-filters", token: token),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return
        }
        let rows = root["categories"] as? [[String: Any]] ?? []
        categories = rows.compactMap { row in
            guard let code = row["code"] as? String, let name = row["name"] as? String else { return nil }
            let subs = (row["subcategories"] as? [[String: Any]] ?? []).compactMap { sub -> TransactionChoice? in
                guard let subCode = sub["code"] as? String, let subName = sub["name"] as? String else { return nil }
                return TransactionChoice(code: subCode, name: subName)
            }
            return TransactionCategory(code: code, name: name, subcategories: subs)
        }
        let weightRows = root["weights"] as? [[String: Any]] ?? []
        weights = weightRows.compactMap { row in
            guard let code = row["code"] as? String, let name = row["name"] as? String else { return nil }
            return TransactionChoice(code: code, name: name)
        }
    }

    private func loadInsights() async {
        insightsLoading = true
        defer { insightsLoading = false }
        let data: Data?
        if let store {
            data = await store.ledgerInsights(from: from, to: to)
        } else {
            var query: [URLQueryItem] = []
            if let from { query.append(URLQueryItem(name: "from", value: from)) }
            if let to { query.append(URLQueryItem(name: "to", value: to)) }
            var components = URLComponents()
            components.queryItems = query.isEmpty ? nil : query
            let suffix = components.percentEncodedQuery.map { "?\($0)" } ?? ""
            data = await api.getJSON(path: "/v1/ledger/insights\(suffix)", token: token)
        }
        guard let data,
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            insightsKnown = false
            return
        }
        insights = LedgerInsights.parse(root)
        insightsKnown = true
    }

    private func path(cursor: String?) -> String {
        var items = [
            URLQueryItem(name: "limit", value: "30"),
        ]
        if let direction { items.append(URLQueryItem(name: "direction", value: direction)) }
        if let from { items.append(URLQueryItem(name: "from", value: from)) }
        if let to { items.append(URLQueryItem(name: "to", value: to)) }
        if let category { items.append(URLQueryItem(name: "category", value: category)) }
        if let subcategory { items.append(URLQueryItem(name: "subcategory", value: subcategory)) }
        if let cursor { items.append(URLQueryItem(name: "cursor", value: cursor)) }
        var components = URLComponents()
        components.queryItems = items
        return "/v1/transactions?\(components.percentEncodedQuery ?? "")"
    }

    private func parseItems(_ root: [String: Any]) -> [LedgerTransaction] {
        let rows = root["items"] as? [[String: Any]] ?? []
        return rows.compactMap { row in
            guard let id = row["logicalTransactionId"] as? String, !id.isEmpty else { return nil }
            return LedgerTransaction(
                id: id,
                versionId: row["canonicalTransactionVersionId"] as? String,
                amount: row["amount"] as? String,
                currency: (row["currency"] as? String)?.trimmingCharacters(in: .whitespaces),
                direction: row["direction"] as? String,
                transactionDate: row["transactionDate"] as? String,
                description: row["description"] as? String,
                categoryCode: row["categoryCode"] as? String,
                categoryName: row["categoryName"] as? String,
                subcategoryCode: row["subcategoryCode"] as? String,
                subcategoryName: row["subcategoryName"] as? String,
                accountName: row["accountName"] as? String,
                weightCode: row["weightCode"] as? String,
                weightName: row["weightName"] as? String,
                reference: row["reference"] as? String,
                statedAmount: (row["stated"] as? [String: Any])?["amount"] as? String,
                statedCurrency: ((row["stated"] as? [String: Any])?["currency"] as? String)?
                    .trimmingCharacters(in: .whitespaces),
                currencyBasis: row["currencyBasis"] as? String,
                currencyConfidence: (row["currencyConfidence"] as? NSNumber)?.doubleValue,
                currencyUncertain: (row["currencyUncertain"] as? Bool) ?? false
            )
        }
    }

    private func icon(_ direction: String?) -> String {
        if direction == "IN" { return "FigCashArrow" }
        if direction == "OUT" { return "FigUtensils" }
        return "FigTxUser"
    }

    /// The row's booked amount, in the row's own currency.
    ///
    /// The code comes from the row, never from a constant: a USD row in an INR
    /// report is still USD. `minorUnits` comes from `ref.currency` via the
    /// bootstrap, so a zero-decimal currency such as JPY does not grow two zeros.
    private func money(_ row: LedgerTransaction) -> String {
        let code = store?.displayCurrency(row: row.currency) ?? Money.currency(row: row.currency, account: nil, home: nil)
        return Money.format(
            raw: row.amount,
            currency: code,
            locale: store?.preferences?.moneyLocale ?? .current,
            minorUnits: store?.minorUnits(for: code)
        )
    }

    /// The *as stated* figure, shown beside the booked one when the alert named a
    /// different currency. Absent for the ordinary single-currency alert.
    private func statedMoney(_ row: LedgerTransaction) -> String? {
        guard let currency = row.statedCurrency, !currency.isEmpty else { return nil }
        guard let amount = row.statedAmount, !amount.isEmpty else { return nil }
        return Money.format(
            raw: amount,
            currency: currency,
            locale: store?.preferences?.moneyLocale ?? .current,
            minorUnits: store?.minorUnits(for: currency)
        )
    }

    private func heading(_ isoDate: String) -> String {
        guard let date = Self.isoParser.date(from: isoDate) else { return isoDate.isEmpty ? "Not recorded" : isoDate }
        return Self.headingFormatter.string(from: date)
    }

    private func medium(_ date: Date) -> String {
        Self.mediumFormatter.string(from: date)
    }

    private func iso(_ date: Date) -> String {
        Self.isoParser.string(from: date)
    }

    private static let isoParser: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    private static let headingFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = .current
        formatter.setLocalizedDateFormatFromTemplate("d MMMM yyyy")
        return formatter
    }()

    private static let mediumFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = .current
        formatter.setLocalizedDateFormatFromTemplate("d MMM yyyy")
        return formatter
    }()
}

private struct TransactionDetail: View {
    var row: LedgerTransaction
    var categories: [TransactionCategory]
    var weights: [TransactionChoice]
    var creditColor: Color
    var store: UiSessionStore? = nil
    var onBack: () -> Void
    var onSave: (TransactionCorrection) async -> Bool
    var onDelete: () async -> Bool
    @Environment(\.colorScheme) private var colorScheme
    @State private var draft: TransactionDraft
    @State private var pickingCategory = false
    @State private var pickingWeight = false
    @State private var chosen: TransactionCategory?
    @State private var saving = false
    @State private var confirmingDelete = false
    @State private var error: String?

    init(
        row: LedgerTransaction,
        categories: [TransactionCategory],
        weights: [TransactionChoice],
        creditColor: Color,
        store: UiSessionStore? = nil,
        onBack: @escaping () -> Void,
        onSave: @escaping (TransactionCorrection) async -> Bool,
        onDelete: @escaping () async -> Bool
    ) {
        self.row = row
        self.categories = categories
        self.weights = weights
        self.creditColor = creditColor
        self.store = store
        self.onBack = onBack
        self.onSave = onSave
        self.onDelete = onDelete
        _draft = State(initialValue: TransactionDraft(row: row))
    }

    private var palette: PersonalPalette { colorScheme == .dark ? PersonalTokens.dark : PersonalTokens.light }
    private var dirty: Bool { draft != TransactionDraft(row: row) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: PersonalSpace.s20) {
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
                        Text(dirty ? "Edit transaction" : "Transaction")
                            .personalText(.primary, size: 22, weight: .bold)
                        Text("Recorded activity").personalText(.secondary, size: 15)
                    }
                }
                VStack(alignment: .leading, spacing: PersonalSpace.s12) {
                    HStack(spacing: PersonalSpace.s12) {
                        FigIcon(name: draft.direction == "IN" ? "FigCashArrow" : (draft.direction == "OUT" ? "FigUtensils" : "FigTxUser"), size: 28)
                        Text(amount)
                            .font(.custom("Inter-Bold", size: 28))
                            .foregroundStyle(draft.direction == "IN" ? creditColor : palette.textPrimary)
                    }
                    Text(row.description ?? "Transaction")
                        .personalText(.primary, size: 18, weight: .bold)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(PersonalSpace.s16)
                .background(palette.surface, in: RoundedRectangle(cornerRadius: PersonalRadius.card, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: PersonalRadius.card, style: .continuous)
                        .stroke(palette.border, lineWidth: 1)
                )
                VStack(spacing: 0) {
                    field("Amount") {
                        TextField("0.00", text: $draft.amount)
                            .keyboardType(.decimalPad)
                            .personalText(.primary, size: 15, weight: .bold)
                            .multilineTextAlignment(.trailing)
                    }
                    field("Type") {
                        HStack(spacing: PersonalSpace.s8) {
                            chip("Debit", on: draft.direction == "OUT") { draft.direction = "OUT" }
                            chip("Credit", on: draft.direction == "IN") { draft.direction = "IN" }
                        }
                        .frame(maxWidth: .infinity, alignment: .trailing)
                    }
                    field("Date") {
                        HStack(spacing: PersonalSpace.s8) {
                            DatePicker(
                                "",
                                selection: dateBinding,
                                displayedComponents: .date
                            )
                            .labelsHidden()
                            .disabled(saving)
                        }
                        .frame(maxWidth: .infinity, alignment: .trailing)
                    }
                    field("Description") {
                        TextField("What was this?", text: $draft.description, axis: .vertical)
                            .personalText(.primary, size: 15, weight: .bold)
                            .multilineTextAlignment(.trailing)
                            .lineLimit(1...3)
                    }
                    Button {
                        chosen = nil
                        pickingCategory = true
                    } label: {
                        fact("Category", recorded(draft.categoryName))
                    }
                    .buttonStyle(.plain)
                    .disabled(categories.isEmpty || saving)
                    fact("Subcategory", recorded(draft.subcategoryName))
                    Button {
                        pickingWeight = true
                    } label: {
                        fact("Weight", recorded(draft.weightName))
                    }
                    .buttonStyle(.plain)
                    .disabled(weights.isEmpty || saving)
                    fact("Account", recorded(row.accountName))
                    fact("Reference", recorded(row.reference))
                }
                .background(palette.surface, in: RoundedRectangle(cornerRadius: PersonalRadius.card, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: PersonalRadius.card, style: .continuous)
                        .stroke(palette.border, lineWidth: 1)
                )
                if let error {
                    Text(error)
                        .personalText(.secondary, size: 14, weight: .bold)
                        .foregroundStyle(PersonalTokens.status.coralBorder)
                }
                VStack(spacing: PersonalSpace.s12) {
                    Button(action: save) {
                        Text(saving ? "Saving" : "Save changes")
                            .font(.custom("Inter-Bold", size: 16))
                            .foregroundStyle(PersonalTokens.action.label)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, PersonalSpace.s16)
                            .background(
                                saving || !dirty ? PersonalTokens.action.disabledFill : PersonalTokens.action.default,
                                in: RoundedRectangle(cornerRadius: PersonalRadius.action, style: .continuous)
                            )
                    }
                    .buttonStyle(.plain)
                    .disabled(saving || !dirty)
                    Button {
                        confirmingDelete = true
                    } label: {
                        Text("Delete transaction")
                            .font(.custom("Inter-SemiBold", size: 15))
                            .foregroundStyle(PersonalTokens.status.coralBorder)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, PersonalSpace.s12)
                    }
                    .buttonStyle(.plain)
                    .disabled(saving)
                }
            }
            .padding(.horizontal, PersonalSpace.s20)
            .padding(.top, PersonalSpace.s16)
            .padding(.bottom, PersonalSpace.s32)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(palette.canvas)
        .sheet(isPresented: $pickingCategory) { categorySheet }
        .sheet(isPresented: $pickingWeight) { weightSheet }
        .confirmationDialog(
            "Delete this transaction?",
            isPresented: $confirmingDelete,
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) { Task { await remove() } }
            Button("Keep", role: .cancel) {}
        } message: {
            Text("\(recorded(row.description)) will be removed for good. Its totals leave every summary and insight.")
        }
    }

    private var dateBinding: Binding<Date> {
        Binding(
            get: { Self.isoParser.date(from: draft.date) ?? Date() },
            set: { draft.date = Self.isoFormatter.string(from: $0) }
        )
    }

    private var weightSheet: some View {
        NavigationStack {
            List {
                ForEach(weights) { weight in
                    Button(weight.name) {
                        draft.weightCode = weight.code
                        draft.weightName = weight.name
                        pickingWeight = false
                    }
                }
            }
            .navigationTitle("Weight")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { pickingWeight = false }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private var categorySheet: some View {
        NavigationStack {
            List {
                if let chosen {
                    if chosen.subcategories.isEmpty {
                        Button(chosen.name) {
                            draft.categoryCode = chosen.code
                            draft.categoryName = chosen.name
                            draft.subcategoryCode = nil
                            draft.subcategoryName = nil
                            pickingCategory = false
                        }
                    } else {
                        ForEach(chosen.subcategories) { sub in
                            Button(sub.name) {
                                draft.categoryCode = chosen.code
                                draft.categoryName = chosen.name
                                draft.subcategoryCode = sub.code == "none" ? nil : sub.code
                                draft.subcategoryName = sub.name == "Not recorded" ? nil : sub.name
                                pickingCategory = false
                            }
                        }
                    }
                } else {
                    ForEach(categories) { category in
                        Button(category.name) {
                            if category.subcategories.isEmpty {
                                draft.categoryCode = category.code
                                draft.categoryName = category.name
                                draft.subcategoryCode = nil
                                draft.subcategoryName = nil
                                pickingCategory = false
                            } else {
                                self.chosen = category
                            }
                        }
                    }
                }
            }
            .navigationTitle(chosen?.name ?? "Category")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if chosen != nil {
                    ToolbarItem(placement: .topBarLeading) {
                        Button("Categories") { chosen = nil }
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { pickingCategory = false }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func save() {
        if let problem = draft.error {
            error = problem
            return
        }
        let correction = draft.corrections(against: row)
        guard !correction.isEmpty else {
            onBack()
            return
        }
        Task {
            saving = true
            error = nil
            let ok = await onSave(correction)
            saving = false
            if ok {
                onBack()
            } else {
                error = "The change could not be saved."
            }
        }
    }

    private func remove() async {
        saving = true
        let ok = await onDelete()
        saving = false
        if ok {
            onBack()
        } else {
            error = "The transaction could not be deleted."
        }
    }

    private func field<Content: View>(_ label: String, @ViewBuilder content: () -> Content) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: PersonalSpace.s12) {
            Text(label)
                .personalText(.secondary, size: 15)
                .lineLimit(1)
                .fixedSize(horizontal: true, vertical: false)
            content()
                .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .padding(.horizontal, PersonalSpace.s16)
        .padding(.vertical, PersonalSpace.s12)
        .opacity(saving ? 0.55 : 1)
    }

    private func chip(_ title: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.custom("Inter-SemiBold", size: 14))
                .foregroundStyle(on ? PersonalTokens.action.label : palette.textSecondary)
                .lineLimit(1)
                .padding(.horizontal, PersonalSpace.s16)
                .padding(.vertical, PersonalSpace.s8)
                .background(on ? PersonalTokens.action.default : palette.surface, in: Capsule())
                .overlay(Capsule().stroke(on ? PersonalTokens.action.default : palette.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .disabled(saving)
    }

    private var amount: String {
        Money.format(
            raw: draft.amount,
            currency: Money.currency(row: row.currency, account: nil, home: store?.preferences?.defaultCurrencyCode),
            locale: store?.preferences?.moneyLocale ?? .current,
            minorUnits: store?.minorUnits(for: row.currency)
        )
    }

    private func recorded(_ value: String?) -> String {
        let text = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return text.isEmpty ? "Not recorded" : text
    }

    private func fact(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: PersonalSpace.s12) {
            Text(label)
                .personalText(.secondary, size: 15)
                .lineLimit(1)
                .fixedSize(horizontal: true, vertical: false)
            Text(value)
                .personalText(.primary, size: 15, weight: .bold)
                .multilineTextAlignment(.trailing)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .padding(.horizontal, PersonalSpace.s16)
        .padding(.vertical, PersonalSpace.s12)
    }

    private static let isoParser: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    private static let isoFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()
}
