import SwiftUI

enum BusinessDestination: String, CaseIterable, Identifiable {
    case live = "Live"
    case decisions = "Decisions"
    case missions = "Missions"
    case mile = "M.I.L.E."

    var id: String { rawValue }

    fileprivate var glyph: NavGlyph {
        switch self {
        case .live, .mile:
            .pulse
        case .decisions:
            .decisions
        case .missions:
            .missions
        }
    }
}

private enum NavGlyph {
    case pulse
    case decisions
    case missions
}

struct BusinessShellView: View {
    var api: MonytixApi
    var session: any AuthSession
    var store: UiSessionStore
    var onSignOut: () -> Void

    var body: some View {
        Chrome(api: api, session: session, store: store, onSignOut: onSignOut)
            .personalTheme()
    }
}

private struct Chrome: View {
    @Environment(\.personalTheme) private var theme
    var api: MonytixApi
    var session: any AuthSession
    var store: UiSessionStore
    var onSignOut: () -> Void
    @State private var destination = BusinessDestination.live
    @State private var page = LivePage.home
    @State private var missionPage = MissionPage.home
    @State private var missionStack: [MissionStep] = []
    @State private var missionId = ""
    @State private var decisionPage = DecisionPage.home
    @State private var decisionId = ""
    @State private var mileStack: [MileStep] = []
    @State private var mileOutcomeId = ""
    @State private var mileEventId = ""
    @State private var addStep: AddStep?

    var body: some View {
        ZStack(alignment: .bottom) {
            Group {
            if destination == .live, page != .home {
                LiveDetailView(
                    page: page,
                    store: store,
                    api: api,
                    token: { force in await session.idToken(forceRefresh: force) },
                    onBack: { page = .home },
                    onAskMoly: { page = .moly }
                )
            } else if destination == .decisions, decisionPage != .home {
                DecisionFlowView(
                    page: decisionPage,
                    decisionId: decisionId,
                    api: api,
                    token: { force in await session.idToken(forceRefresh: force) },
                    onBack: {
                        switch decisionPage {
                        case .solutions: decisionPage = .confirm
                        case .confirm: decisionPage = .weigh
                        default: decisionPage = .home
                        }
                    },
                    onContinue: { decisionPage = .confirm },
                    onConfirm: { decisionPage = .solutions },
                    onSave: { resetDecisions() }
                )
            } else if destination == .missions, missionPage == .create {
                MissionCreateView(
                    onBack: { missionPage = .home },
                    onDirection: { missionStack = [.options($0)] },
                    onSomethingElse: { missionStack = [.somethingElse] }
                )
            } else {
                VStack(spacing: 0) {
                    header
                    Group {
                        if destination == .live {
                            LiveHomeView(store: store, onOpen: { page = $0 }, onViewMissions: {
                                destination = .missions
                                resetMissions()
                                resetDecisions()
                            }, onViewDecisions: {
                                destination = .decisions
                                resetDecisions()
                            }, onViewMile: {
                                destination = .mile
                                resetMile()
                            })
                        } else if destination == .decisions {
                            DecisionHomeView(
                                store: store,
                                onOpen: {
                                    decisionId = $0
                                    decisionPage = .weigh
                                }
                            )
                        } else if destination == .missions {
                            MissionHomeView(
                                store: store,
                                onCreate: { missionPage = .create },
                                onActive: {
                                    missionId = $0
                                    missionStack = [.detail]
                                },
                                onCompleted: {
                                    missionId = $0
                                    missionStack = [.completed]
                                }
                            )
                        } else if destination == .mile {
                            MileHomeView(
                                store: store,
                                onOutcomes: { mileStack = [.outcomes] },
                                onTrace: {
                                    mileEventId = $0
                                    mileStack = [.trace]
                                },
                                onReport: { mileStack = [.report] },
                                onLifetime: { mileStack = [.lifetime] }
                            )
                        } else {
                            Text(destination.rawValue)
                                .personalText(.primary, size: 25, weight: .extraBold)
                                .frame(maxWidth: .infinity, maxHeight: .infinity)
                                .padding(.bottom, 120)
                        }
                    }
                }
                pill
                    .padding(.horizontal, PersonalSpace.s28)
                    .padding(.bottom, PersonalSpace.s8)
            }
            }
            .overlay(alignment: .bottomTrailing) {
                if addStep == nil {
                    Button {
                        addStep = .sources
                    } label: {
                        Image(systemName: "plus")
                            .font(.system(size: 24, weight: .bold))
                            .foregroundStyle(PersonalTokens.action.label)
                            .frame(width: 56, height: 56)
                            .background(PersonalTokens.action.default, in: Circle())
                    }
                    .buttonStyle(.plain)
                    .padding(.trailing, PersonalSpace.s28)
                    .padding(.bottom, 108)
                    .accessibilityLabel("Add data")
                }
            }
            if destination == .missions, !missionStack.isEmpty {
                MissionSheetsView(
                    stack: $missionStack,
                    api: api,
                    token: { force in await session.idToken(forceRefresh: force) },
                    missionId: missionId
                ) {
                    destination = .mile
                    resetMissions()
                    resetMile()
                }
            }
            if destination == .mile, !mileStack.isEmpty {
                MileSheetsView(
                    stack: $mileStack,
                    api: api,
                    token: { force in await session.idToken(forceRefresh: force) },
                    outcomeId: mileOutcomeId,
                    eventId: mileEventId,
                    onOutcome: {
                        mileOutcomeId = $0
                        mileStack.append(.outcome)
                    },
                    onOpenDecision: {
                        decisionId = $0
                        decisionPage = .weigh
                        destination = .decisions
                        resetMile()
                    }
                )
            }
            if let addStep {
                AddSheetsView(
                    api: api,
                    token: { force in await session.idToken(forceRefresh: force) },
                    step: addStep,
                    onStep: { self.addStep = $0 },
                    onClose: { self.addStep = nil },
                    onImported: {
                        Task { await store.invalidateAfterImport() }
                    },
                    onViewTransactions: {
                        destination = .live
                        page = .transactions
                        self.addStep = nil
                        resetMissions()
                        resetDecisions()
                        resetMile()
                    }
                )
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .personalCanvas()
    }

    private func resetMissions() {
        missionPage = .home
        missionStack = []
        missionId = ""
    }

    private func resetDecisions() {
        decisionPage = .home
        decisionId = ""
    }

    private func resetMile() {
        mileStack = []
        mileOutcomeId = ""
        mileEventId = ""
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: PersonalSpace.s20) {
            Menu {
                Button("Sign out", role: .destructive, action: onSignOut)
            } label: {
                wordmark
            }
            .buttonStyle(.plain)
            HStack {
                Text(greeting)
                    .font(.custom("Inter-SemiBold", size: 16))
                    .foregroundStyle(theme.isDark ? theme.palette.popoverBorder : theme.palette.textSecondary)
                Spacer()
                Button {
                    destination = .live
                    page = .moly
                    resetMissions()
                    resetDecisions()
                    resetMile()
                } label: {
                    HStack(spacing: PersonalSpace.s8) {
                        Image(systemName: "sparkles")
                            .foregroundStyle(PersonalTokens.action.label)
                        Text("MolyBot")
                            .font(.custom("Inter-Bold", size: 16))
                            .foregroundStyle(PersonalTokens.action.label)
                    }
                    .padding(.horizontal, PersonalSpace.s16)
                    .padding(.vertical, PersonalSpace.s12)
                    .background(PersonalTokens.action.default, in: Capsule())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, PersonalSpace.s28)
        .padding(.top, PersonalSpace.s32)
    }

    private var wordmark: some View {
        Image("LiveWordmark")
            .resizable()
            .scaledToFit()
            .frame(height: 27)
            .accessibilityLabel("Monytix")
    }

    private var pill: some View {
        HStack(spacing: 0) {
            ForEach(BusinessDestination.allCases) { item in
                let selected = destination == item
                Button {
                    destination = item
                    page = .home
                    resetMissions()
                    resetDecisions()
                    resetMile()
                } label: {
                    VStack(spacing: 4) {
                        Image(iconName(item.glyph, selected: selected))
                            .resizable()
                            .frame(width: 20, height: 20)
                        Text(item.rawValue)
                            .font(.custom(selected ? "Inter-Bold" : "Inter-SemiBold", size: 14))
                            .foregroundStyle(labelColor(selected: selected))
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 68)
                    .background(cellColor(selected: selected), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(item.rawValue)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 14)
        .background(theme.isDark ? ShellColor.popover : .white, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 26, style: .continuous)
                .stroke(theme.isDark ? ShellColor.border : ShellColor.lightBorder, lineWidth: 1)
        )
        .shadow(color: theme.isDark ? .clear : Color.black.opacity(0.08), radius: 12, y: 4)
    }

    private func cellColor(selected: Bool) -> Color {
        guard selected else { return .clear }
        return theme.isDark ? theme.palette.popoverBorder.opacity(0.1) : ShellColor.selectedLight
    }

    private func labelColor(selected: Bool) -> Color {
        if selected && theme.isDark { return theme.palette.popoverBorder }
        if theme.isDark && !selected { return ShellColor.idle }
        return theme.palette.textPrimary
    }

    private func iconName(_ glyph: NavGlyph, selected: Bool) -> String {
        switch glyph {
        case .pulse:
            if selected { return theme.isDark ? "NavPulseOnDark" : "NavPulseOnLight" }
            return "NavPulse"
        case .decisions:
            if selected { return theme.isDark ? "NavDecisionsOnDark" : "NavDecisionsOnLight" }
            return theme.isDark ? "NavDecisionsDark" : "NavDecisionsLight"
        case .missions:
            if selected { return theme.isDark ? "NavMissionsOnDark" : "NavMissionsOnLight" }
            return theme.isDark ? "NavMissionsDark" : "NavMissionsLight"
        }
    }

    private var greeting: String {
        let hour = Calendar.current.component(.hour, from: Date())
        if hour < 12 { return "Good morning" }
        if hour < 17 { return "Good afternoon" }
        return "Good evening"
    }
}

private enum ShellColor {
    static let popover = Color(red: 7 / 255, green: 17 / 255, blue: 36 / 255)
    static let border = Color(red: 52 / 255, green: 69 / 255, blue: 104 / 255)
    static let lightBorder = Color(red: 217 / 255, green: 215 / 255, blue: 230 / 255)
    static let idle = Color(red: 174 / 255, green: 192 / 255, blue: 217 / 255)
    static let selectedLight = Color(red: 1, green: 226 / 255, blue: 167 / 255)
}
