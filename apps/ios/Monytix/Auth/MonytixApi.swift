import Foundation

enum ConfirmResult {
    case confirmed
    case skipped
    case rejected(String)
}

final class MonytixApi {
    private let baseURL: String
    private let session = URLSession(configuration: .ephemeral)
    private var cache: [String: Data] = [:]

    init(baseURL: String) {
        self.baseURL = baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func fromBundle() -> MonytixApi {
        let value = Bundle.main.object(forInfoDictionaryKey: "MonytixAPIBaseURL") as? String ?? ""
        return MonytixApi(baseURL: value)
    }

    func cancelPending() {
        session.getAllTasks { tasks in
            tasks.forEach { $0.cancel() }
        }
    }

    func clearCache() {
        cache.removeAll()
    }

    func confirmSession(token: (Bool) async -> String?) async -> ConfirmResult {
        if baseURL.isEmpty {
            return .skipped
        }
        let status = await send(method: "GET", path: "/auth", body: nil, idempotencyKey: nil, token: token)
        if (200..<300).contains(status) {
            return .confirmed
        }
        return .rejected("Sign-in could not be confirmed.")
    }

    func send(
        method: String,
        path: String,
        body: Data?,
        idempotencyKey: String?,
        token: (Bool) async -> String?
    ) async -> Int {
        let first = await call(method: method, path: path, body: body, idempotencyKey: idempotencyKey, bearer: await token(false))
        let canRetry = method == "GET" || method == "HEAD" || !(idempotencyKey ?? "").isEmpty
        if first != 401 || !canRetry {
            return first
        }
        return await call(method: method, path: path, body: body, idempotencyKey: idempotencyKey, bearer: await token(true))
    }

    private func call(
        method: String,
        path: String,
        body: Data?,
        idempotencyKey: String?,
        bearer: String?
    ) async -> Int {
        guard let bearer, !bearer.isEmpty, let url = URL(string: baseURL.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + path) else {
            return 401
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization")
        if let idempotencyKey, !idempotencyKey.isEmpty {
            request.setValue(idempotencyKey, forHTTPHeaderField: "Idempotency-Key")
        }
        if method != "GET" && method != "HEAD" {
            request.httpBody = body ?? Data()
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        do {
            let (data, response) = try await session.data(for: request)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            if method == "GET", (200..<300).contains(status) {
                cache[path] = data
            }
            return status
        } catch {
            return 0
        }
    }
}
