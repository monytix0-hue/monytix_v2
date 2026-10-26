import SwiftUI

enum MissionPage {
    case home
    case create
}

enum MissionStep: Equatable {
    case options(String)
    case setup(String)
    case detail
    case progress
    case milestone
    case history
    case complete
    case completed
    case somethingElse
}

private struct CatalogMission: Identifiable {
    let name: String
    let code: String
    var id: String { code }
}

private struct MissionDirection: Identifiable {
    let name: String
    let line: String
    let focus: String
    let prompt: String
    let missions: [CatalogMission]
    var id: String { name }
}

private let missionDirections: [MissionDirection] = [
    MissionDirection(name: "Build Safety", line: "Emergency buffer · protection", focus: "Build an Emergency Buffer", prompt: "Choose the safety outcome you want to build.", missions: [
        CatalogMission(name: "Build an Emergency Buffer", code: "M01"),
        CatalogMission(name: "Build an Income-Loss Buffer", code: "M02"),
        CatalogMission(name: "Build a Medical Reserve", code: "M03"),
        CatalogMission(name: "Strengthen Insurance Protection", code: "M04"),
        CatalogMission(name: "Prepare for an Unexpected Expense", code: "M05"),
        CatalogMission(name: "Build 6–12 Months of Security", code: "M06"),
    ]),
    MissionDirection(name: "Reduce Debt", line: "Cards · loans · commitments", focus: "Pay Off a Personal Loan Faster", prompt: "Choose the debt outcome you want to work toward.", missions: [
        CatalogMission(name: "Clear Credit-Card Debt", code: "M07"),
        CatalogMission(name: "Pay Off a Personal Loan Faster", code: "M08"),
        CatalogMission(name: "Reduce Home-Loan Burden", code: "M09"),
        CatalogMission(name: "Reduce EMI Pressure", code: "M10"),
        CatalogMission(name: "Cut Recurring Commitments", code: "M11"),
        CatalogMission(name: "Become Debt-Free", code: "M12"),
    ]),
    MissionDirection(name: "Save for Something", line: "Home · vehicle · education", focus: "Build an Education Fund", prompt: "Choose what you want to prepare and save for.", missions: [
        CatalogMission(name: "Build a Home Fund", code: "M13"),
        CatalogMission(name: "Save for a Vehicle", code: "M14"),
        CatalogMission(name: "Build an Education Fund", code: "M15"),
        CatalogMission(name: "Save for a Wedding", code: "M16"),
        CatalogMission(name: "Build a Travel Fund", code: "M17"),
        CatalogMission(name: "Fund a Major Purchase", code: "M18"),
    ]),
    MissionDirection(name: "Build Wealth", line: "Investing · retirement", focus: "Build a Long-Term Corpus", prompt: "Choose the wealth outcome you want to build.", missions: [
        CatalogMission(name: "Start Investing Regularly", code: "M19"),
        CatalogMission(name: "Increase My SIP", code: "M20"),
        CatalogMission(name: "Put Idle Cash to Work", code: "M21"),
        CatalogMission(name: "Build a Long-Term Corpus", code: "M22"),
        CatalogMission(name: "Keep My Portfolio Balanced", code: "M23"),
        CatalogMission(name: "Build My Retirement Corpus", code: "M24"),
    ]),
    MissionDirection(name: "Improve Spending", line: "Dining · shopping · leakage", focus: "Reduce Discretionary Spending", prompt: "Choose the spending pattern you want to improve.", missions: [
        CatalogMission(name: "Reduce Dining Spend", code: "M25"),
        CatalogMission(name: "Control Shopping Spend", code: "M26"),
        CatalogMission(name: "Reduce Entertainment Spend", code: "M27"),
        CatalogMission(name: "Keep Travel Spending Under Control", code: "M28"),
        CatalogMission(name: "Reduce Discretionary Spending", code: "M29"),
        CatalogMission(name: "Stop Financial Leakage", code: "M30"),
    ]),
    MissionDirection(name: "Improve Cash Flow", line: "Salary · surplus · large expenses", focus: "Increase My Savings Rate", prompt: "Choose the cash-flow outcome you want to improve.", missions: [
        CatalogMission(name: "Allocate My Salary Better", code: "M31"),
        CatalogMission(name: "Put Monthly Surplus to Work", code: "M32"),
        CatalogMission(name: "Avoid a Cash Crunch", code: "M33"),
        CatalogMission(name: "Prepare for a Large Upcoming Expense", code: "M34"),
        CatalogMission(name: "Use a Bonus or Windfall Better", code: "M35"),
        CatalogMission(name: "Increase My Savings Rate", code: "M36"),
    ]),
    MissionDirection(name: "Support Life & Family", line: "Children · parents · healthcare", focus: "Support Life & Family", prompt: "Choose the life or family outcome you want to prepare for.", missions: [
        CatalogMission(name: "Build a Fund for My Children", code: "M37"),
        CatalogMission(name: "Support My Parents", code: "M38"),
        CatalogMission(name: "Prepare for Family Healthcare", code: "M39"),
        CatalogMission(name: "Prepare for Family Education", code: "M40"),
        CatalogMission(name: "Build a Family Safety Net", code: "M41"),
        CatalogMission(name: "Prepare for a Family Milestone", code: "M42"),
    ]),
    MissionDirection(name: "Create Freedom", line: "Career break · business · independence", focus: "Create Freedom", prompt: "Choose the freedom you want your finances to help create.", missions: [
        CatalogMission(name: "Prepare for a Career Break", code: "M43"),
        CatalogMission(name: "Prepare to Start a Business", code: "M44"),
        CatalogMission(name: "Prepare to Relocate", code: "M45"),
        CatalogMission(name: "Work Toward Financial Independence", code: "M46"),
        CatalogMission(name: "Retire Earlier", code: "M47"),
        CatalogMission(name: "Build More Financial Flexibility", code: "M48"),
    ]),
]

private let missionCrossLinks = [
    ("Support Life & Family", "Children · parents · healthcare"),
    ("Create Freedom", "Career break · business · independence"),
]

private struct MissionRow: Identifiable {
    let id: String
    let title: String?
    let line: String?
    let progress: String?
    let fraction: Double
}

private struct MissionList {
    var headline: String?
    var summaryLine: String?
    var pills: [String] = []
    var active: [MissionRow] = []
    var completed: [MissionRow] = []

    static func parse(_ data: Data) -> MissionList {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return MissionList()
        }
        let summary = root["summary"] as? [String: Any]
        let ready = (summary?["available"] as? Bool) == true
        return MissionList(
            headline: ready ? summary?["headline"] as? String : nil,
            summaryLine: ready ? summary?["line"] as? String : nil,
            pills: ready ? stringList(summary?["pills"]) : [],
            active: missionRows(root["active"]),
            completed: missionRows(root["completed"])
        )
    }
}

private func stringList(_ value: Any?) -> [String] {
    (value as? [Any] ?? []).compactMap { $0 as? String }
}

private func missionRows(_ value: Any?) -> [MissionRow] {
    (value as? [[String: Any]] ?? []).compactMap { row in
        guard let id = row["id"] as? String, !id.isEmpty else { return nil }
        return MissionRow(
            id: id,
            title: row["title"] as? String,
            line: row["line"] as? String,
            progress: row["progress"] as? String,
            fraction: min(max((row["progress_fraction"] as? NSNumber)?.doubleValue ?? 0, 0), 1)
        )
    }
}

private struct MissionSetup {
    var title: String?
    var basis: String?
    var build: String?
    var weights: [String] = []
    var decisions: [String] = []

    static func parse(_ data: Data?) -> MissionSetup {
        guard let data, let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return MissionSetup()
        }
        return MissionSetup(
            title: root["title"] as? String,
            basis: root["basis"] as? String,
            build: root["build"] as? String,
            weights: stringList(root["weights"]),
            decisions: stringList(root["decisions"])
        )
    }
}

private struct MissionRecord {
    var title: String?
    var line: String?
    var progress: String?
    var state: String?
    var matters: String?
    var impact: String?
    var intelligence: String?
    var recent: String?
    var changed: String?
    var proof: String?
    var unlocks: String?
    var since: String?
    var entries: [(String?, String?)] = []

    static func detail(_ data: Data?) -> MissionRecord {
        guard let data, let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let mission = root["mission"] as? [String: Any] else {
            return MissionRecord()
        }
        return MissionRecord(
            title: mission["title"] as? String,
            line: mission["line"] as? String,
            progress: mission["progress"] as? String,
            state: mission["state"] as? String,
            matters: mission["matters"] as? String,
            impact: mission["impact"] as? String,
            intelligence: mission["intelligence"] as? String,
            recent: mission["recent"] as? String
        )
    }
}

struct MissionHomeView: View {
    var store: UiSessionStore
    var onCreate: () -> Void
    var onActive: (String) -> Void
    var onCompleted: (String) -> Void
    @Environment(\.colorScheme) private var colorScheme

    private var list: MissionList {
        guard let data = store.missionsData else { return MissionList() }
        return MissionList.parse(data)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: PersonalSpace.s20) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Missions").personalText(.primary, size: 22, weight: .bold)
                    Text("The things you’ve chosen to make happen.").personalText(.secondary, size: 15)
                }
                if list.active.isEmpty {
                    Text("Nothing is active yet.").personalText(.secondary, size: 15)
                } else {
                    card {
                        if let line = list.summaryLine {
                            Text(line).personalText(.secondary, size: 13)
                        }
                        Text(list.headline ?? "Active missions").personalText(.primary, size: 16, weight: .bold)
                        if !list.pills.isEmpty {
                            HStack(spacing: PersonalSpace.s8) {
                                ForEach(Array(list.pills.enumerated()), id: \.offset) { _, name in
                                    pill(name)
                                }
                            }
                        }
                    }
                    Text("ACTIVE")
                        .font(.custom("Inter-ExtraBold", size: 13))
                        .foregroundStyle(eyebrow)
                    ForEach(Array(list.active.enumerated()), id: \.element.id) { index, row in
                        activeCard(row, icon: missionIcon(index)) { onActive(row.id) }
                    }
                }
                if let completed = list.completed.first {
                    Button { onCompleted(completed.id) } label: {
                        HStack(spacing: PersonalSpace.s8) {
                            FigIcon(name: "FigCashCheck", size: 18)
                            Text("Completed Missions").personalText(.primary, size: 15, weight: .bold)
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.plain)
                }
                gold("Create a Mission", action: onCreate)
            }
            .padding(.horizontal, PersonalSpace.s20)
            .padding(.top, PersonalSpace.s20)
            .padding(.bottom, 128)
        }
        .task { await store.refreshMissions() }
    }

    private func missionIcon(_ index: Int) -> String {
        ["FigShieldPlus", "FigMissionEmblem", "FigUtensils"][index % 3]
    }

    private func activeCard(_ row: MissionRow, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            card {
                HStack(spacing: PersonalSpace.s12) {
                    FigIcon(name: icon, size: 48)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(row.title ?? "Mission").personalText(.primary, size: 16, weight: .bold)
                        Text(row.line ?? "In progress").personalText(.secondary, size: 14)
                    }
                    Spacer()
                    Text(row.progress ?? "Started").personalText(.primary, size: 16, weight: .bold)
                }
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(palette.border)
                        Capsule().fill(PersonalTokens.action.default).frame(width: max(8, geo.size.width * row.fraction))
                    }
                }
                .frame(height: 8)
                if let line = row.line {
                    Text(line).personalText(.secondary, size: 13)
                }
            }
        }
        .buttonStyle(.plain)
    }

    private func card<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: PersonalSpace.s8, content: content)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(PersonalSpace.s16)
            .background(palette.surface, in: RoundedRectangle(cornerRadius: PersonalRadius.card, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: PersonalRadius.card, style: .continuous).stroke(palette.border, lineWidth: 1))
    }

    private func pill(_ label: String) -> some View {
        Text(label)
            .font(.custom("Inter-Bold", size: 12))
            .foregroundStyle(colorScheme == .dark ? palette.popoverBorder : palette.textPrimary)
            .padding(.horizontal, PersonalSpace.s12)
            .padding(.vertical, PersonalSpace.s8)
            .background(colorScheme == .dark ? palette.surfaceRaised : PersonalTokens.status.lavender, in: Capsule())
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

    private var palette: PersonalPalette { colorScheme == .dark ? PersonalTokens.dark : PersonalTokens.light }
    private var eyebrow: Color { colorScheme == .dark ? palette.popoverBorder : palette.textPrimary }
}

struct MissionCreateView: View {
    var onBack: () -> Void
    var onDirection: (String) -> Void
    var onSomethingElse: () -> Void
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: PersonalSpace.s16) {
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
                    Text("Create a Mission").personalText(.primary, size: 22, weight: .bold)
                }
                Text("What do you want to make happen?").personalText(.primary, size: 16, weight: .bold)
                Text("Choose the closest direction. You can make it yours on the next step.").personalText(.secondary, size: 15)
                ForEach(Array(stride(from: 0, to: missionDirections.count, by: 2)), id: \.self) { index in
                    HStack(alignment: .top, spacing: PersonalSpace.s12) {
                        directionCard(missionDirections[index])
                        directionCard(missionDirections[index + 1])
                    }
                }
                Button(action: onSomethingElse) {
                    card {
                        Text("Something else").personalText(.primary, size: 15, weight: .bold)
                        Text("Tell Monytix in your own words").personalText(.secondary, size: 13)
                    }
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, PersonalSpace.s20)
            .padding(.top, PersonalSpace.s16)
            .padding(.bottom, PersonalSpace.s32)
        }
        .personalCanvas()
    }

    private func directionCard(_ direction: MissionDirection) -> some View {
        Button { onDirection(direction.name) } label: {
            card {
                Text(direction.name).personalText(.primary, size: 15, weight: .bold)
                Text(direction.line).personalText(.secondary, size: 13)
            }
        }
        .buttonStyle(.plain)
    }

    private func card<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: PersonalSpace.s8, content: content)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(PersonalSpace.s16)
            .background(palette.surface, in: RoundedRectangle(cornerRadius: PersonalRadius.card, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: PersonalRadius.card, style: .continuous).stroke(palette.border, lineWidth: 1))
    }

    private var palette: PersonalPalette { colorScheme == .dark ? PersonalTokens.dark : PersonalTokens.light }
}

struct MissionSheetsView: View {
    @Binding var stack: [MissionStep]
    var api: MonytixApi
    var token: (Bool) async -> String?
    var missionId: String
    var onStarted: () -> Void
    var onOpenMile: () -> Void
    @Environment(\.colorScheme) private var colorScheme
    @State private var record = MissionRecord()
    @State private var setup = MissionSetup()
    @State private var currentAmount = ""
    @State private var reachAmount = ""
    @State private var progressAmount = ""
    @State private var progressNote = ""
    @State private var ownWords = ""
    @State private var posting = false

    var body: some View {
        Group {
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
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("Close")
                        }
                        sheet(step)
                    }
                    .padding(PersonalSpace.s20)
                    .padding(.bottom, PersonalSpace.s32)
                }
                .frame(maxHeight: 720)
                .background(palette.sheet, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
            }
            }
        }
        .task(id: missionId) { await loadMission() }
        .task(id: setupName) { await loadSetup() }
    }

    @ViewBuilder
    private func sheet(_ step: MissionStep) -> some View {
        switch step {
        case .options(let name):
            if let direction = missionDirections.first(where: { $0.name == name }) {
                Text(direction.focus).personalText(.primary, size: 16, weight: .bold)
                Text(direction.prompt).personalText(.secondary, size: 15)
                ForEach(Array(stride(from: 0, to: direction.missions.count, by: 2)), id: \.self) { index in
                    HStack(alignment: .top, spacing: PersonalSpace.s12) {
                        missionTile(direction.missions[index])
                        missionTile(direction.missions[index + 1])
                    }
                }
                ForEach(missionCrossLinks, id: \.0) { link in
                    Button { replace(.options(link.0)) } label: {
                        card {
                            Text(link.0).personalText(.primary, size: 15, weight: .bold)
                            Text(link.1).personalText(.secondary, size: 13)
                        }
                    }
                    .buttonStyle(.plain)
                }
                Button(action: pop) {
                    card {
                        Text("Back to Mission directions").personalText(.primary, size: 15, weight: .bold)
                        Text("Choose a different Mission category").personalText(.secondary, size: 13)
                    }
                }
                .buttonStyle(.plain)
            }
        case .setup(let name):
            Text(setup.title ?? name).personalText(.primary, size: 16, weight: .bold)
            Text("A few details help Monytix understand what progress means.").personalText(.secondary, size: 15)
            Text("YOUR TARGET").font(.custom("Inter-ExtraBold", size: 13)).foregroundStyle(eyebrow)
            HStack(spacing: PersonalSpace.s12) {
                amountField("Current", text: $currentAmount)
                amountField("Reach", text: $reachAmount)
            }
            Text("How Monytix understands this").personalText(.primary, size: 16, weight: .bold)
            Text(setup.basis ?? "Choose a reach amount.").personalText(.secondary, size: 15)
            if !setup.weights.isEmpty {
                HStack(spacing: PersonalSpace.s8) {
                    ForEach(setup.weights, id: \.self) { pill($0) }
                }
            }
            if !setup.decisions.isEmpty {
                Text("Related decisions  \(setup.decisions.joined(separator: " · "))").personalText(.secondary, size: 13)
            }
            Text("HOW DO YOU WANT TO BUILD IT?").font(.custom("Inter-ExtraBold", size: 13)).foregroundStyle(eyebrow)
            Text(setup.build ?? "Use what you already have.").personalText(.primary, size: 16, weight: .bold)
            Text("You can change this anytime.").personalText(.secondary, size: 13)
            gold("Start Mission", enabled: reachValue != nil && !posting) {
                Task { await startMission(named: name) }
            }
        case .detail:
            if let line = record.line { Text(line).personalText(.secondary, size: 14) }
            HStack(spacing: PersonalSpace.s8) {
                pill(record.progress ?? "Started")
                pill(record.state == "completed" ? "Complete" : "Active")
            }
            Text(record.title ?? "Mission").personalText(.primary, size: 16, weight: .bold)
            block("WHAT MATTERS NOW", record.matters)
            block("M.I.L.E. IMPACT", record.impact)
            block("CONNECTED INTELLIGENCE", record.intelligence)
            block("RECENT PROGRESS", record.recent)
            HStack(spacing: PersonalSpace.s12) {
                link("View Mission history") { push(.history) }
                link("View latest milestone") { push(.milestone) }
            }
            link("Mission complete") { push(.complete) }
            gold("Add progress") { push(.progress) }
        case .progress:
            Text("HOW MUCH PROGRESS?").font(.custom("Inter-ExtraBold", size: 13)).foregroundStyle(eyebrow)
            amountField("Amount", text: $progressAmount)
            Text("WHERE DID THIS COME FROM?").font(.custom("Inter-ExtraBold", size: 13)).foregroundStyle(eyebrow)
            Text("You are recording progress on \(record.title ?? "this mission").").personalText(.secondary, size: 15)
            Text("IF YOU ADD THIS").font(.custom("Inter-ExtraBold", size: 13)).foregroundStyle(eyebrow)
            Text(record.progress ?? "Started").personalText(.primary, size: 16, weight: .bold)
            Text("NOTE · OPTIONAL").font(.custom("Inter-ExtraBold", size: 13)).foregroundStyle(eyebrow)
            TextField("Add a note", text: $progressNote, axis: .vertical)
                .font(.custom("Inter-Regular", size: 15))
                .foregroundStyle(palette.textPrimary)
                .padding(PersonalSpace.s16)
                .background(palette.surface, in: RoundedRectangle(cornerRadius: PersonalRadius.action, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: PersonalRadius.action, style: .continuous).stroke(palette.border, lineWidth: 1))
            gold("Add progress", enabled: progressValue != nil && !posting) {
                Task { await addProgress() }
            }
        case .milestone:
            block("VERIFIED IMPACT", record.recent)
            block("WHY THIS COUNTS", record.matters)
            block("NEXT MARKER", record.state == "completed" ? "Target reached" : "Keep going toward the reach amount")
            gold("Continue Mission", action: pop)
        case .history:
            block("SINCE YOU STARTED", record.since ?? record.progress)
            Text("TIMELINE").font(.custom("Inter-ExtraBold", size: 13)).foregroundStyle(eyebrow)
            if record.entries.isEmpty {
                Text("No progress recorded yet.").personalText(.secondary, size: 15)
            } else {
                ForEach(Array(record.entries.enumerated()), id: \.offset) { _, entry in
                    card {
                        Text(entry.0 ?? "Progress").personalText(.primary, size: 15, weight: .bold)
                        Text(entry.1 ?? "Progress recorded").personalText(.secondary, size: 13)
                    }
                }
            }
            Text("Every MILE can be traced back to real progress.").personalText(.secondary, size: 14)
        case .complete:
            block("WHAT CHANGED", record.changed)
            block("OUTCOME PROOF", record.proof)
            block("WHAT THIS UNLOCKS", record.unlocks)
            gold("See my M.I.L.E.") {
                stack = []
                onOpenMile()
            }
        case .completed:
            if let line = record.line { Text(line).personalText(.secondary, size: 14) }
            pill(record.progress ?? "Complete")
            Text(record.title ?? "Mission").personalText(.primary, size: 16, weight: .bold)
            block("MISSION RECORD", record.title)
            block("INTELLIGENCE RECORD", record.intelligence)
            block("IMPACT TRACE", record.impact)
            link("View full history") { push(.history) }
        case .somethingElse:
            Text("Tell Monytix in your own words").personalText(.secondary, size: 15)
            Text("This note stays on this screen. It does not create a new mission.").personalText(.secondary, size: 13)
            TextField("Describe what you want to make happen", text: $ownWords, axis: .vertical)
                .font(.custom("Inter-Regular", size: 15))
                .foregroundStyle(palette.textPrimary)
                .padding(PersonalSpace.s16)
                .background(palette.surface, in: RoundedRectangle(cornerRadius: PersonalRadius.action, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: PersonalRadius.action, style: .continuous).stroke(palette.border, lineWidth: 1))
        }
    }

    private func missionTile(_ mission: CatalogMission) -> some View {
        Button { push(.setup(mission.name)) } label: {
            card {
                Text(mission.name).personalText(.primary, size: 14, weight: .bold)
            }
        }
        .buttonStyle(.plain)
    }

    private func title(_ step: MissionStep) -> String {
        switch step {
        case .options, .setup, .somethingElse: "Create a Mission"
        case .detail, .completed: record.title ?? "Mission"
        case .progress: "Add progress"
        case .milestone: "A milestone reached"
        case .history: "Mission history"
        case .complete: "Mission complete"
        }
    }

    private func pop() { if !stack.isEmpty { stack.removeLast() } }
    private func push(_ step: MissionStep) { stack.append(step) }
    private func replace(_ step: MissionStep) {
        if !stack.isEmpty { stack.removeLast() }
        stack.append(step)
    }

    private var setupName: String {
        if case .setup(let name) = stack.last { return name }
        return ""
    }

    private var reachValue: Double? { Double(reachAmount.replacingOccurrences(of: ",", with: "")) }
    private var progressValue: Double? { Double(progressAmount.replacingOccurrences(of: ",", with: "")) }

    private func loadMission() async {
        guard !missionId.isEmpty else {
            record = MissionRecord()
            return
        }
        let detail = await api.getJSON(path: "/v1/ui/missions/\(missionId)", token: token)
        var next = MissionRecord.detail(detail)
        if let journal = await api.getJSON(path: "/v1/ui/missions/\(missionId)/journal", token: token),
           let root = try? JSONSerialization.jsonObject(with: journal) as? [String: Any] {
            next.since = root["since"] as? String
            if let entries = root["entries"] as? [[String: Any]] {
                next.entries = entries.map { ($0["title"] as? String, $0["detail"] as? String) }
            }
        }
        if let completion = await api.getJSON(path: "/v1/ui/missions/\(missionId)/completion", token: token),
           let root = try? JSONSerialization.jsonObject(with: completion) as? [String: Any],
           let mission = root["mission"] as? [String: Any] {
            next.title = next.title ?? (mission["title"] as? String)
            next.changed = mission["changed"] as? String
            next.proof = mission["proof"] as? String
            next.unlocks = mission["unlocks"] as? String
        }
        record = next
    }

    private func loadSetup() async {
        guard let code = missionDirections.flatMap(\.missions).first(where: { $0.name == setupName })?.code else {
            setup = MissionSetup()
            return
        }
        setup = MissionSetup.parse(await api.getJSON(path: "/v1/ui/missions/definitions/\(code)", token: token))
    }

    private func startMission(named name: String) async {
        guard let reach = reachValue,
              let code = missionDirections.flatMap(\.missions).first(where: { $0.name == name })?.code else { return }
        posting = true
        defer { posting = false }
        let current = Double(currentAmount.replacingOccurrences(of: ",", with: "")) ?? 0
        let body: [String: Any] = ["canonical_mission_code": code, "reach_amount": reach, "current_amount": current]
        guard let data = try? JSONSerialization.data(withJSONObject: body) else { return }
        let result = await api.submit(method: "POST", path: "/v1/missions", body: data, idempotencyKey: "mission-create-\(code)", token: token)
        if (200..<300).contains(result.status) { onStarted() }
    }

    private func addProgress() async {
        guard let amount = progressValue, !missionId.isEmpty else { return }
        posting = true
        defer { posting = false }
        var body: [String: Any] = ["action": "ADD_PROGRESS", "amount": amount]
        if !progressNote.isEmpty { body["note"] = progressNote }
        guard let data = try? JSONSerialization.data(withJSONObject: body) else { return }
        let result = await api.submit(
            method: "POST",
            path: "/v1/missions/\(missionId)/actions",
            body: data,
            idempotencyKey: "mission-progress-\(missionId)-\(UUID().uuidString)",
            token: token
        )
        if (200..<300).contains(result.status) {
            progressAmount = ""
            progressNote = ""
            await loadMission()
            pop()
        }
    }

    private func amountField(_ label: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: PersonalSpace.s8) {
            Text(label).personalText(.secondary, size: 13)
            TextField("0", text: text)
                .keyboardType(.decimalPad)
                .font(.custom("Inter-Bold", size: 15))
                .foregroundStyle(palette.textPrimary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(PersonalSpace.s16)
        .background(palette.surface, in: RoundedRectangle(cornerRadius: PersonalRadius.card, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: PersonalRadius.card, style: .continuous).stroke(palette.border, lineWidth: 1))
    }

    private func block(_ title: String, _ value: String? = nil) -> some View {
        VStack(alignment: .leading, spacing: PersonalSpace.s8) {
            Text(title).font(.custom("Inter-ExtraBold", size: 13)).foregroundStyle(eyebrow)
            if let value, !value.isEmpty {
                Text(value).personalText(.primary, size: 16, weight: .bold)
            }
        }
    }

    private func link(_ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(.custom("Inter-SemiBold", size: 14))
                .foregroundStyle(palette.textPrimary)
                .frame(maxWidth: .infinity)
                .padding(.vertical, PersonalSpace.s12)
                .overlay(RoundedRectangle(cornerRadius: PersonalRadius.action, style: .continuous).stroke(palette.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    private func gold(_ label: String, enabled: Bool = true, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(.custom("Inter-Bold", size: 15))
                .foregroundStyle(PersonalTokens.action.label)
                .frame(maxWidth: .infinity, minHeight: 48)
                .background(PersonalTokens.action.default.opacity(enabled ? 1 : 0.4), in: RoundedRectangle(cornerRadius: PersonalRadius.action, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
    }

    private func card<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: PersonalSpace.s8, content: content)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(PersonalSpace.s16)
            .background(palette.surface, in: RoundedRectangle(cornerRadius: PersonalRadius.card, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: PersonalRadius.card, style: .continuous).stroke(palette.border, lineWidth: 1))
    }

    private func pill(_ label: String) -> some View {
        Text(label)
            .font(.custom("Inter-Bold", size: 12))
            .foregroundStyle(colorScheme == .dark ? palette.popoverBorder : palette.textPrimary)
            .padding(.horizontal, PersonalSpace.s12)
            .padding(.vertical, PersonalSpace.s8)
            .background(colorScheme == .dark ? palette.surfaceRaised : PersonalTokens.status.lavender, in: Capsule())
    }

    private var palette: PersonalPalette { colorScheme == .dark ? PersonalTokens.dark : PersonalTokens.light }
    private var eyebrow: Color { colorScheme == .dark ? palette.popoverBorder : palette.textPrimary }
}
