import SwiftUI

/// The owner's money settings: home currency, timezone and country.
///
/// These are the three inputs that decide how the ledger is *read*, and none of them
/// is a ledger write. Changing the home currency changes the converted roll-up; every
/// booked amount keeps its own currency and its own figure. The screen says so twice:
/// once in the footer, and once in the result of a save that leaves accounts in a
/// currency the owner no longer calls home.
struct CurrencySettingsView: View {
    var api: MonytixApi
    var token: (Bool) async -> String?
    var store: UiSessionStore
    var onBack: () -> Void

    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.personalTheme) private var theme
    @State private var preferences: OwnerPreferences?
    @State private var held: [String] = []
    @State private var isDefaultCurrency = true
    @State private var loading = true
    @State private var saving = false
    @State private var error: String?
    @State private var notice: String?
    @State private var currency = ""
    @State private var timezone = ""
    @State private var country = ""

    private var palette: PersonalPalette { colorScheme == .dark ? PersonalTokens.dark : PersonalTokens.light }

    /// Everything the server will accept, plus the codes already held so the picker
    /// never hides one the owner actually has money in.
    private var currencyChoices: [String] {
        var codes = Set(held)
        for code in ["INR", "USD", "EUR", "GBP", "AED", "SGD", "AUD", "CAD"] {
            codes.insert(code)
        }
        if !currency.isEmpty { codes.insert(currency) }
        return codes.sorted()
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: PersonalSpace.s20) {
                header
                if loading {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, PersonalSpace.s32)
                } else {
                    if isDefaultCurrency {
                        firstRunCard
                    }
                    currencyCard
                    timezoneCard
                    countryCard
                    if let notice {
                        Text(notice)
                            .personalText(.secondary, size: 13)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if let error {
                        Text(error)
                            .font(.custom("Inter-SemiBold", size: 13))
                            .foregroundStyle(palette.accent)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    footer
                }
            }
            .padding(.horizontal, PersonalSpace.s20)
            .padding(.top, PersonalSpace.s16)
            .padding(.bottom, PersonalSpace.s32)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .task { await load() }
    }

    private var header: some View {
        HStack(spacing: PersonalSpace.s12) {
            Button(action: onBack) {
                Image(systemName: "chevron.left")
                    .foregroundStyle(palette.textPrimary)
                    .frame(width: 40, height: 40)
            }
            .buttonStyle(.plain)
            VStack(alignment: .leading, spacing: 2) {
                Text("Money settings").personalText(.primary, size: 22, weight: .bold)
                Text("How amounts are read and shown").personalText(.secondary, size: 14)
            }
            Spacer(minLength: 0)
        }
    }

    /// The first-run confirmation. It only appears while the owner has never moved
    /// off the untouched `INR` default, which is exactly when a wrong home currency is
    /// most likely and least visible: every total looks plausible either way.
    private var firstRunCard: some View {
        card {
            Text("Confirm your home currency")
                .personalText(.primary, size: 16, weight: .bold)
            Text("Reports are totalled in this currency. Each transaction keeps the currency it was booked in, so nothing in the ledger changes — only the totals you see.")
                .personalText(.secondary, size: 13)
                .fixedSize(horizontal: false, vertical: true)
            if !held.isEmpty {
                Text("Accounts in this ledger: \(held.joined(separator: ", "))")
                    .personalText(.secondary, size: 13)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var currencyCard: some View {
        card {
            Text("Home currency").personalText(.primary, size: 16, weight: .bold)
            Text("Totals and insights are converted into this currency at each transaction's own date.")
                .personalText(.secondary, size: 13)
                .fixedSize(horizontal: false, vertical: true)
            Picker("Home currency", selection: $currency) {
                ForEach(currencyChoices, id: \.self) { code in
                    Text(label(for: code)).tag(code)
                }
            }
            .pickerStyle(.menu)
            .disabled(saving)
            Button {
                Task { await save(["default_currency_code": currency]) }
            } label: {
                Text(saving ? "Saving" : "Save currency")
                    .font(.custom("Inter-SemiBold", size: 15))
                    .foregroundStyle(PersonalTokens.action.label)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .background(PersonalTokens.action.default, in: Capsule())
            }
            .buttonStyle(.plain)
            .disabled(saving || currency == preferences?.defaultCurrencyCode)
        }
    }

    private var timezoneCard: some View {
        card {
            Text("Timezone").personalText(.primary, size: 16, weight: .bold)
            // A statement alert with no offset is placed by this zone, so it decides
            // which month a late-evening transaction belongs to.
            Text("Decides which date a transaction falls on, and supplies the offset for alerts that carry none.")
                .personalText(.secondary, size: 13)
                .fixedSize(horizontal: false, vertical: true)
            TextField("Asia/Kolkata", text: $timezone)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .disabled(saving)
                .padding(PersonalSpace.s12)
                .background(palette.surface, in: RoundedRectangle(cornerRadius: PersonalRadius.card, style: .continuous))
            Button {
                Task { await save(["timezone_name": timezone]) }
            } label: {
                Text("Save timezone")
                    .font(.custom("Inter-SemiBold", size: 15))
                    .foregroundStyle(PersonalTokens.action.label)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .background(PersonalTokens.action.default, in: Capsule())
            }
            .buttonStyle(.plain)
            .disabled(saving || timezone == preferences?.timezoneName)
        }
    }

    private var countryCard: some View {
        card {
            Text("Country").personalText(.primary, size: 16, weight: .bold)
            // The country is the tiebreaker for `$` and the selector for the wording
            // pack, so it is worth setting even when the currency is already right.
            Text("Resolves an ambiguous currency symbol and picks the alert wording for your market. A two-letter ISO code, or blank to let the sender decide.")
                .personalText(.secondary, size: 13)
                .fixedSize(horizontal: false, vertical: true)
            TextField("IN", text: $country)
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
                .disabled(saving)
                .padding(PersonalSpace.s12)
                .background(palette.surface, in: RoundedRectangle(cornerRadius: PersonalRadius.card, style: .continuous))
            Button {
                Task { await save(["country_code": country.isEmpty ? nil : country.uppercased()]) }
            } label: {
                Text("Save country")
                    .font(.custom("Inter-SemiBold", size: 15))
                    .foregroundStyle(PersonalTokens.action.label)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .background(PersonalTokens.action.default, in: Capsule())
            }
            .buttonStyle(.plain)
            .disabled(saving || country.uppercased() == (preferences?.countryCode ?? ""))
        }
    }

    private var footer: some View {
        Text("Changing these settings never edits a transaction. Booked amounts keep their original currency and figure; only the converted totals and the review prompts change.")
            .personalText(.secondary, size: 12)
            .fixedSize(horizontal: false, vertical: true)
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

    /// A code with its minor units, so `JPY` does not read like a two-decimal currency.
    private func label(for code: String) -> String {
        let units = store.minorUnits(for: code) ?? 2
        let sample = Money.format(Decimal(1234.5), currency: code, minorUnits: units)
        return "\(code) — \(sample)"
    }

    private func load() async {
        loading = true
        defer { loading = false }
        guard let data = await api.getJSON(path: "/v1/owner/preferences", token: token),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            error = "Could not read your preferences."
            return
        }
        apply(root)
    }

    private func apply(_ root: [String: Any]) {
        if let raw = root["preferences"] as? [String: Any] {
            preferences = OwnerPreferences(json: raw)
        }
        held = (root["held_currencies"] as? [String] ?? []).map { $0.uppercased() }
        isDefaultCurrency = (root["is_default_currency"] as? Bool) ?? false
        currency = preferences?.defaultCurrencyCode ?? ""
        timezone = preferences?.timezoneName ?? ""
        country = preferences?.countryCode ?? ""
    }

    private func save(_ patch: [String: Any]) async {
        guard let body = try? JSONSerialization.data(withJSONObject: patch) else { return }
        saving = true
        error = nil
        notice = nil
        defer { saving = false }
        let result = await api.submit(
            method: "PATCH",
            path: "/v1/owner/preferences",
            body: body,
            idempotencyKey: UUID().uuidString,
            token: token
        )
        guard (200..<300).contains(result.status),
              let data = result.data,
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            error = "That value was not accepted."
            return
        }
        apply(root)
        // The warning says *why* a save succeeded but is worth a second look, e.g. the
        // owner moved home to USD while every account is still INR.
        let warnings = root["warnings"] as? [[String: Any]] ?? []
        notice = warnings.compactMap { $0["message"] as? String }.first
        // The bootstrap carries the preferences and the formats every tab reads, so
        // it is reread rather than patched locally.
        await store.prefetch()
    }
}
