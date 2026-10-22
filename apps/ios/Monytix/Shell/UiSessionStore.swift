import Foundation
import Observation

/// Session-scoped UI snapshots. Prefetched after sign-in so tab remounts render
/// immediately instead of empty-then-fetch on every pill tap.
@Observable
@MainActor
final class UiSessionStore {
    private let api: MonytixApi
    private let token: (Bool) async -> String?

    private(set) var liveData: Data?
    private(set) var decisionsData: Data?
    private(set) var missionsData: Data?
    private(set) var mileSummaryData: Data?
    private(set) var mileEventsData: Data?

    private(set) var liveReady = false
    private(set) var decisionsReady = false
    private(set) var missionsReady = false
    private(set) var mileReady = false

    init(api: MonytixApi, token: @escaping (Bool) async -> String?) {
        self.api = api
        self.token = token
    }

    func prefetch() async {
        async let live: Void = refreshLive()
        async let decisions: Void = refreshDecisions()
        async let missions: Void = refreshMissions()
        async let mile: Void = refreshMile()
        _ = await (live, decisions, missions, mile)
    }

    func refreshLive() async {
        liveData = await api.getJSON(path: "/v1/ui/live", token: token)
        liveReady = true
    }

    func refreshDecisions() async {
        decisionsData = await api.getJSON(path: "/v1/ui/decisions", token: token)
        decisionsReady = true
    }

    func refreshMissions() async {
        missionsData = await api.getJSON(path: "/v1/ui/missions", token: token)
        missionsReady = true
    }

    func refreshMile() async {
        async let summary = api.getJSON(path: "/v1/mile/summary", token: token)
        async let events = api.getJSON(path: "/v1/mile/events", token: token)
        mileSummaryData = await summary
        mileEventsData = await events
        mileReady = true
    }

    func invalidateAfterImport() async {
        await refreshLive()
        await refreshMissions()
    }

    func clear() {
        liveData = nil
        decisionsData = nil
        missionsData = nil
        mileSummaryData = nil
        mileEventsData = nil
        liveReady = false
        decisionsReady = false
        missionsReady = false
        mileReady = false
    }
}
