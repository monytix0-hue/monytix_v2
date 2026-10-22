import Foundation

enum ConfirmResult {
    case confirmed
    case skipped
    case rejected(String)
}

final class MonytixApi {
    private let baseURL: String
    private let session = URLSession(configuration: .ephemeral)

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

    /// Best-effort server logout; failures are ignored by the caller.
    func logout(token: (Bool) async -> String?) async {
        if baseURL.isEmpty {
            return
        }
        _ = await send(method: "POST", path: "/auth/logout", body: nil, idempotencyKey: nil, token: token)
    }

    func getJSON(path: String, token: (Bool) async -> String?) async -> Data? {
        if baseURL.isEmpty {
            return nil
        }
        let first = await fetch(path: path, bearer: await token(false))
        let result = first.status == 401 ? await fetch(path: path, bearer: await token(true)) : first
        return (200..<300).contains(result.status) ? result.data : nil
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

    func submit(
        method: String,
        path: String,
        body: Data?,
        idempotencyKey: String?,
        token: (Bool) async -> String?
    ) async -> (status: Int, data: Data?) {
        if baseURL.isEmpty {
            return (0, nil)
        }
        let first = await exchange(method: method, path: path, body: body, idempotencyKey: idempotencyKey, bearer: await token(false))
        let canRetry = method == "GET" || method == "HEAD" || !(idempotencyKey ?? "").isEmpty
        if first.status != 401 || !canRetry {
            return first
        }
        return await exchange(method: method, path: path, body: body, idempotencyKey: idempotencyKey, bearer: await token(true))
    }

    func putSigned(url: String, headers: [String: String], bytes: Data, contentType: String) async -> Int {
        guard let target = URL(string: url) else { return 0 }
        var request = URLRequest(url: target)
        request.httpMethod = "PUT"
        request.httpBody = bytes
        request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        headers.forEach { request.setValue($0.value, forHTTPHeaderField: $0.key) }
        do {
            let (_, response) = try await session.data(for: request)
            return (response as? HTTPURLResponse)?.statusCode ?? 0
        } catch {
            return 0
        }
    }

    private func fetch(path: String, bearer: String?) async -> (status: Int, data: Data?) {
        guard let bearer, !bearer.isEmpty,
              let url = URL(string: baseURL.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + path) else {
            return (401, nil)
        }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization")
        do {
            let (data, response) = try await session.data(for: request)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            return (status, (200..<300).contains(status) ? data : nil)
        } catch {
            return (0, nil)
        }
    }

    private func exchange(
        method: String,
        path: String,
        body: Data?,
        idempotencyKey: String?,
        bearer: String?
    ) async -> (status: Int, data: Data?) {
        guard let bearer, !bearer.isEmpty,
              let url = URL(string: baseURL.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + path) else {
            return (401, nil)
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
            return ((response as? HTTPURLResponse)?.statusCode ?? 0, data)
        } catch {
            return (0, nil)
        }
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
            let (_, response) = try await session.data(for: request)
            return (response as? HTTPURLResponse)?.statusCode ?? 0
        } catch {
            return 0
        }
    }
}
