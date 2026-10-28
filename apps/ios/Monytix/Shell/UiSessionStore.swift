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
        insightCache.removeAll()
        liveReady = false
        decisionsReady = false
        missionsReady = false
        mileReady = false
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
