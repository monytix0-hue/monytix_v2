import AuthenticationServices
import CryptoKit
import Foundation
import UIKit

#if canImport(FirebaseAuth) && canImport(FirebaseCore)
import FirebaseAuth
import FirebaseCore

#if canImport(GoogleSignIn)
import GoogleSignIn
#endif

final class FirebaseAuthSession: NSObject, AuthSession {
    let isConfigured = true
    private var appleContinuation: CheckedContinuation<ASAuthorization, Error>?
    private var currentNonce: String?

    var currentEmail: String? { Auth.auth().currentUser?.email }

    func signIn(email: String, password: String) async -> AuthResult {
        await run {
            _ = try await Auth.auth().signIn(withEmail: email.trimmingCharacters(in: .whitespaces), password: password)
        }
    }

    func createAccount(email: String, password: String) async -> AuthResult {
        await run {
            _ = try await Auth.auth().createUser(withEmail: email.trimmingCharacters(in: .whitespaces), password: password)
        }
    }

    func signInWithGoogle() async -> AuthResult {
        #if canImport(GoogleSignIn)
        guard let clientID = FirebaseApp.app()?.options.clientID else {
            return .failed("Google sign-in is unavailable.")
        }
        GIDSignIn.sharedInstance.configuration = GIDConfiguration(clientID: clientID)
        guard let controller = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene })
            .flatMap(\.windows)
            .first(where: \.isKeyWindow)?
            .rootViewController else {
            return .failed("Google sign-in is unavailable.")
        }
        return await run {
            let result = try await GIDSignIn.sharedInstance.signIn(withPresenting: controller)
            guard let idToken = result.user.idToken?.tokenString else {
                throw AuthFlowError.cancelled
            }
            let credential = GoogleAuthProvider.credential(withIDToken: idToken, accessToken: result.user.accessToken.tokenString)
            _ = try await Auth.auth().signIn(with: credential)
        }
        #else
        return .failed("Google sign-in is not linked.")
        #endif
    }

    func signInWithApple() async -> AuthResult {
        let nonce = randomNonce()
        currentNonce = nonce
        return await run {
            let authorization = try await self.requestAppleAuthorization(nonce: nonce)
            guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
                  let tokenData = credential.identityToken,
                  let idToken = String(data: tokenData, encoding: .utf8),
                  let rawNonce = self.currentNonce else {
                throw AuthFlowError.cancelled
            }
            let firebaseCredential = OAuthProvider.credential(
                providerID: .apple,
                idToken: idToken,
                rawNonce: rawNonce
            )
            _ = try await Auth.auth().signIn(with: firebaseCredential)
        }
    }

    func idToken(forceRefresh: Bool) async -> String? {
        try? await Auth.auth().currentUser?.getIDToken(forcingRefresh: forceRefresh)
    }

    func signOut() async {
        try? Auth.auth().signOut()
    }

    private func requestAppleAuthorization(nonce: String) async throws -> ASAuthorization {
        try await withCheckedThrowingContinuation { continuation in
            appleContinuation = continuation
            let request = ASAuthorizationAppleIDProvider().createRequest()
            request.requestedScopes = [.fullName, .email]
            request.nonce = sha256(nonce)
            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            controller.performRequests()
        }
    }

    private func run(_ block: () async throws -> Void) async -> AuthResult {
        do {
            try await block()
            return .success
        } catch {
            return .failed("Sign-in failed.")
        }
    }

    private func randomNonce(length: Int = 32) -> String {
        let charset = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvwxyz-._")
        return String((0..<length).map { _ in charset.randomElement()! })
    }

    private func sha256(_ value: String) -> String {
        let digest = SHA256.hash(data: Data(value.utf8))
        return digest.map { String(format: "%02x", $0) }.joined()
    }
}

private enum AuthFlowError: Error {
    case cancelled
}

extension FirebaseAuthSession: ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        appleContinuation?.resume(returning: authorization)
        appleContinuation = nil
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        appleContinuation?.resume(throwing: error)
        appleContinuation = nil
    }

    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first(where: \.isKeyWindow) ?? ASPresentationAnchor()
    }
}
#endif
