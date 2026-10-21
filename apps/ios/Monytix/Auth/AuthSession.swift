import Foundation

#if canImport(FirebaseCore)
import FirebaseCore
#endif

enum AuthResult {
    case success
    case failed(String)
}

protocol AuthSession: AnyObject {
    var isConfigured: Bool { get }
    var currentEmail: String? { get }
    func signIn(email: String, password: String) async -> AuthResult
    func createAccount(email: String, password: String) async -> AuthResult
    func signInWithGoogle() async -> AuthResult
    func signInWithApple() async -> AuthResult
    func idToken(forceRefresh: Bool) async -> String?
    func signOut() async
}

private let missingFirebase = "Firebase is not configured for this build."

final class UnconfiguredAuthSession: AuthSession {
    let isConfigured = false
    var currentEmail: String? { nil }
    func signIn(email: String, password: String) async -> AuthResult { .failed(missingFirebase) }
    func createAccount(email: String, password: String) async -> AuthResult { .failed(missingFirebase) }
    func signInWithGoogle() async -> AuthResult { .failed(missingFirebase) }
    func signInWithApple() async -> AuthResult { .failed(missingFirebase) }
    func idToken(forceRefresh: Bool) async -> String? { nil }
    func signOut() async {}
}

enum AuthSessions {
    static func make() -> any AuthSession {
        #if canImport(FirebaseAuth) && canImport(FirebaseCore)
        if Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist") != nil {
            FirebaseApp.configure()
            return FirebaseAuthSession()
        }
        #endif
        return UnconfiguredAuthSession()
    }
}
