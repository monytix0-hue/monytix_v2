import Foundation
import Observation

/// Session-scoped UI snapshots. One bootstrap load fills every tab and its sheets.
@Observable
@MainActor
final class UiSessionStore {
    private let api: MonytixApi
    private let token: (Bool) async -> String?

    private(set) var liveData: Data?
    private(set) var decisionsData: Data?
    private(set) var decisionScreensData: Data?
    private(set) var missionsData: Data?
    private(set) var missionScreensData: Data?
    private(set) var missionDefinitionsData: Data?
    private(set) var mileSummaryData: Data?
    private(set) var mileEventsData: Data?

    /// The owner's home currency, timezone and country, from the same single prefetch.
    /// Every money formatter reads `homeCurrency` from here, so no view invents a code.
    private(set) var preferences: OwnerPreferences?
    /// Formatting facts for the currencies this owner holds, keyed by ISO code.
    private(set) var currencyFormats: [String: CurrencyFormat] = [:]

    private(set) var liveReady = false
    private(set) var decisionsReady = false
    private(set) var missionsReady = false
    private(set) var mileReady = false

    private var insightCache: [String: Data] = [:]

    init(api: MonytixApi, token: @escaping (Bool) async -> String?) {
        self.api = api
        self.token = token
    }

    func prefetch() async {
        guard let data = await api.getJSON(path: "/v1/ui/bootstrap", token: token),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            markReady()
            return
        }
        liveData = jsonData(root["live"])
        decisionsData = jsonData(root["decisions"])
        decisionScreensData = jsonData(root["decision_screens"])
        missionsData = jsonData(root["missions"])
        missionScreensData = jsonData(root["mission_screens"])
        missionDefinitionsData = jsonData(root["mission_definitions"])
        mileSummaryData = jsonData(root["mile_summary"])
        mileEventsData = jsonData(root["mile_events"])
        preferences = OwnerPreferences(json: root["preferences"])
        currencyFormats = parseCurrencyFormats(root["currency_formats"])
        markReady()
    }

    func decisionScreen(_ id: String) -> Data? {
        slice(decisionScreensData, id)
    }

    func missionScreen(_ id: String) -> (detail: Data?, journal: Data?, completion: Data?) {
        guard let screen = object(missionScreensData)?[id] as? [String: Any] else {
            return (nil, nil, nil)
        }
        return (jsonData(screen["detail"]), jsonData(screen["journal"]), jsonData(screen["completion"]))
    }

    func missionDefinition(_ code: String) -> Data? {
        slice(missionDefinitionsData, code)
    }

    func mileTrace(_ id: String) -> Data? {
        guard let rows = object(mileEventsData)?["events"] as? [[String: Any]],
              let event = rows.first(where: { $0["id"] as? String == id }) else {
            return nil
        }
        return jsonData(["event": event])
    }

    func invalidateAfterImport() async {
        insightCache.removeAll()
        await prefetch()
    }

    /// Ledger insights are cached per date window so switching filters does not repeat the analytics call.
    func ledgerInsights(from: String?, to: String?) async -> Data? {
        let key = "\(from ?? "")|\(to ?? "")"
        if let cached = insightCache[key] {
            return cached
        }
        var query: [URLQueryItem] = []
        if let from { query.append(URLQueryItem(name: "from", value: from)) }
        if let to { query.append(URLQueryItem(name: "to", value: to)) }
        var components = URLComponents()
        components.queryItems = query.isEmpty ? nil : query
        let suffix = components.percentEncodedQuery.map { "?\($0)" } ?? ""
        guard let data = await api.getJSON(path: "/v1/ledger/insights\(suffix)", token: token) else {
            return nil
        }
        insightCache[key] = data
        return data
    }

    func invalidateInsights() {
        insightCache.removeAll()
    }

    func clear() {
        liveData = nil
        decisionsData = nil
        decisionScreensData = nil
        missionsData = nil
        missionScreensData = nil
        missionDefinitionsData = nil
        mileSummaryData = nil
        mileEventsData = nil
        preferences = nil
        currencyFormats = [:]
        insightCache.removeAll()
        liveReady = false
        decisionsReady = false
        missionsReady = false
        mileReady = false
    }

    /// Minor units for a code, from `ref.currency` when the bootstrap shipped it.
    /// A `nil` answer means "use the platform's default", which is right for every
    /// code the server can detect.
    func minorUnits(for currency: String?) -> Int? {
        guard let code = currency?.uppercased() else { return nil }
        return currencyFormats[code]?.minorUnits
    }

    /// The currency a row should be rendered in: its own, else the home currency.
    func displayCurrency(row: String?, account: String? = nil) -> String? {
        Money.currency(row: row, account: account, home: preferences?.defaultCurrencyCode)
    }

    private func parseCurrencyFormats(_ value: Any?) -> [String: CurrencyFormat] {
        guard let rows = value as? [String: Any] else { return [:] }
        var out: [String: CurrencyFormat] = [:]
        for (code, raw) in rows {
            guard let object = raw as? [String: Any] else { continue }
            let normalised = code.uppercased()
            out[normalised] = CurrencyFormat(
                code: (object["code"] as? String)?.uppercased() ?? normalised,
                displayName: object["displayName"] as? String,
                symbol: object["symbol"] as? String,
                minorUnits: object["minorUnits"] as? Int,
                monetary: object["monetary"] as? Bool
            )
        }
        return out
    }

    private func markReady() {
        liveReady = true
        decisionsReady = true
        missionsReady = true
        mileReady = true
    }

    private func object(_ data: Data?) -> [String: Any]? {
        guard let data else { return nil }
        return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    }

    private func slice(_ data: Data?, _ key: String) -> Data? {
        guard let value = object(data)?[key] else { return nil }
        return jsonData(value)
    }

    private func jsonData(_ value: Any?) -> Data? {
        guard let value, JSONSerialization.isValidJSONObject(value) else { return nil }
        return try? JSONSerialization.data(withJSONObject: value)
    }
}

/// `preferences` inside `/v1/ui/bootstrap`. Mirrors `OwnerPreferences` on the API.
struct OwnerPreferences: Equatable {
    let defaultCurrencyCode: String
    let timezoneName: String
    let countryCode: String?
    let locale: String?

    init?(json: Any?) {
        guard let object = json as? [String: Any],
              let currency = (object["defaultCurrencyCode"] as? String)?.uppercased(),
              !currency.isEmpty else {
            return nil
        }
        defaultCurrencyCode = currency
        timezoneName = (object["timezoneName"] as? String) ?? "UTC"
        countryCode = (object["countryCode"] as? String)?.uppercased()
        locale = object["locale"] as? String
    }

    init(defaultCurrencyCode: String, timezoneName: String, countryCode: String?, locale: String?) {
        self.defaultCurrencyCode = defaultCurrencyCode.uppercased()
        self.timezoneName = timezoneName
        self.countryCode = countryCode?.uppercased()
        self.locale = locale
    }

    /// The `Locale` the device should format money with, honouring an explicit owner
    /// locale before falling back to the device's own.
    var moneyLocale: Locale {
        guard let locale, !locale.isEmpty else { return .current }
        return Locale(identifier: locale)
    }
}
