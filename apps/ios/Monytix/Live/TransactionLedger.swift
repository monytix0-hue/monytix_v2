import SwiftUI

struct LedgerTransaction: Identifiable, Equatable {
    let id: String
    let amount: String?
    let currency: String?
    let direction: String?
    let transactionDate: String?
    let description: String?
    let categoryName: String?
    let subcategoryName: String?
    let accountName: String?
    let weightName: String?
    let reference: String?

    func withLabels(categoryName: String?, subcategoryName: String?, weightName: String?) -> LedgerTransaction {
        LedgerTransaction(
            id: id,
            amount: amount,
            currency: currency,
            direction: direction,
            transactionDate: transactionDate,
            description: description,
            categoryName: categoryName,
            subcategoryName: subcategoryName,
            accountName: accountName,
            weightName: weightName,
            reference: reference
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
                            MonthSummaryCarousel(months: insights.months, currency: insights.currency)
                        }
                        if showSummary && insightsKnown {
                            SpendingChartCard(insights: insights) {
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
                    creditColor: creditColor,
                    onBack: { self.selected = nil },
                    onSave: { categoryCode, subcategoryCode in
                        await saveCategory(id: selected.id, category: categoryCode, subcategory: subcategoryCode)
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
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Text(money(row))
                    .font(.custom("Inter-SemiBold", size: 15))
                    .foregroundStyle(row.direction == "IN" ? creditColor : palette.textPrimary)
                    .multilineTextAlignment(.trailing)
                    .fixedSize(horizontal: true, vertical: false)
            }
        }
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

    private func saveCategory(id: String, category categoryCode: String, subcategory subcategoryCode: String?) async -> Bool {
        var payload: [String: Any] = [
            "category_id": categoryCode,
            "apply_to_past": false,
            "match_scope": "EXACT_MERCHANT",
        ]
        if let subcategoryCode {
            payload["subcategory_id"] = subcategoryCode
        }
        guard let body = try? JSONSerialization.data(withJSONObject: payload) else { return false }
        let result = await api.submit(
            method: "PATCH",
            path: "/v1/transactions/\(id)/category",
            body: body,
            idempotencyKey: UUID().uuidString,
            token: token
        )
        guard (200..<300).contains(result.status) else { return false }
        let chosen = categories.first { $0.code == categoryCode }
        let categoryName = chosen?.name
        let subcategoryName = chosen?.subcategories.first { $0.code == subcategoryCode }?.name
        if let data = await api.getJSON(path: path(cursor: nil), token: token),
           let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            items = parseItems(root)
            nextCursor = root["nextCursor"] as? String
            known = true
        }
        if let fresh = items.first(where: { $0.id == id }) {
            selected = fresh
        } else if let current = selected, current.id == id {
            selected = current.withLabels(categoryName: categoryName, subcategoryName: subcategoryName, weightName: current.weightName)
        }
        if let index = items.firstIndex(where: { $0.id == id }), let selected, selected.id == id {
            items[index] = selected
        }
        if let store {
            await MainActor.run { store.invalidateInsights() }
        }
        await loadInsights()
        return true
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
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let rows = root["categories"] as? [[String: Any]] else {
            return
        }
        categories = rows.compactMap { row in
            guard let code = row["code"] as? String, let name = row["name"] as? String else { return nil }
            let subs = (row["subcategories"] as? [[String: Any]] ?? []).compactMap { sub -> TransactionChoice? in
                guard let subCode = sub["code"] as? String, let subName = sub["name"] as? String else { return nil }
                return TransactionChoice(code: subCode, name: subName)
            }
            return TransactionCategory(code: code, name: name, subcategories: subs)
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
                amount: row["amount"] as? String,
                currency: (row["currency"] as? String)?.trimmingCharacters(in: .whitespaces),
                direction: row["direction"] as? String,
                transactionDate: row["transactionDate"] as? String,
                description: row["description"] as? String,
                categoryName: row["categoryName"] as? String,
                subcategoryName: row["subcategoryName"] as? String,
                accountName: row["accountName"] as? String,
                weightName: row["weightName"] as? String,
                reference: row["reference"] as? String
            )
        }
    }

    private func icon(_ direction: String?) -> String {
        if direction == "IN" { return "FigCashArrow" }
        if direction == "OUT" { return "FigUtensils" }
        return "FigTxUser"
    }

    private func money(_ row: LedgerTransaction) -> String {
        guard let amount = row.amount, let value = Double(amount.replacingOccurrences(of: ",", with: "")) else {
            return "Not recorded"
        }
        let number = NumberFormatter()
        number.numberStyle = .decimal
        number.minimumFractionDigits = 2
        number.maximumFractionDigits = 2
        number.locale = .current
        let text = number.string(from: NSNumber(value: value)) ?? amount
        let currency = row.currency ?? ""
        return currency.isEmpty ? text : "\(currency) \(text)"
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
    var creditColor: Color
    var onBack: () -> Void
    var onSave: (String, String?) async -> Bool
    @Environment(\.colorScheme) private var colorScheme
    @State private var picking = false
    @State private var chosen: TransactionCategory?
    @State private var saving = false

    private var palette: PersonalPalette { colorScheme == .dark ? PersonalTokens.dark : PersonalTokens.light }

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
                    Text("Transaction").personalText(.primary, size: 22, weight: .bold)
                }
                VStack(alignment: .leading, spacing: PersonalSpace.s12) {
                    HStack(spacing: PersonalSpace.s12) {
                        FigIcon(name: row.direction == "IN" ? "FigCashArrow" : (row.direction == "OUT" ? "FigUtensils" : "FigTxUser"), size: 28)
                        Text(amount)
                            .font(.custom("Inter-Bold", size: 28))
                            .foregroundStyle(row.direction == "IN" ? creditColor : palette.textPrimary)
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
                    fact("Date", displayDate)
                    fact("Type", row.direction == "IN" ? "Credit" : (row.direction == "OUT" ? "Debit" : "Not recorded"))
                    Button {
                        chosen = nil
                        picking = true
                    } label: {
                        fact("Category", recorded(row.categoryName))
                    }
                    .buttonStyle(.plain)
                    .disabled(categories.isEmpty || saving)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    fact("Subcategory", recorded(row.subcategoryName))
                    fact("Account", recorded(row.accountName))
                    if let weight = row.weightName, !weight.isEmpty {
                        fact("Weight", weight)
                    }
                    fact("Reference", recorded(row.reference))
                }
                .background(palette.surface, in: RoundedRectangle(cornerRadius: PersonalRadius.card, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: PersonalRadius.card, style: .continuous)
                        .stroke(palette.border, lineWidth: 1)
                )
            }
            .padding(.horizontal, PersonalSpace.s20)
            .padding(.top, PersonalSpace.s16)
            .padding(.bottom, PersonalSpace.s32)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(palette.canvas)
        .sheet(isPresented: $picking) { categorySheet }
    }

    private var categorySheet: some View {
        NavigationStack {
            List {
                if let chosen {
                    if chosen.subcategories.isEmpty {
                        Button(chosen.name) { Task { await commit(chosen.code, nil) } }
                    } else {
                        ForEach(chosen.subcategories) { sub in
                            Button(sub.name) { Task { await commit(chosen.code, sub.code) } }
                        }
                    }
                } else {
                    ForEach(categories) { category in
                        Button(category.name) {
                            if category.subcategories.isEmpty {
                                Task { await commit(category.code, nil) }
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
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func commit(_ category: String, _ subcategory: String?) async {
        saving = true
        defer { saving = false }
        if await onSave(category, subcategory) {
            picking = false
        }
    }

    private var amount: String {
        guard let raw = row.amount, let value = Double(raw.replacingOccurrences(of: ",", with: "")) else {
            return "Not recorded"
        }
        let number = NumberFormatter()
        number.numberStyle = .decimal
        number.minimumFractionDigits = 2
        number.maximumFractionDigits = 2
        number.locale = .current
        let text = number.string(from: NSNumber(value: value)) ?? raw
        let currency = row.currency ?? ""
        return currency.isEmpty ? text : "\(currency) \(text)"
    }

    private var displayDate: String {
        guard let iso = row.transactionDate else { return "Not recorded" }
        let parser = DateFormatter()
        parser.calendar = Calendar(identifier: .gregorian)
        parser.locale = Locale(identifier: "en_US_POSIX")
        parser.dateFormat = "yyyy-MM-dd"
        guard let date = parser.date(from: iso) else { return iso }
        let formatter = DateFormatter()
        formatter.locale = .current
        formatter.setLocalizedDateFormatFromTemplate("d MMMM yyyy")
        return formatter.string(from: date)
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
}
