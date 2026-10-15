import CryptoKit
import SwiftUI
import UniformTypeIdentifiers

enum AddStep: Equatable {
    case sources
    case upload
    case processing
    case success
    case offline
}

private let unavailable = "Unavailable"
private let maxBytes = 10_485_760
private let banks = ["HDFC", "ICICI", "SBI", "AXIS", "KOTAK", "YES", "+ More"]

private struct ChosenFile {
    let name: String
    let type: String
    let bytes: Data
}

private struct ImportStatus {
    var count: String?
    var stage: String?
    var reached = false
    var done = false
}

struct AddSheetsView: View {
    let api: MonytixApi
    let token: (Bool) async -> String?
    let step: AddStep
    let onStep: (AddStep) -> Void
    let onClose: () -> Void
    let onViewTransactions: () -> Void

    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.openURL) private var openURL
    @State private var chosen: ChosenFile?
    @State private var status = ImportStatus()
    @State private var attempt = 0
    @State private var picking = false
    @State private var gmailNote: String?
    @State private var statementPassword = ""

    private var palette: PersonalPalette { colorScheme == .dark ? PersonalTokens.dark : PersonalTokens.light }

    var body: some View {
        ZStack(alignment: .bottom) {
            Color.black.opacity(0.55).ignoresSafeArea().onTapGesture(perform: onClose)
            VStack(alignment: .leading, spacing: PersonalSpace.s16) {
                HStack {
                    Text(title).personalText(.primary, size: 22, weight: .bold)
                    Spacer()
                    Button(action: onClose) {
                        Image(systemName: "xmark")
                            .foregroundStyle(palette.textPrimary)
                            .frame(width: 40, height: 40)
                            .background(palette.surface, in: Circle())
                            .overlay(Circle().stroke(palette.border, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                }
                content
                Spacer(minLength: 0)
            }
            .padding(PersonalSpace.s20)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(palette.sheet)
            .clipShape(UnevenRoundedRectangle(cornerRadii: .init(topLeading: 28, topTrailing: 28), style: .continuous))
            .frame(maxHeight: UIScreen.main.bounds.height * 0.92)
        }
        .fileImporter(isPresented: $picking, allowedContentTypes: statementTypes) { result in
            if case .success(let url) = result {
                chosen = readStatement(url)
            }
        }
        .task(id: "\(step)-\(attempt)") {
            guard step == .processing, let file = chosen else { return }
            let outcome = await uploadStatement(file, password: statementPassword)
            status = outcome
            if !outcome.reached {
                onStep(.offline)
            } else if outcome.done {
                onStep(.success)
            }
        }
    }

    private var title: String {
        switch step {
        case .sources: "Add data"
        case .upload: "Upload PDF Statement"
        case .processing: "Reading your statement"
        case .success: "Connected Successfully!"
        case .offline: "Lost in the Fog"
        }
    }

    @ViewBuilder private var content: some View {
        switch step {
        case .sources:
            sourceRow("Bank statement", "PDF or CSV") { onStep(.upload) }
            sourceRow("Gmail", "Connect") {
                Task {
                    if let url = await gmailConnectURL() {
                        openURL(url)
                        gmailNote = nil
                    } else {
                        gmailNote = unavailable
                    }
                }
            }
            sourceRow("Account Aggregator", "Coming soon", action: nil)
            if let gmailNote {
                Text(gmailNote).personalText(.secondary, size: 13)
            }
        case .upload:
            Button { picking = true } label: {
                VStack(spacing: PersonalSpace.s8) {
                    Text(chosen?.name ?? "Drag or tap to select your PDF/csv statement")
                        .personalText(.primary, size: 15, weight: .bold)
                    Text("(Max 10MB, password-protected supported)").personalText(.secondary, size: 13)
                }
                .frame(maxWidth: .infinity)
                .padding(PersonalSpace.s16)
                .overlay(RoundedRectangle(cornerRadius: PersonalRadius.card).stroke(palette.border, lineWidth: 1))
            }
            .buttonStyle(.plain)
            SecureField("PDF password, if the file has one", text: $statementPassword)
                .textContentType(.password)
                .personalText(.primary, size: 15)
            Text("SUPPORTED BANKS").personalText(.primary, size: 13, weight: .extraBold)
            FlowWrap(banks)
            gold("Upload & Process  →", enabled: chosen != nil) { onStep(.processing) }
        case .processing:
            Text("While we parse your statement, we're mapping the patterns behind those choices.").personalText(.secondary, size: 14)
            Text(status.count ?? unavailable).personalText(.primary, size: 16, weight: .bold)
            Text(status.stage ?? unavailable).personalText(.secondary, size: 14)
            ForEach(["File uploaded", "Parsing transactions", "Categorizing entries", "Assigning weights"], id: \.self) { label in
                Text(label).personalText(.primary, size: 14)
            }
        case .success:
            Text(unavailable).personalText(.secondary, size: 14)
            Text(status.count ?? unavailable).personalText(.primary, size: 16, weight: .bold)
            Text("Monytix is now assigning weights to your decisions.").personalText(.secondary, size: 14)
            gold("View Transactions  →", enabled: true, onViewTransactions)
            outlined("Set Up Auto-Sync", onClose)
        case .offline:
            Text("No internet connection. Your data is safe — we just can't sync right now.").personalText(.secondary, size: 15)
            gold("Try to Reconnect  →", enabled: true) {
                attempt += 1
                onStep(.processing)
            }
            outlined("Use Offline Mode", onClose)
        }
    }

    private func gmailConnectURL() async -> URL? {
        let response = await api.submit(method: "GET", path: "/gmail/oauth/start", body: nil, idempotencyKey: nil, token: token)
        guard (200..<300).contains(response.status),
              let data = response.data,
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let text = json["url"] as? String,
              let url = URL(string: text), !text.isEmpty else {
            return nil
        }
        return url
    }

    private func sourceRow(_ title: String, _ line: String, action: (() -> Void)?) -> some View {
        let body = VStack(alignment: .leading, spacing: 4) {
            Text(title).personalText(.primary, size: 16, weight: .bold)
            Text(line).personalText(.secondary, size: 13)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(PersonalSpace.s16)
        .background(palette.surface, in: RoundedRectangle(cornerRadius: PersonalRadius.card, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: PersonalRadius.card).stroke(palette.border, lineWidth: 1))
        return Group {
            if let action {
                Button(action: action) { body }.buttonStyle(.plain)
            } else {
                body
            }
        }
    }

    private func gold(_ label: String, enabled: Bool, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(.custom("Inter-Bold", size: 15))
                .foregroundStyle(enabled ? PersonalTokens.action.label : palette.textSecondary)
                .frame(maxWidth: .infinity, minHeight: 48)
                .background(enabled ? PersonalTokens.action.default : palette.border, in: RoundedRectangle(cornerRadius: PersonalRadius.action, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
    }

    private func outlined(_ label: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(.custom("Inter-Bold", size: 15))
                .foregroundStyle(palette.textPrimary)
                .frame(maxWidth: .infinity, minHeight: 48)
                .overlay(RoundedRectangle(cornerRadius: PersonalRadius.action).stroke(palette.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    private func FlowWrap(_ names: [String]) -> some View {
        FlexibleBankRow(names: names, palette: palette)
    }

    private func uploadStatement(_ file: ChosenFile, password: String) async -> ImportStatus {
        let digest = SHA256.hash(data: file.bytes).map { String(format: "%02x", $0) }.joined()
        let payload: [String: Any] = [
            "file_type": file.type,
            "byte_size": file.bytes.count,
            "sha256": digest,
            "original_filename": file.name,
        ]
        guard let body = try? JSONSerialization.data(withJSONObject: payload) else {
            return ImportStatus(reached: true)
        }
        let created = await api.submit(method: "POST", path: "/v1/imports", body: body, idempotencyKey: UUID().uuidString, token: token)
        if created.status == 0 { return ImportStatus() }
        guard (200..<300).contains(created.status),
              let data = jsonObject(created.data)?["data"] as? [String: Any],
              let importId = data["import_id"] as? String,
              let upload = data["upload"] as? [String: Any],
              let url = upload["url"] as? String, !url.isEmpty else {
            return ImportStatus(reached: true)
        }
        var headers: [String: String] = [:]
        if let raw = upload["headers"] as? [String: Any] {
            raw.forEach { key, value in headers[key] = "\(value)" }
        }
        let mime = (data["declared_mime_type"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? mimeType(file.type)
        let put = await api.putSigned(url: url, headers: headers, bytes: file.bytes, contentType: mime)
        if put == 0 { return ImportStatus() }
        if !(200..<300).contains(put) { return ImportStatus(reached: true) }
        let completed = await api.submit(method: "POST", path: "/v1/imports/\(importId)/complete", body: nil, idempotencyKey: UUID().uuidString, token: token)
        if completed.status == 0 { return ImportStatus() }
        if !(200..<300).contains(completed.status) { return ImportStatus(reached: true) }
        let secret = password.trimmingCharacters(in: .whitespacesAndNewlines)
        var opened = secret.isEmpty
        var latest = ImportStatus(reached: true)
        for attempt in 0..<8 {
            if attempt > 0 {
                try? await Task.sleep(nanoseconds: 3_000_000_000)
            }
            let read = await api.submit(method: "GET", path: "/v1/imports/\(importId)/status", body: nil, idempotencyKey: nil, token: token)
            if read.status == 0 { return ImportStatus() }
            if !(200..<300).contains(read.status) { return ImportStatus(reached: true) }
            latest = readStatus(read.data)
            let failure = extractionFailure(read.data)
            if !opened && parserEligible(read.data) {
                guard let body = try? JSONSerialization.data(withJSONObject: ["statement_password": secret]) else {
                    return ImportStatus(count: latest.count, stage: latest.stage, reached: true)
                }
                let open = await api.submit(method: "POST", path: "/v1/imports/\(importId)/open", body: body, idempotencyKey: UUID().uuidString, token: token)
                if open.status == 409 { continue }
                if open.status == 422 { return ImportStatus(count: latest.count, stage: "Wrong PDF password", reached: true) }
                if !(200..<300).contains(open.status) { return ImportStatus(count: latest.count, stage: latest.stage, reached: true) }
                opened = true
                continue
            }
            if failure == "PASSWORD_REJECTED" && secret.isEmpty {
                return ImportStatus(count: latest.count, stage: "PDF password required", reached: true)
            }
            if !secret.isEmpty && !opened { continue }
            if latest.done && failure != "PASSWORD_REJECTED" { return latest }
        }
        return latest
    }
}

private func jsonObject(_ data: Data?) -> [String: Any]? {
    guard let data, let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
    return object
}

private func readStatus(_ data: Data?) -> ImportStatus {
    guard let root = jsonObject(data), let body = root["data"] as? [String: Any] else {
        return ImportStatus(reached: true, done: true)
    }
    let count = body["imported_transaction_count"].map { "\($0)" }.flatMap { $0 == "nil" || $0.isEmpty ? nil : $0 }
    let stage = (body["stage"] as? String).flatMap { $0.isEmpty ? nil : $0 }
    return ImportStatus(count: count, stage: stage, reached: true, done: true)
}

private func extractionFailure(_ data: Data?) -> String? {
    guard let body = jsonObject(data)?["data"] as? [String: Any] else { return nil }
    if let direct = body["extraction_failure"] as? String, !direct.isEmpty { return direct }
    let reconciliation = body["reconciliation"] as? [String: Any]
    return (reconciliation?["extraction_failure"] as? String).flatMap { $0.isEmpty ? nil : $0 }
}

private func parserEligible(_ data: Data?) -> Bool {
    let body = jsonObject(data)?["data"] as? [String: Any]
    return body?["parser_eligible"] as? Bool ?? false
}

private let statementTypes: [UTType] = [
    .pdf,
    .commaSeparatedText,
    UTType(filenameExtension: "xlsx") ?? .data,
    UTType(filenameExtension: "xls") ?? .data,
]

private func statementType(_ name: String) -> String {
    let lower = name.lowercased()
    if lower.hasSuffix(".pdf") { return "PDF" }
    if lower.hasSuffix(".csv") { return "CSV" }
    if lower.hasSuffix(".xlsx") { return "XLSX" }
    if lower.hasSuffix(".xls") { return "XLS" }
    return ""
}

private func mimeType(_ type: String) -> String {
    switch type {
    case "PDF": return "application/pdf"
    case "XLSX": return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    case "XLS": return "application/vnd.ms-excel"
    default: return "text/csv"
    }
}

private func readStatement(_ url: URL) -> ChosenFile? {
    let accessed = url.startAccessingSecurityScopedResource()
    defer { if accessed { url.stopAccessingSecurityScopedResource() } }
    let name = url.lastPathComponent
    let type = statementType(name)
    guard !type.isEmpty, let bytes = try? Data(contentsOf: url), !bytes.isEmpty, bytes.count <= maxBytes else { return nil }
    return ChosenFile(name: String(name.prefix(255)), type: type, bytes: bytes)
}

private struct FlexibleBankRow: View {
    let names: [String]
    let palette: PersonalPalette

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 72), spacing: PersonalSpace.s8)], spacing: PersonalSpace.s8) {
            ForEach(names, id: \.self) { name in
                Text(name)
                    .personalText(.secondary, size: 12, weight: .bold)
                    .padding(.horizontal, PersonalSpace.s12)
                    .padding(.vertical, PersonalSpace.s8)
                    .overlay(Capsule().stroke(palette.border, lineWidth: 1))
            }
        }
    }
}
